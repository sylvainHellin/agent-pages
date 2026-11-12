/* Review sync between devices.
   report.js keeps a lesson's answers, comments, notes and review rounds in localStorage
   (anno:<slug>, anno:<slug>:answers | :notes | :round | :prev). The library (apps/web) and the
   phone app (apps/mobile) are served from the same origin as the lesson pages, so they mirror
   those keys to the server (GET/POST api/lessons/<slug>/review):
     TutorSync.pull(api, slug)  before the lesson page loads (and when the app comes back to the front);
                                resolves true when it changed what is stored on this device
     TutorSync.push(api, slug)  after edits (the apps call it every review tick and when hidden)
   Both take an optional last argument `key`, the page's storage key (anno:<key>), when it differs from the
   lesson slug: an in-place lesson (a marked page under a root) keys its storage by data-doc-id or its path.
   Last sync per lesson and device: localStorage tl-sync:<slug> = {at: server time, sig: data sent/received}. */
(function () {
  'use strict';
  var PARTS = { c: '', answers: ':answers', notes: ':notes', round: ':round', prev: ':prev' };
  var busy = {};
  function key(slug, part) { return 'anno:' + slug + PARTS[part]; }
  function read(slug) {
    var d = {};
    Object.keys(PARTS).forEach(function (p) {
      try { var v = localStorage.getItem(key(slug, p)); if (v != null) d[p] = JSON.parse(v); } catch (e) {}
    });
    return d;
  }
  function write(slug, d) {
    Object.keys(PARTS).forEach(function (p) {
      try { if (d[p] == null) localStorage.removeItem(key(slug, p)); else localStorage.setItem(key(slug, p), JSON.stringify(d[p])); } catch (e) {}
    });
  }
  function meta(slug) { try { return JSON.parse(localStorage.getItem('tl-sync:' + slug)) || {}; } catch (e) { return {}; } }
  function setMeta(slug, at, d) { try { localStorage.setItem('tl-sync:' + slug, JSON.stringify({ at: at, sig: JSON.stringify(d) })); } catch (e) {} }
  function empty(d) { return !Object.keys(d).length; }
  function answered(a) { return !!a && ((a.choice && a.choice.length) || (a.text && String(a.text).trim())); }

  // Both sides changed since the last sync: keep everything from both.
  function merge(srv, loc) {
    var out = {}, byId = {};
    (srv.c || []).concat(loc.c || []).forEach(function (c) { if (c && c.id) byId[c.id] = c; });
    var cs = Object.keys(byId).map(function (id) { return byId[id]; });
    if (cs.length) out.c = cs;
    var ans = {}, k;
    for (k in (srv.answers || {})) ans[k] = srv.answers[k];
    for (k in (loc.answers || {})) if (answered(loc.answers[k]) || !ans[k]) ans[k] = loc.answers[k];
    if (Object.keys(ans).length) out.answers = ans;
    var a = (srv.notes || '').trim(), b = (loc.notes || '').trim();
    var n = !a ? b : !b ? a : a.indexOf(b) >= 0 ? a : b.indexOf(a) >= 0 ? b : a + '\n\n' + b;
    if (n) out.notes = n;
    var r = (loc.round && loc.round.sent) ? loc.round : (srv.round || loc.round);
    if (r) out.round = r;
    var pv = (srv.prev && loc.prev) ? ((srv.prev.at || 0) > (loc.prev.at || 0) ? srv.prev : loc.prev) : (srv.prev || loc.prev);
    if (pv) out.prev = pv;
    return out;
  }

  function req(api, slug, opts) {
    return fetch(api + 'lessons/' + encodeURIComponent(slug) + '/review', Object.assign({ cache: 'no-store' }, opts || {}))
      .then(function (r) { if (!r.ok) throw new Error('review sync ' + r.status); return r.json(); });
  }

  function push(api, slug, keepalive, key) {
    var k = key || slug;
    if (!slug || busy[k]) return Promise.resolve(false);
    var d = read(k), s = JSON.stringify(d), m = meta(k);
    if (s === (m.sig || '{}')) return Promise.resolve(false);
    busy[k] = true;
    return req(api, slug, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: d }), keepalive: !!keepalive })
      .then(function (r) { setMeta(k, r.updated, d); return true; })
      .catch(function () { return false; })
      .then(function (x) { busy[k] = false; return x; });
  }

  function pull(api, slug, key) {
    var k = key || slug;
    if (!slug) return Promise.resolve(false);
    return req(api, slug).then(function (srv) {
      var m = meta(k), loc = read(k), sd = srv.data || {};
      var dirty = JSON.stringify(loc) !== (m.sig || '{}');
      var newer = (srv.updated || 0) > (m.at || 0);
      if (!newer) { if (dirty) push(api, slug, false, k); return false; }
      if (!dirty || empty(loc)) {
        var changed = JSON.stringify(loc) !== JSON.stringify(sd);
        write(k, sd); setMeta(k, srv.updated, sd);
        return changed;
      }
      write(k, merge(sd, loc));
      setMeta(k, srv.updated, sd); // not yet sent: the next push uploads the merge
      return push(api, slug, false, k).then(function () { return true; });
    }).catch(function () { return false; });
  }

  window.TutorSync = { pull: pull, push: push, read: read };
})();
