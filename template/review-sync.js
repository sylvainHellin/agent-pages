/* Review sync between devices: the server on the home server is the one store for what a reader types into a page.
   report.js keeps a page's answers, comments, notes and review rounds in localStorage
   (anno:<key>, anno:<key>:answers | :notes | :round | :prev, key = data-doc-id or the page's path). This file
   mirrors those keys to the server, which keeps them in <lessons>/_data/review/:
     TutorSync.page(opts)       a page the server serves: the server puts this script and a call with the stored state
                                into the page's head, before report.js, so the page starts from the newest state; then
                                it pushes every 1.5 s, when hidden or left, and pulls (reloading if needed) when it comes
                                back to the front. opts = {api, path: 'reviews/<id>' | 'lessons/<slug>/review',
                                state: {updated, data}, lesson, shared: [urls of other pages with the same data-doc-id]}
     TutorSync.pull(api, slug)  the library app (apps/ui), before a lesson page loads and when it comes back to the front;
                                resolves true when it changed what is stored on this device
     TutorSync.push(api, slug)  the app, after edits
   pull and push take an optional last argument `key`, the page's storage key, when it differs from the lesson slug.
   Last sync per page and device: localStorage tl-sync:<key> = {at: server time, sig: the data sent or received},
   the common base of the three-way merge when both sides changed. */
