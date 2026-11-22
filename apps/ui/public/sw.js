/* agent-pages service worker: the app and every page opened before stay readable with no connection, and open from
   the cache first. Served by the server at the app root (/sw.js, Cache-Control no-cache), so its scope covers the app,
   /app/ and every page under a root, including the pages the app shows in its same-origin iframe.

   Which request gets which strategy (strategy() below, tested in tests/sw.test.mjs):
     assets/*, app/assets/*         Vite's content-hashed files: cache first
     the app shell, pages, _template/*, lessons/_assets/*, same-origin images, fonts, CSS, JS
                                    stale-while-revalidate: the cached copy at once, then a background request with
                                    the cached ETag (If-None-Match); a changed page or shell is posted to the app
                                    ({type: 'agent-pages:updated', url, shell}), which offers a reload
     a reload of any of these       network first, the cached copy when offline
     api/items, api/projects, api/theme.css
                                    network first, the cached copy when offline, so the list shows on a train
     the rest of api/*, other methods, Range requests, media, other origins
                                    never cached
   Messages from the app (an answer on the message port):
     {type: 'agent-pages:prefetch', urls, budget}   Download for offline: pages with the template files and images they
                                                    reference; a page saved so is never evicted by auto below
     {type: 'agent-pages:auto', urls, budget}       every Open page (urls, newest first): each page asked with its cached
                                                    ETag (304: nothing downloaded), two at a time, with what it references,
                                                    until the pages and files of the list pass budget (150 MB), the rest not
                                                    saved; then the pages this saved before that are no longer in urls, or
                                                    are past the budget, are evicted with the files they added that no saved
                                                    page still uses (a page it could not reach keeps its copy, and a page
                                                    opened in the app is never evicted)
     {type: 'agent-pages:warm', urls}               what the app loaded before this worker controlled it
     {type: 'agent-pages:cached'}                   the pages that are saved, {urls: [...]}
   Network state changes are posted as {type: 'agent-pages:net', online}, a page put in the cache as
   {type: 'agent-pages:saved', url}, the progress of auto as {type: 'agent-pages:progress', done, total, running}.
   Bump VERSION when the cache layout changes: activate deletes every agent-pages cache of another version. */
