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
    var activeDraftRev = 0;
    // ref (stored/relative name) -> exact absolute path, resolved at submit
    // time by the @file source codec so the sent message never makes the
    // agent guess where a mentioned file lives.
    var refPaths = new Map();

    function intake(ctx, sessionId, inputActions, files) {
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
          var shell = inputShell(ctx, sessionId);
          for (var i = 0; i < stored.length; i++) {
            var a = stored[i];
            refPaths.set(a.name, a.path);
            var mention = { source: 'file', ref: a.name, label: '@' + a.name, clipboardText: '@' + a.name };
            if (shell === null) {
              // No session shell (unexpected): fall back to a plain pathless mention.
              activeInputActions.setDraft(activeDraft + (activeDraft === '' || /\s$/.test(activeDraft) ? '' : ' ') + '@' + a.name);
              continue;
            }
            var state = shell.snapshot;
            var inserted = shell.insertReference(mention, { start: state.draft.length, end: state.draft.length, draftRev: state.draftRev });
            if (!inserted) break; // CAS failed: stop rather than misplace chips
          }
        })
        .catch(function (e) { console.error('[dsh-any-attachment] upload failed:', e); });
    }

    function inputShell(ctx, sessionId) {
      try {
        var actx = ctx.get('sessions').scope(sessionId);
        return actx === undefined ? null : ctx.conversation.input.for(actx);
      } catch {
        return null;
      }
    }

    function apply(ctx) {
      // The composer control keeps the session kit current for the global
      // drop handler: session id, inputActions, and the live draft text.
      function KitKeeper(props) {
        // useInput is a hook: it must run at the component top level, never
        // inside an effect. Read the draft and revision here and stash via
        // an effect.
        var draft = props.useInput(function (s) { return s.draft; });
        var draftRev = props.useInput(function (s) { return s.draftRev; });
        React.useEffect(function () {
          activeSessionId = props.sessionId;
          if (props.inputActions) activeInputActions = props.inputActions;
          activeDraft = draft;
          activeDraftRev = draftRev;
        }, [props.sessionId, props.inputActions, draft, draftRev]);
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
              if (files.length > 0) intake(ctx, props.sessionId, props.inputActions, files);
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
        intake(ctx, activeSessionId, activeInputActions, files);
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
                var files = result.value.files;
                var q = String(req.query).toLowerCase();
                var matched = q === ''
                  ? files
                  : files.filter(function (f) { return f.name.toLowerCase().indexOf(q) !== -1; });
                return matched.map(function (f) { return { name: f.name, path: f.path }; });
              });
          },
          onPick: function (pick) {
            refPaths.set(pick.candidate.name, pick.candidate.path);
            return {
              insert: {
                source: 'file',
                ref: pick.candidate.name,
                label: '@' + pick.candidate.name,
                clipboardText: '@' + pick.candidate.name,
              },
            };
          },
          codec: {
            clipboardText: function (ref) { return '@' + ref; },
            serialize: function (ref) {
              var path = refPaths.get(ref);
              return Promise.resolve(path === undefined ? '@' + ref : '@' + ref + ' (' + path + ')');
            },
          },
        });
      }, 'dsh-any-attachment: @file source');
    }

    module.exports = { name: 'dsh-any-attachment', inject: ['connection', 'slots', 'sessions', 'conversation', 'inputTriggers', 'locale'], apply: apply };
    return module.exports;
  }
});