(function () {
  'use strict';
  if (window.TutorSync) return;
  var PARTS = { c: '', answers: ':answers', notes: ':notes', round: ':round', prev: ':prev' };
  var busy = {};
  function key(k, part) { return 'anno:' + k + PARTS[part]; }
  function read(k) {
    var d = {};
    Object.keys(PARTS).forEach(function (p) {
      try { var v = localStorage.getItem(key(k, p)); if (v != null) d[p] = JSON.parse(v); } catch (e) {}
    });
    return d;
  }
  function write(k, d) {
    Object.keys(PARTS).forEach(function (p) {
      try { if (d[p] == null) localStorage.removeItem(key(k, p)); else localStorage.setItem(key(k, p), JSON.stringify(d[p])); } catch (e) {}
    });
  }
  function meta(k) { try { return JSON.parse(localStorage.getItem('tl-sync:' + k)) || {}; } catch (e) { return {}; } }
  function setMeta(k, at, d) { try { localStorage.setItem('tl-sync:' + k, JSON.stringify({ at: at, sig: JSON.stringify(d) })); } catch (e) {} }
  function base(k) { try { return JSON.parse(meta(k).sig || 'null'); } catch (e) { return null; } }
  function empty(d) { return !Object.keys(d).length; }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function answered(a) { return !!a && ((a.choice && a.choice.length) || (a.text && String(a.text).trim())); }

  /* One item (a comment by id, an answer by question) seen by the base, the server and this device:
     gone from either side after the last sync = deleted there; changed on one side only = that side;
     changed on both = `pick`. Without a base nothing counts as deleted. */
  function three(b, s, l, pick) {
    if (b !== undefined && (s === undefined || l === undefined)) return undefined;
    if (s === undefined) return l;
    if (l === undefined) return s;
    if (b !== undefined && same(l, b)) return s;
    if (b !== undefined && same(s, b)) return l;
    return pick(s, l);
  }
  function byId(list) {
    var m = {};
    (list || []).forEach(function (c) { if (c && c.id) m[c.id] = c; });
    return m;
  }

  // Both sides changed since the last sync (base: what both had then, null when unknown).
  function merge(srv, loc, b) {
    srv = srv || {}; loc = loc || {}; b = b || null;
    var out = {}, k;
    var bc = b ? byId(b.c) : {}, sc = byId(srv.c), lc = byId(loc.c), order = [], seen = {};
    (srv.c || []).concat(loc.c || []).forEach(function (c) { if (c && c.id && !seen[c.id]) { seen[c.id] = 1; order.push(c.id); } });
    var cs = [];
    order.forEach(function (id) {
      var v = three(b ? bc[id] : undefined, sc[id], lc[id], function (s, l) { return l; });
      if (v) cs.push(v);
    });
    if (cs.length) out.c = cs;
    var ba = (b && b.answers) || {}, sa = srv.answers || {}, la = loc.answers || {}, ans = {};
    var qs = {};
    for (k in sa) qs[k] = 1;
    for (k in la) qs[k] = 1;
    for (k in qs) {
      var a = three(b ? ba[k] : undefined, sa[k], la[k], function (s, l) { return answered(l) || !answered(s) ? l : s; });
      if (a) ans[k] = a;
    }
    if (Object.keys(ans).length) out.answers = ans;
    var bn = ((b && b.notes) || '').trim(), sn = (srv.notes || '').trim(), ln = (loc.notes || '').trim(), n;
    if (b && ln === bn) n = sn;
    else if (b && sn === bn) n = ln;
    else n = !sn ? ln : !ln ? sn : sn.indexOf(ln) >= 0 ? sn : ln.indexOf(sn) >= 0 ? ln : sn + '\n\n' + ln;
    if (n) out.notes = n;
    var r = (loc.round && loc.round.sent) ? loc.round : (srv.round || loc.round);
    if (r) out.round = r;
    var pv = (srv.prev && loc.prev) ? ((srv.prev.at || 0) > (loc.prev.at || 0) ? srv.prev : loc.prev) : (srv.prev || loc.prev);
    if (pv) out.prev = pv;
    return out;
  }

  function req(api, path, opts) {
    return fetch(api + path, Object.assign({ cache: 'no-store' }, opts || {}))
      .then(function (r) { if (!r.ok) throw new Error('review sync ' + r.status); return r.json(); });
  }
  function lessonPath(slug) { return 'lessons/' + encodeURIComponent(slug) + '/review'; }

  function pushTo(api, path, k, keepalive) {
    if (busy[k]) return Promise.resolve(false);
    var d = read(k), s = JSON.stringify(d), m = meta(k);
    if (s === (m.sig || '{}')) return Promise.resolve(false);
    busy[k] = true;
    return req(api, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: d }), keepalive: !!keepalive })
      .then(function (r) { setMeta(k, r.updated, d); return true; })
      .catch(function () { return false; })
      .then(function (x) { busy[k] = false; return x; });
  }

  /* Bring the server's state into this device's storage. 'same' when nothing changed here,
     'wrote' when it changed what is stored, 'merged' when both sides changed (a push follows). */
  function apply(k, srv) {
    var m = meta(k), loc = read(k), sd = (srv && srv.data) || {};
    var dirty = JSON.stringify(loc) !== (m.sig || '{}');
    var newer = ((srv && srv.updated) || 0) > (m.at || 0);
    if (!newer) return dirty ? 'dirty' : 'same';
    if (!dirty || empty(loc)) {
      var changed = !same(loc, sd);
      write(k, sd); setMeta(k, srv.updated, sd);
      return changed ? 'wrote' : 'same';
    }
    write(k, merge(sd, loc, base(k)));
    setMeta(k, srv.updated, sd); // not yet sent: the next push uploads the merge
    return 'merged';
  }

  function pullFrom(api, path, k) {
    return req(api, path).then(function (srv) {
      var r = apply(k, srv);
      if (r === 'dirty') { pushTo(api, path, k); return false; }
      if (r === 'merged') return pushTo(api, path, k).then(function () { return true; });
      return r === 'wrote';
    }).catch(function () { return false; });
  }

  function push(api, slug, keepalive, k) { return slug ? pushTo(api, lessonPath(slug), k || slug, keepalive) : Promise.resolve(false); }
  function pull(api, slug, k) { return slug ? pullFrom(api, lessonPath(slug), k || slug) : Promise.resolve(false); }

  // The storage key report.js uses (docIdOf there).
  function pageKey() {
    var path = location.pathname || '';
    var id = document.documentElement.getAttribute('data-doc-id');
    return (!id || id === 'report-slug') ? path : id;
  }
  function editing() {
    var a = document.activeElement;
    return !!document.querySelector('.anno-pop') || !!(a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)));
  }

  function page(o) {
    var k = pageKey(), api = o.api || '/api/', path = o.path;
    if (o.shared && o.shared.length) {
      console.warn('agent-pages: comments on this page stay on this device: its data-doc-id "' + k +
        '" is also used by ' + o.shared.join(', ') + '; give each page its own id');
      return;
    }
    if (o.state) {
      var r = apply(k, o.state);
      if (r === 'merged' || r === 'dirty') setTimeout(function () { pushTo(api, path, k); }, 0);
    }
    var framed = window.parent !== window;
    setInterval(function () { pushTo(api, path, k); }, 1500);
    function back() {
      if (o.lesson && framed) return; // the app's reader pulls lessons and reloads them itself
      pullFrom(api, path, k).then(function (changed) { if (changed && !editing()) location.reload(); });
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') pushTo(api, path, k, true);
      else back();
    });
    window.addEventListener('pagehide', function () { pushTo(api, path, k, true); });
    window.addEventListener('pageshow', function (e) { if (e && e.persisted) back(); });
  }

  window.TutorSync = { pull: pull, push: push, read: read, merge: merge, page: page };
})();