var AgentPagesSW = (function () {
  'use strict'
  var VERSION = 'v1'
  var CACHES = {
    assets: 'agent-pages-assets-' + VERSION,
    pages: 'agent-pages-pages-' + VERSION,
    api: 'agent-pages-api-' + VERSION,
    meta: 'agent-pages-meta-' + VERSION, // the record of what auto saved
  }
  var API_LISTS = { 'api/items': 1, 'api/projects': 1, 'api/theme.css': 1 }
  var NEVER = { 'sw.js': 1, healthz: 1, 'index.json': 1 }
  var STATIC = /\.(css|js|mjs|png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|webmanifest)$/i
  var PAGE = /\.html?$/i
  var MEDIA = /\.(mp4|m4v|mov|webm|ogv|mp3|m4a|aac|wav|ogg|oga|flac)$/i
  var NETWORK = { kind: 'network' }

  /* r: {url, method, range (a Range header), mode, cache (the request's cache mode)}; scope: the registration's scope. */
  function strategy(r, scope) {
    if (r.method !== 'GET' || r.range) return NETWORK
    var u, s
    try {
      u = new URL(r.url)
      s = new URL(scope)
    } catch {
      return NETWORK
    }
    if (u.origin !== s.origin || u.pathname.indexOf(s.pathname) !== 0) return NETWORK
    var rel = u.pathname.slice(s.pathname.length)
    var key = u.origin + u.pathname + u.search
    var fresh = r.cache === 'no-cache' || r.cache === 'reload' || r.cache === 'no-store'
    var base = { cache: CACHES.pages, key: key, notify: false, shell: false }
    function swr(extra) {
      var o = { kind: fresh ? 'network-first' : 'swr' }
      for (var k in base) o[k] = base[k]
      for (k in extra || {}) o[k] = extra[k]
      return o
    }
    if (NEVER[rel]) return NETWORK
    if (rel.indexOf('api/') === 0) {
      return API_LISTS[rel] ? { kind: 'network-first', cache: CACHES.api, key: key, notify: false, shell: false } : NETWORK
    }
    if (/^(app\/)?assets\//.test(rel)) return { kind: 'cache-first', cache: CACHES.assets, key: key, notify: false, shell: false }
    if (rel === '' || rel === 'index.html') return swr({ key: s.origin + s.pathname, notify: true, shell: true })
    if (rel === 'app/' || rel === 'app/index.html') return swr({ key: s.origin + s.pathname + 'app/', notify: true, shell: true })
    if (MEDIA.test(rel)) return NETWORK
    if (r.mode === 'navigate' || rel.endsWith('/') || PAGE.test(rel)) return swr({ notify: true })
    if (STATIC.test(rel)) return swr()
    return NETWORK
  }

  function attrs(tag) {
    var out = {}, m, re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g
    while ((m = re.exec(tag))) out[m[1].toLowerCase()] = (m[2] != null ? m[2] : m[3] != null ? m[3] : m[4]).replace(/&amp;/g, '&')
    return out
  }

  function resolve(list, ref, base) {
    ref = (ref || '').trim()
    if (!ref || /^(data|blob|javascript|mailto|about):/i.test(ref)) return
    var u
    try {
      u = new URL(ref, base)
    } catch {
      return
    }
    if (u.origin !== new URL(base).origin || MEDIA.test(u.pathname)) return
    u.hash = ''
    if (list.indexOf(u.href) < 0) list.push(u.href)
  }

  /* The same-origin files a page loads (stylesheets, scripts, icons, the manifest, images, posters), not the pages it links.
     Tags inside a script's text or a comment are not loaded as such (the app shell writes its theme link from JS). */
  function refsOf(html, base) {
    var out = [], m, re = /<(link|script|img|source|video|input)\b[^>]*>/gi
    html = String(html).replace(/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi, '$1</script>').replace(/<!--[\s\S]*?-->/g, '')
    while ((m = re.exec(html))) {
      var tag = m[1].toLowerCase(), a = attrs(m[0])
      if (tag === 'link') {
        if (/(^|\s)(stylesheet|icon|apple-touch-icon|manifest|preload|modulepreload|mask-icon)(\s|$)/i.test(a.rel || '')) resolve(out, a.href, base)
      } else if (tag === 'video') resolve(out, a.poster, base)
      else {
        resolve(out, a.src, base)
        ;(a.srcset || '').split(',').forEach(function (c) { resolve(out, c.trim().split(/\s+/)[0], base) })
      }
    }
    return out
  }

  /* The files a stylesheet loads: url(...) and @import, relative to the stylesheet. */
  function cssRefs(css, base) {
    var out = [], m, re = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi
    while ((m = re.exec(css))) resolve(out, m[1] || m[2] || m[3] || m[4] || m[5], base)
    return out
  }

  /* A page without the review state the server puts in its head: comments synced elsewhere are not a new version. */
  function pageBody(html) {
    return String(html).replace(/<script>TutorSync\.page\([\s\S]*?\);<\/script>/g, '')
  }

  /* The cached app files ({name, text}) the shell still reaches, directly or through the CSS and JS it names. */
  function liveAssets(shell, files) {
    var keep = new Set(), texts = [shell], grew = true
    while (grew) {
      grew = false
      files.forEach(function (f) {
        if (keep.has(f.name) || !texts.some(function (t) { return t.indexOf(f.name) >= 0 })) return
        keep.add(f.name)
        if (f.text) texts.push(f.text)
        grew = true
      })
    }
    return keep
  }

  return { VERSION: VERSION, CACHES: CACHES, strategy: strategy, refsOf: refsOf, cssRefs: cssRefs, pageBody: pageBody, liveAssets: liveAssets }
})()

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function' && self.registration) {
  ;(function () {
    var SW = AgentPagesSW
    var scope = self.registration.scope
    var online = true

    function cacheable(res) {
      return !!res && res.status === 200 && res.type === 'basic' && !res.redirected
    }
    function strategyOf(req) {
      return SW.strategy({ url: req.url, method: req.method, range: req.headers.has('range'), mode: req.mode, cache: req.cache }, scope)
    }
    function post(msg) {
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
        cs.forEach(function (c) { c.postMessage(msg) })
      })
    }
    function net(ok) {
      if (ok === online) return
      online = ok
      post({ type: 'agent-pages:net', online: ok })
    }
    function fetchNet(input, init) {
      return fetch(input, init).then(
        function (res) { net(true); return res },
        function (e) { net(false); throw e },
      )
    }
    function lookup(s) {
      return caches.open(s.cache).then(function (c) {
        return c.match(s.key).then(function (hit) {
          return hit || (s.cache === SW.CACHES.pages ? c.match(s.key, { ignoreSearch: true }) : undefined)
        })
      })
    }
    function store(s, res) {
      if (!cacheable(res)) return Promise.resolve(false)
      var copy = res.clone()
      return caches.open(s.cache).then(function (c) { return c.put(s.key, copy) }).then(function () {
        if (s.notify && !s.shell) post({ type: 'agent-pages:saved', url: s.key })
        return true
      }, function () { return false })
    }
    function offlinePage() {
      var body = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
        '<title>Offline</title><body style="font:15px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1.25rem;color:#555">' +
        '<p><b>Offline.</b> This page was not saved on this device: open it once with a connection, or use Download for offline.</p>'
      return new Response(body, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
    function fail(req) {
      return req.mode === 'navigate' ? offlinePage() : Response.error()
    }

    /* The app's files the shell reaches stay; older builds' files go (only under the shell's own assets/ folder). */
    function prune(shellUrl, html) {
      var dir = new URL('assets/', shellUrl).href
      return caches.open(SW.CACHES.assets).then(function (c) {
        return c.keys().then(function (keys) {
          var mine = keys.filter(function (k) { return k.url.indexOf(dir) === 0 })
          return Promise.all(mine.map(function (k) {
            var name = k.url.slice(dir.length)
            if (!/\.(css|js|mjs)$/.test(name)) return { name: name, req: k }
            return c.match(k).then(function (r) { return r ? r.text() : '' }).then(function (t) { return { name: name, text: t, req: k } })
          })).then(function (files) {
            var keep = SW.liveAssets(html, files)
            return Promise.all(files.filter(function (f) { return !keep.has(f.name) }).map(function (f) { return c.delete(f.req) }))
          })
        })
      })
    }

    /* The files a new shell names, cached before the shell itself, so the new version also works offline.
       Only a hashed asset (cache-first) the new build needs and cannot get fails the update; the rest is best effort. */
    function cacheShellFiles(shellUrl, html) {
      return Promise.all(SW.refsOf(html, shellUrl).map(function (u) {
        var s = SW.strategy({ url: u, method: 'GET' }, scope)
        if (s.kind === 'network') return true
        var job = lookup(s).then(function (hit) {
          return hit || fetch(u).then(function (res) {
            if (!cacheable(res)) throw new Error('could not cache ' + u)
            return store(s, res).then(function (ok) {
              if (!ok) throw new Error('could not cache ' + u)
              return true
            })
          })
        })
        return s.kind === 'cache-first' ? job : job.catch(function () { return false })
      }))
    }

    /* Ask the server whether the cached copy is current (If-None-Match); store and announce a changed one. */
    function revalidate(s, cached) {
      var etag = cached.headers.get('ETag')
      return fetchNet(s.key, { headers: etag ? { 'If-None-Match': etag } : {}, cache: 'no-store', credentials: 'same-origin' })
        .then(function (res) {
          if (res.status === 304 || !cacheable(res)) return
          if (!s.notify) return store(s, res)
          return Promise.all([cached.text(), res.clone().text()]).then(function (t) {
            var changed = SW.pageBody(t[0]) !== SW.pageBody(t[1])
            var ready = changed && s.shell ? cacheShellFiles(s.key, t[1]) : Promise.resolve()
            return ready.then(function () { return store(s, res) }).then(function () {
              if (!changed) return
              if (s.shell) prune(s.key, t[1]).catch(function () {})
              return post({ type: 'agent-pages:updated', url: s.key, shell: s.shell })
            })
          })
        })
        .catch(function () {})
    }

    /* A page the reader opened is the reader's: auto no longer evicts it (auto's own requests do not pass here). */
    function handle(e, s) {
      var res = serve(e, s)
      if (e.request.mode !== 'navigate' || !s.notify || s.shell) return res
      return res.then(function (r) {
        if (r && r.status === 200) e.waitUntil(updateAuto(function (rec) {
          if (!rec.pages[s.key]) return false
          delete rec.pages[s.key]
        }).catch(function () {}))
        return r
      })
    }

    function serve(e, s) {
      var req = e.request
      if (s.kind === 'cache-first') {
        return lookup(s).then(function (hit) {
          return hit || fetchNet(req).then(function (res) { e.waitUntil(store(s, res)); return res })
        }).catch(function () { return fail(req) })
      }
      if (s.kind === 'network-first') {
        return fetchNet(req)
          .then(function (res) { e.waitUntil(store(s, res)); return res })
          .catch(function () { return lookup(s).then(function (hit) { return hit || fail(req) }) })
      }
      return lookup(s).then(function (hit) {
        if (hit) {
          e.waitUntil(revalidate(s, hit.clone())) // a copy: the page reads hit's body before the server answers
          return hit
        }
        return fetchNet(req).then(function (res) { e.waitUntil(store(s, res)); return res }, function () { return fail(req) })
      })
    }

    function size(res) {
      var n = Number(res.headers.get('Content-Length'))
      return n > 0 ? Promise.resolve(n) : res.clone().blob().then(function (b) { return b.size })
    }

    /* The record: pages, the pages auto saved that were not in the cache before, each with the files it added
       ({pageUrl: [fileUrl]}); manual, the pages saved with Download ({pageUrl: 1}), which auto never takes back.
       Updates run one after the other; a change that returns false writes nothing. */
    var AUTO_KEY = new URL('.agent-pages-auto.json', scope).href
    var autoQueue = Promise.resolve()
    function readAuto() {
      return caches.open(SW.CACHES.meta).then(function (c) { return c.match(AUTO_KEY) })
        .then(function (r) { return r ? r.text().then(function (t) { return JSON.parse(t) }) : null })
        .catch(function () { return null })
        .then(function (r) {
          r = r && typeof r === 'object' ? r : {}
          if (r.pages && typeof r.pages === 'object') return { pages: r.pages, manual: r.manual || {} }
          var pages = {} // the first layout, {pageUrl: [fileUrl]}
          Object.keys(r).forEach(function (k) { if (Array.isArray(r[k])) pages[k] = r[k] })
          return { pages: pages, manual: {} }
        })
    }
    function updateAuto(change) {
      var job = autoQueue.then(function () {
        return readAuto().then(function (rec) {
          return Promise.resolve(change(rec)).then(function (r) {
            if (r === false) return
            var body = new Response(JSON.stringify(rec), { headers: { 'Content-Type': 'application/json' } })
            return caches.open(SW.CACHES.meta).then(function (c) { return c.put(AUTO_KEY, body) })
          })
        })
      })
      autoQueue = job.catch(function () {})
      return job
    }

    /* Download pages for offline reading: each page fresh, then what it references (and what its CSS references),
       skipping what is cached already; stops adding once the new bytes would pass the budget.
       The pages are the reader's from now on: auto no longer evicts them. */
    function prefetch(urls, budget) {
      var out = { pages: 0, files: 0, bytes: 0, skipped: [], failed: [] }
      var seen = new Set(), keys = []
      budget = budget > 0 ? budget : 50e6
      function one(u, page) {
        if (seen.has(u)) return Promise.resolve(null)
        seen.add(u)
        var s = SW.strategy({ url: u, method: 'GET', mode: page ? 'navigate' : undefined }, scope)
        if (s.kind === 'network') return Promise.resolve(null)
        var known = page ? Promise.resolve(null) : lookup(s)
        return known.then(function (hit) {
          if (hit) return null
          return fetchNet(u, { cache: 'no-cache', credentials: 'same-origin' }).then(function (res) {
            if (!cacheable(res)) { out.failed.push(u); return null }
            return size(res).then(function (n) {
              if (out.bytes + n > budget) { out.skipped.push(u); return null }
              return store(s, res).then(function () {
                out.bytes += n
                if (page) out.pages++
                else out.files++
                var type = res.headers.get('Content-Type') || ''
                return /text\/(html|css)/.test(type) ? res.text().then(function (t) { return { url: u, type: type, text: t } }) : null
              })
            })
          })
        }).catch(function () { out.failed.push(u); return null })
      }
      function refs(doc) {
        if (!doc) return Promise.resolve()
        var list = /css/.test(doc.type) ? SW.cssRefs(doc.text, doc.url) : SW.refsOf(doc.text, doc.url)
        return list.reduce(function (p, u) {
          return p.then(function () { return one(u, false).then(refs) })
        }, Promise.resolve())
      }
      return urls.reduce(function (p, raw) {
        return p.then(function () {
          var u = new URL(raw, scope)
          u.hash = ''
          keys.push(u.href)
          return one(u.href, true).then(refs)
        })
      }, Promise.resolve()).then(function () {
        return updateAuto(function (rec) {
          keys.forEach(function (k) {
            delete rec.pages[k]
            rec.manual[k] = 1
          })
        }).catch(function () {})
      }).then(function () { return out })
    }

    /* Every Open page saved (agent-pages:auto, see the top of the file). */
    var autoRunning = false
    function autoSave(urls, budget) {
      if (autoRunning) return Promise.resolve({ busy: true })
      autoRunning = true
      budget = budget > 0 ? budget : 150e6
      var pages = []
      ;(urls || []).forEach(function (raw) {
        try {
          var u = new URL(raw, scope)
          u.hash = ''
          if (pages.indexOf(u.href) < 0) pages.push(u.href)
        } catch {
          /* not a URL */
        }
      })
      var out = { pages: pages.length, saved: 0, unchanged: 0, bytes: 0, notSaved: [], failed: [], evicted: [] }
      var counted = new Set(), seen = new Set(), added = {}, stop = false, done = 0, next = 0
      function progress(running) {
        post({ type: 'agent-pages:progress', done: done, total: pages.length, running: running })
      }
      /* the bytes of u go into the list's total, once; false (and the run stops) when they would pass the budget */
      function count(u, n) {
        if (counted.has(u)) return true
        if (out.bytes + n > budget) {
          stop = true
          return false
        }
        counted.add(u)
        out.bytes += n
        return true
      }
      function files(list, owner) {
        return list.reduce(function (p, u) { return p.then(function () { return file(u, owner) }) }, Promise.resolve())
      }
      function file(u, owner) {
        if (stop || seen.has(u)) return Promise.resolve()
        seen.add(u)
        var s = SW.strategy({ url: u, method: 'GET' }, scope)
        if (s.kind === 'network') return Promise.resolve()
        return lookup(s).then(function (hit) {
          if (hit) return size(hit).then(function (n) { count(u, n) }) // saved already: it counts, nothing is asked
          return fetchNet(u, { cache: 'no-cache', credentials: 'same-origin' }).then(function (res) {
            if (!cacheable(res)) return
            return size(res).then(function (n) {
              if (!count(u, n)) return
              return store(s, res).then(function (ok) {
                if (!ok) return
                if (added[owner]) added[owner].push(s.key)
                if (/text\/css/.test(res.headers.get('Content-Type') || '')) return res.text().then(function (t) { return files(SW.cssRefs(t, u), owner) })
              })
            })
          })
        }).catch(function () {})
      }
      function page(u, rec) {
        if (stop) {
          out.notSaved.push(u)
          return Promise.resolve()
        }
        var s = SW.strategy({ url: u, method: 'GET', mode: 'navigate' }, scope)
        if (s.kind === 'network' || s.shell) {
          out.failed.push(u)
          return Promise.resolve()
        }
        return lookup(s).then(function (hit) {
          var etag = hit && hit.headers.get('ETag')
          return fetchNet(s.key, { headers: etag ? { 'If-None-Match': etag } : {}, cache: 'no-store', credentials: 'same-origin' }).then(function (res) {
            if (res.status === 304 && hit) {
              return size(hit).then(function (n) {
                if (!count(u, n)) {
                  out.notSaved.push(u) // past the budget: evicted below if auto saved it
                  return null
                }
                out.unchanged++
                return hit.text()
              })
            }
            if (!cacheable(res)) {
              out.failed.push(u)
              return null
            }
            return size(res).then(function (n) {
              if (!count(u, n)) {
                out.notSaved.push(u)
                return null
              }
              return store(s, res).then(function (ok) {
                if (!ok) {
                  out.failed.push(u)
                  return null
                }
                out.saved++
                if (!hit || rec.pages[s.key]) added[s.key] = []
                return res.text()
              })
            })
          })
        }).then(function (html) {
          if (html) return files(SW.refsOf(html, s.key), s.key)
        }).catch(function () { out.failed.push(u) })
      }
      /* the pages auto saved that are no longer in the list, or still in it but past the budget this run, go, with the
         files they added that no saved page uses; a page that could not be reached (out.failed) keeps its copy */
      function evict(rec) {
        var open = new Set(pages), over = new Set(out.notSaved), failed = new Set(out.failed)
        var gone = Object.keys(rec.pages).filter(function (u) {
          return !rec.manual[u] && (!open.has(u) || (over.has(u) && !failed.has(u)))
        })
        if (!gone.length) return Promise.resolve()
        return caches.open(SW.CACHES.pages).then(function (c) {
          return Promise.all(gone.map(function (u) { return c.delete(u) }))
            .then(cachedPages)
            .then(function (left) {
              var keep = new Set()
              return Promise.all(left.map(function (u) {
                return c.match(u).then(function (r) { return r ? r.text() : '' }).then(function (t) {
                  SW.refsOf(t, u).forEach(function (f) { keep.add(f) })
                })
              })).then(function () {
                var css = []
                keep.forEach(function (f) { if (/\.css$/i.test(new URL(f).pathname)) css.push(f) })
                return Promise.all(css.map(function (f) {
                  return c.match(f).then(function (r) { return r ? r.text() : '' }).then(function (t) {
                    SW.cssRefs(t, f).forEach(function (x) { keep.add(x) })
                  })
                }))
              }).then(function () { return keep })
            })
            .then(function (keep) {
              var drop = []
              gone.forEach(function (g) {
                ;(rec.pages[g] || []).forEach(function (f) { if (!keep.has(f) && drop.indexOf(f) < 0) drop.push(f) })
                delete rec.pages[g]
                out.evicted.push(g)
              })
              return Promise.all(drop.map(function (f) { return c.delete(f) }))
            })
        })
      }
      progress(true)
      return readAuto().then(function (rec) {
        function lane() {
          if (next >= pages.length) return Promise.resolve()
          var u = pages[next++]
          return page(u, rec).then(function () {
            done++
            progress(true)
          }).then(lane)
        }
        return Promise.all([lane(), lane()])
      }).then(function () {
        return updateAuto(function (rec) {
          Object.keys(added).forEach(function (k) {
            if (rec.manual[k]) return // saved with Download meanwhile: the reader's
            var had = rec.pages[k] || []
            added[k].forEach(function (f) { if (had.indexOf(f) < 0) had.push(f) })
            rec.pages[k] = had
          })
          return evict(rec)
        })
      }).then(function () { return out }).finally(function () {
        autoRunning = false
        progress(false)
      })
    }

    /* What the app (and its iframe) loaded before this worker took control: cached now, mostly from the HTTP cache. */
    function warm(urls) {
      return Promise.all((urls || []).map(function (u) {
        var s = SW.strategy({ url: u, method: 'GET', mode: PAGEISH(u) ? 'navigate' : undefined }, scope)
        if (s.kind === 'network') return null
        return lookup(s).then(function (hit) {
          return hit || fetch(s.key, { credentials: 'same-origin' }).then(function (res) { return store(s, res) })
        }).catch(function () {})
      }))
    }
    function PAGEISH(u) {
      var p = new URL(u).pathname
      return /\/$|\.html?$/i.test(p)
    }

    function cachedPages() {
      return caches.open(SW.CACHES.pages).then(function (c) { return c.keys() }).then(function (keys) {
        return keys.map(function (k) { return k.url }).filter(function (u) {
          var s = SW.strategy({ url: u, method: 'GET' }, scope)
          return s.notify && !s.shell
        })
      })
    }

    self.addEventListener('install', function () {
      self.skipWaiting()
    })
    self.addEventListener('activate', function (e) {
      var mine = Object.keys(SW.CACHES).map(function (k) { return SW.CACHES[k] })
      e.waitUntil(caches.keys().then(function (names) {
        return Promise.all(names.filter(function (n) { return n.indexOf('agent-pages-') === 0 && mine.indexOf(n) < 0 }).map(function (n) { return caches.delete(n) }))
      }).then(function () { return self.clients.claim() }))
    })
    self.addEventListener('fetch', function (e) {
      var s = strategyOf(e.request)
      if (s.kind === 'network') return
      e.respondWith(handle(e, s))
    })
    self.addEventListener('message', function (e) {
      var d = e.data || {}, port = e.ports && e.ports[0]
      var reply = function (v) { if (port) port.postMessage(v) }
      var job
      if (d.type === 'agent-pages:prefetch') job = prefetch(d.urls || [], d.budget)
      else if (d.type === 'agent-pages:auto') job = autoSave(d.urls || [], d.budget)
      else if (d.type === 'agent-pages:warm') job = warm(d.urls).then(function () { return { ok: true } })
      else if (d.type === 'agent-pages:cached') job = cachedPages().then(function (urls) { return { urls: urls, online: online } })
      else return
      e.waitUntil(job.then(reply, function (err) { reply({ error: String((err && err.message) || err) }) }))
    })
  })()
}
