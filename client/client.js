window.__ModuleLoader__.load({
  id: 'dsh-any-attachment',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');

    var RASTER_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    var MAX_FILES = 8;
    var MAX_MESSAGE_TEXT = 100 * 1024;

    // ---- helpers ----
    function decodeBase64(data) {
      return Uint8Array.from(atob(data), function (c) { return c.charCodeAt(0); });
    }
    function splitRasters(files) {
      return {
        rasters: files.filter(function (f) { return RASTER_TYPES.indexOf(f.type) !== -1; }),
        others: files.filter(function (f) { return RASTER_TYPES.indexOf(f.type) === -1; }),
      };
    }
    function attachmentBlock(file) {
      var head = 'Attached: ' + file.name + ' (' + file.path + ')';
      if (file.kind === 'binary') return head;
      return head + '\n--- extracted text (first 50 KB) ---\n' + file.extractedText;
    }

    // ---- per-session pending-file store (module-scoped) ----
    var pendingFiles = new Map(); // sessionId -> [{ name, size, path, kind, extractedText? }]
    var listeners = new Map();    // sessionId -> Set<fn>
    function getPending(sessionId) { return pendingFiles.get(sessionId) || []; }
    function setPending(sessionId, files) {
      pendingFiles.set(sessionId, files);
      var set = listeners.get(sessionId);
      if (set) set.forEach(function (fn) { fn(files); });
    }
    function subscribePending(sessionId, fn) {
      if (!listeners.has(sessionId)) listeners.set(sessionId, new Set());
      listeners.get(sessionId).add(fn);
      return function () { listeners.get(sessionId).delete(fn); };
    }

    // ---- upload / download via the channel ----
    function upload(ctx, sessionId, file) {
      return file.arrayBuffer().then(function (buf) {
        var bytes = new Uint8Array(buf);
        var bin = '';
        for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return ctx.connection.rpc.call('/attachments-any', 'upload',
          { sessionId: sessionId, name: file.name, data: btoa(bin) });
      }).then(function (result) {
        if (!result.ok) throw new Error(result.error.message);
        var v = result.value;
        return { name: file.name, size: file.size, path: v.path, kind: v.kind, extractedText: v.extractedText };
      });
    }
    function download(ctx, sessionId, path) {
      return ctx.connection.rpc.call('/attachments-any', 'read', { sessionId: sessionId, path: path });
    }

    // ---- routing: rasters to the built-in flow, others to the channel ----
    function intake(ctx, sessionId, inputActions, files) {
      var split = splitRasters(files);
      if (split.rasters.length > 0) {
        var created = ctx.conversation.createDraftImages(split.rasters);
        if (created.length > 0) inputActions.addImages(created.map(function (a) { return a.id; }));
      }
      if (split.others.length === 0) return;
      var pending = getPending(sessionId);
      var room = MAX_FILES - pending.length;
      if (room <= 0) return;
      var accepted = split.others.slice(0, room);
      Promise.all(accepted.map(function (f) { return upload(ctx, sessionId, f); }))
        .then(function (uploaded) { setPending(sessionId, pending.concat(uploaded)); })
        .catch(function (e) { console.error('[dsh-any-attachment] upload failed:', e); });
    }

    // ---- send: compose the text part and route through conversation ----
    function sendWithFiles(ctx, sessionId, sessions, inputActions, draft, imageIds) {
      var pending = getPending(sessionId);
      if (pending.length === 0) { inputActions.submit(); return; }
      var block = pending.map(attachmentBlock).join('\n\n');
      var text = draft === '' ? block : draft + '\n\n' + block;
      if (text.length > MAX_MESSAGE_TEXT) text = text.slice(0, MAX_MESSAGE_TEXT);
      var session = sessions.scope(sessionId);
      ctx.conversation.sendSession(session, text, imageIds, 'queue')
        .then(function () {
          setPending(sessionId, []);
          inputActions.setDraft('');
          if (imageIds.length > 0) inputActions.pruneImages(imageIds);
        })
        .catch(function () { /* draft + files retained; error surfaces via conversation state */ });
    }

    var activeSessionId = null;

    function apply(ctx) {
      // The active-session marker: session-scoped components keep the id
      // current for the global drop handler.
      function RememberSession(props) {
        React.useEffect(function () { activeSessionId = props.sessionId; }, [props.sessionId]);
        return null;
      }

      // ---- paperclip entry (composer tool row) ----
      // Session-scope slot entries receive the standard kit (useInput,
      // inputActions) automatically via the sessions.provide channel.
      function PaperclipButton(props) {
        var inputRef = React.useRef(null);
        return React.createElement(React.Fragment, null,
          React.createElement(RememberSession, { sessionId: props.sessionId }),
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

      // ---- file rail entry (composer dock) ----
      function FileRail(props) {
        var files = props.useFiles(function (v) { return v; });
        var draft = props.useInput(function (s) { return s.draft; });
        var imageIds = props.useInput(function (s) { return s.imageIds; });
        var open = React.useState(null);
        var openIndex = open[0], setOpen = open[1];
        React.useEffect(function () {
          // Keep the composer blocked while files are pending so Enter cannot
          // silently drop them; clear the block on send/removal.
          ctx.conversation.blocks.set(props.sessionId, files.length > 0
            ? { reason: 'Send with the files above.' }
            : undefined);
        }, [files.length, props.sessionId]);
        if (files.length === 0) {
          return React.createElement(RememberSession, { sessionId: props.sessionId });
        }
        return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 12px' } },
          React.createElement(RememberSession, { sessionId: props.sessionId }),
          files.map(function (f, i) {
            return React.createElement('div', { key: f.path, style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } },
              React.createElement('span', null, f.name + ' · ' + Math.ceil(f.size / 1024) + ' KB'),
              React.createElement('button', { type: 'button', title: 'Download', onClick: function () {
                download(ctx, props.sessionId, f.path).then(function (r) {
                  if (!r.ok) return;
                  var a = document.createElement('a');
                  a.href = URL.createObjectURL(new Blob([decodeBase64(r.value.data)]));
                  a.download = f.name;
                  a.click();
                  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
                });
              } }, '\u2b07'),
              f.kind === 'text' && React.createElement('button', { type: 'button', title: 'Toggle extracted text',
                onClick: function () { setOpen(openIndex === i ? null : i); } }, openIndex === i ? '\u25be' : '\u25b8'),
              React.createElement('button', { type: 'button', title: 'Remove', onClick: function () {
                var next = files.slice();
                next.splice(i, 1);
                setPending(props.sessionId, next);
              } }, '\u2715'),
              openIndex === i && f.kind === 'text' && React.createElement('pre', {
                style: { maxHeight: 120, overflow: 'auto', margin: 0, fontSize: 12, width: '100%' } }, f.extractedText));
          }),
          React.createElement('button', { type: 'button', onClick: function () {
            sendWithFiles(ctx, props.sessionId, ctx.get('sessions'), props.inputActions, draft, imageIds);
          }, style: { alignSelf: 'flex-end' } }, 'Send with files'));
      }

      // ---- slot registrations ----
      ctx.slots.inject('conversation.input.left', function () {
        return ctx.slots.register({ name: 'conversation.input.left', id: 'dsh-any-attachment-attach', order: 10,
          inject: function (sessionId) { return { sessionId: sessionId }; } }, PaperclipButton);
      });
      ctx.slots.inject('conversation.input.dock', function () {
        return ctx.slots.register({ name: 'conversation.input.dock', id: 'dsh-any-attachment-rail', order: 10,
          inject: function (sessionId) {
            return {
              ctx: ctx,
              sessionId: sessionId,
              useFiles: function (selector) {
                return React.useSyncExternalStore(
                  function (cb) { return subscribePending(sessionId, cb); },
                  function () { return selector(getPending(sessionId)); });
              },
            };
          } }, FileRail);
      });

      // ---- document-level drop interception (capture phase) ----
      function onDrop(e) {
        var files = Array.from(e.dataTransfer && e.dataTransfer.files || []);
        if (files.length === 0) return;
        var split = splitRasters(files);
        if (split.others.length === 0) return; // pure rasters: built-in handler takes it
        e.preventDefault();
        e.stopPropagation();
        var sessionId = activeSessionId;
        if (!sessionId) return;
        var sessions = ctx.get('sessions');
        var scoped = sessions.scope(sessionId);
        if (!scoped) return;
        intake(ctx, sessionId, scoped.inputActions, files);
      }
      document.addEventListener('drop', onDrop, true);
      ctx.effect(function () {
        return function () { document.removeEventListener('drop', onDrop, true); };
      }, 'dsh-any-attachment: drop interception');
    }

    module.exports = { name: 'dsh-any-attachment', inject: ['connection', 'slots', 'sessions', 'locale'], apply: apply };
  }
});
