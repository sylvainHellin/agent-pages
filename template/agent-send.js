/* Send to agent: the reader's comment export goes straight back to the agent session that wrote the page.
   The server puts this script and AgentSend.page({api, page, new}) into the head of every page it serves with the
   review layer (after review-sync.js, before report.js): page is the page's id (/api/items, POST /api/send), new
   whether the server can start a new agent. A page opened as a file never loads it, so it has no Send button.
     AgentSend.controller(hooks)  report.js, once the review layer is built; null when the page has nothing to send
                                  to (no AgentSend.page(), or no agent-pages-session meta and no new agent).
                                  hooks = {markdown(), exportable(), copy(text, done(ok)), sent(), change?(state)}:
                                  the export, whether there is one, the clipboard copy and the mark Export uses.
       .view({btn, line, again})  one place showing the send: the button, its status line and Start a new agent;
                                  every view shows the same state
       .send()                    POST /api/send {page, id, markdown}; answers at once with a route, then
                                  GET /api/sends?page= every POLL_MS while the send is not final, paused while the
                                  tab is hidden
       .startNew()                the same with new: true, offered when no agent holds the page's sessions
   The send id is made here: a retry after a lost answer (offline) reuses it, so the server stores one send; a click
   after a final state is a new send. The send in flight is kept in localStorage bn-send:<page> until it is final,
   so a reload picks its state up again. Offline, the export is copied to the clipboard as Export does. */
