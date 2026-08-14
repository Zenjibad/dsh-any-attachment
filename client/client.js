window.__ModuleLoader__.load({
  id: 'dsh-any-attachment',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');

    var RASTER_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

    // ---- helpers ----
    function splitRasters(files) {
      return {
        rasters: files.filter(function (f) { return RASTER_TYPES.indexOf(f.type) !== -1; }),
        others: files.filter(function (f) { return RASTER_TYPES.indexOf(f.type) === -1; }),
      };
    }
    function mentionOf(attachment) {
      return '@' + attachment.name;
    }

    // ---- upload via the channel ----
    function upload(ctx, file) {
      return file.arrayBuffer().then(function (buf) {
        var bytes = new Uint8Array(buf);
        var bin = '';
        for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return ctx.connection.rpc.call('/attachments-any', 'upload', { name: file.name, data: btoa(bin) });
      });
    }

    // ---- active-session kit stashed by the mounted composer control ----
    var activeSessionId = null;
    var activeInputActions = null;
    var activeDraft = '';

    function intake(ctx, inputActions, draft, files) {
      var split = splitRasters(files);
      if (split.rasters.length > 0) {
        var created = ctx.conversation.createDraftImages(split.rasters);
        if (created.length > 0) inputActions.addImages(created.map(function (a) { return a.id; }));
      }
      if (split.others.length === 0) return;
      Promise.all(split.others.map(function (f) { return upload(ctx, f); }))
        .then(function (attachments) {
          var stored = attachments.filter(function (a) { return a.ok; }).map(function (a) { return a.value; });
          if (stored.length === 0) return;
          var separator = draft === '' || /\s$/.test(draft) ? '' : ' ';
          inputActions.setDraft(draft + separator + stored.map(mentionOf).join(' '));
        })
        .catch(function (e) { console.error('[dsh-any-attachment] upload failed:', e); });
    }

    function apply(ctx) {
      // The composer control keeps the session kit current for the global
      // drop handler: session id, inputActions, and the live draft text.
      function KitKeeper(props) {
        // useInput is a hook: it must run at the component top level, never
        // inside an effect. Read the draft here and stash it via an effect.
        var draft = props.useInput(function (s) { return s.draft; });
        React.useEffect(function () {
          activeSessionId = props.sessionId;
          if (props.inputActions) activeInputActions = props.inputActions;
          activeDraft = draft;
        }, [props.sessionId, props.inputActions, draft]);
        return null;
      }

      // ---- paperclip entry (composer tool row) ----
      // Session-scope slot entries receive the standard kit (useInput,
      // inputActions) automatically via the sessions.provide channel.
      function PaperclipButton(props) {
        var inputRef = React.useRef(null);
        return React.createElement(React.Fragment, null,
          React.createElement(KitKeeper, { sessionId: props.sessionId, inputActions: props.inputActions, useInput: props.useInput }),
          React.createElement('input', { ref: inputRef, type: 'file', multiple: true, style: { display: 'none' },
            onChange: function (e) {
              var files = Array.from(e.target.files || []);
              e.target.value = '';
              if (files.length > 0) intake(ctx, props.inputActions, activeDraft, files);
            } }),
          React.createElement('button', { type: 'button', title: 'Attach files', 'aria-label': 'Attach files',
            style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: '0 4px' },
            onClick: function () { inputRef.current && inputRef.current.click(); } }, '+'));
      }

      // ---- slot registrations ----
      ctx.slots.inject('conversation.input.left', function () {
        return ctx.slots.register({ name: 'conversation.input.left', id: 'dsh-any-attachment-attach', order: 10,
          inject: function (sessionId) { return { sessionId: sessionId }; } }, PaperclipButton);
      });

      // ---- document-level drop interception (capture phase) ----
      function onDrop(e) {
        var files = Array.from(e.dataTransfer && e.dataTransfer.files || []);
        if (files.length === 0) return;
        var split = splitRasters(files);
        if (split.others.length === 0) return; // pure rasters: built-in handler takes it
        e.preventDefault();
        e.stopPropagation();
        if (!activeSessionId || !activeInputActions) return;
        intake(ctx, activeInputActions, activeDraft, files);
      }
      document.addEventListener('drop', onDrop, true);
      ctx.effect(function () {
        return function () { document.removeEventListener('drop', onDrop, true); };
      }, 'dsh-any-attachment: drop interception');

      // ---- @file trigger source: workspace file autocomplete ----
      ctx.effect(function () {
        return ctx.inputTriggers.registerSource({
          trigger: '@',
          name: 'file',
          order: -1,
          candidates: function (session, req) {
            return ctx.connection.rpc.call('/attachments-any', 'list', { sessionId: session.sessionId })
              .then(function (result) {
                if (!result.ok) return [];
                var names = result.value.files;
                var q = String(req.query).toLowerCase();
                return q === ''
                  ? names.map(function (n) { return { name: n }; })
                  : names.filter(function (n) { return n.toLowerCase().indexOf(q) !== -1; }).map(function (n) { return { name: n }; });
              });
          },
          onPick: function (pick) { return { text: '@' + pick.candidate.name }; },
        });
      }, 'dsh-any-attachment: @file source');
    }

    module.exports = { name: 'dsh-any-attachment', inject: ['connection', 'slots', 'sessions', 'conversation', 'inputTriggers', 'locale'], apply: apply };
    return module.exports;
  }
});