(function () {
  'use strict';
  if (window.AgentSend) return;
  var POLL_MS = 3000, MISSES = 3;
  var boot = null;

  function page(o) { boot = o && typeof o.page === 'string' && o.page ? { api: o.api || '/api/', page: o.page, new: !!o.new } : null; }
  function sessions() {
    var m = document.querySelector('meta[name="agent-pages-session"]');
    return m ? String(m.getAttribute('content') || '').trim().split(/\s+/).filter(Boolean) : [];
  }
  function available() { return !!boot && (sessions().length > 0 || boot.new); }

  function short(id) { return String(id || '').split('-')[0]; }
  function where(r) {
    if (r.harness === 'herdr') return r.where ? 'herdr ' + r.where : 'herdr';
    if (r.harness === 'paseo') return r.where ? 'Paseo agent ' + short(r.where) : 'Paseo';
    if (r.harness === 'pi') return r.host ? 'pi on ' + r.host : 'pi';
    if (r.where === 'agents reconnecting') return 'agents to reconnect';
    return r.where || 'the agent';
  }
  /* A send record (POST /api/send's answer, an entry of GET /api/sends) as one line: {text, final, offerNew}. */
  function describe(r) {
    var st = r.state, route = r.route;
    if (st === 'none' || (route === 'none' && !st)) {
      return { text: boot && boot.new ? 'No agent has this session' : 'No agent has this session: use Export', final: true, offerNew: !!(boot && boot.new) };
    }
    if (st === 'failed' || route === 'failed') return { text: 'Failed: ' + (r.error || 'no reason given'), final: true };
    if (st === 'started') return { text: 'Sent', final: true };
    if (st === 'cancelled') return { text: 'Replaced by a newer send', final: true };
    var text = route === 'live' ? 'Queued in ' + where(r)
      : route === 'pending' ? 'Waiting for ' + where(r)
      : route === 'resuming' ? 'Resuming in Paseo pages'
      : route === 'paseo' ? 'Sending to ' + where(r)
      : route === 'new' ? 'Starting a new agent'
      : 'Sending';
    return { text: text, final: false };
  }

  function newId() {
    var b = new Uint8Array(8), s = '';
    try { window.crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < b.length; j++) s += (b[j] < 16 ? '0' : '') + b[j].toString(16);
    return 's' + Date.now().toString(36) + '-' + s;
  }

  function controller(h) {
    if (!available()) return null;
    var api = boot.api, pg = boot.page, KEY = 'bn-send:' + pg;
    var views = [], cur = null, text = '', offerNew = false, timer = null, misses = 0;
    function busy() { return !!cur && (cur.phase === 'posting' || cur.phase === 'waiting'); }
    function save() {
      try {
        if (cur && cur.phase !== 'final') localStorage.setItem(KEY, JSON.stringify({ id: cur.id, isNew: cur.isNew, phase: cur.phase }));
        else localStorage.removeItem(KEY);
      } catch (e) {}
    }
    function render() {
      var b = busy();
      views.forEach(function (v) {
        v.btn.hidden = false;
        v.btn.disabled = b;
        v.line.textContent = text;
        v.line.hidden = !text;
        if (v.again) { v.again.hidden = !offerNew; v.again.disabled = b; }
      });
      if (h.change) h.change({ text: text, busy: b, final: !!cur && cur.phase === 'final', offerNew: offerNew });
    }
    function set(phase, t, o) {
      cur.phase = phase;
      text = t;
      offerNew = !!o;
      save();
      render();
    }
    function apply(r) {
      var d = describe(r);
      misses = 0;
      set(d.final ? 'final' : 'waiting', d.text, d.offerNew);
      if (!d.final) schedule(POLL_MS);
    }
    function schedule(ms) {
      if (timer) clearTimeout(timer);
      timer = null;
      if (document.visibilityState === 'hidden') return;
      timer = setTimeout(poll, ms);
    }
    function poll() {
      timer = null;
      if (!cur || cur.phase !== 'waiting' || document.visibilityState === 'hidden') return;
      var id = cur.id;
      fetch(api + 'sends?page=' + encodeURIComponent(pg), { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('sends ' + r.status); return r.json(); })
        .then(function (j) {
          if (!cur || cur.id !== id || cur.phase !== 'waiting') return;
          var r = ((j && j.sends) || []).filter(function (s) { return s && s.id === id; })[0];
          if (r) return apply(r);
          if (++misses >= MISSES) set('retry', 'Not received: send again'); // the id is kept for the retry
          else schedule(POLL_MS);
        })
        .catch(function () { if (cur && cur.id === id && cur.phase === 'waiting') schedule(POLL_MS); });
    }
    function offline(md) {
      h.copy(md, function (ok) {
        if (ok) h.sent();
        set('offline', ok ? 'Offline: export copied' : 'Offline: copy blocked, use Download .md');
      });
    }
    function post(id, isNew) {
      cur = { id: id, isNew: isNew, phase: 'posting' };
      misses = 0;
      set('posting', isNew ? 'Starting a new agent' : 'Sending');
      var md = h.markdown(), body = { page: pg, id: id, markdown: md };
      if (isNew) body['new'] = true;
      fetch(api + 'send', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (!cur || cur.id !== id) return;
            if (r.ok) {
              if (j.route !== 'none' && j.state !== 'failed' && j.state !== 'none') h.sent();
              return apply(j);
            }
            if (r.status === 409 && !(j && j.urls)) { set('waiting', 'Sending'); return schedule(POLL_MS); } // being routed
            set('final', 'Failed: ' + ((j && j.error) || 'the server answered ' + r.status));
          });
        }, function () { if (cur && cur.id === id) offline(md); });
    }
    function send() {
      if (busy()) return;
      if (!h.exportable()) {
        cur = { id: null, isNew: false, phase: 'final' };
        return set('final', 'Nothing to send yet');
      }
      var retry = cur && cur.id && (cur.phase === 'offline' || cur.phase === 'retry');
      post(retry ? cur.id : newId(), retry ? cur.isNew : false);
    }
    function startNew() {
      if (busy() || !boot.new) return;
      post(newId(), true);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { if (timer) clearTimeout(timer); timer = null; }
      else if (cur && cur.phase === 'waiting' && !timer) poll();
    });
    // a send this page made before a reload: its state again, or its id for a retry
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (saved && typeof saved.id === 'string') {
      cur = { id: saved.id, isNew: !!saved.isNew, phase: saved.phase };
      if (saved.phase === 'posting' || saved.phase === 'waiting') {
        cur.phase = 'waiting';
        text = 'Checking';
        poll();
      } else if (saved.phase !== 'offline' && saved.phase !== 'retry') cur = null;
    }
    return {
      view: function (v) { views.push(v); render(); },
      send: send,
      startNew: startNew,
      state: function () { return { id: cur && cur.id, phase: cur ? cur.phase : 'idle', text: text, offerNew: offerNew }; }
    };
  }

  window.AgentSend = { page: page, available: available, controller: controller, describe: describe };
})();
