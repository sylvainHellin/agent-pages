// apps/ui/public/sw.js outside a browser: the pure parts of the service worker (which request gets which strategy,
// what a page links, what counts as a change, which cached app assets are still used).
//     node --test tests/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SRC = readFileSync(new URL('../apps/ui/public/sw.js', import.meta.url), 'utf8')
const SW = vm.runInNewContext(`${SRC}\n;AgentPagesSW`, { URL, console })
const SCOPE = 'https://box.ts.net:8443/'

const req = (path, o = {}) => ({ url: new URL(path, SCOPE).href, method: 'GET', ...o })
const kind = (path, o) => SW.strategy(req(path, o), SCOPE).kind

test('hashed app assets are cache-first, at / and at /app/', () => {
  const s = SW.strategy(req('assets/index-D1PkVmLT.js'), SCOPE)
  assert.equal(s.kind, 'cache-first')
  assert.equal(s.cache, SW.CACHES.assets)
  assert.equal(kind('app/assets/index-Cj6y10zR.css'), 'cache-first')
  assert.equal(kind('assets/x.woff2', { cache: 'reload' }), 'cache-first') // immutable: a reload changes nothing
})

test('the app shell is stale-while-revalidate, one entry per entry point', () => {
  for (const [path, key] of [['', ''], ['index.html', ''], ['app/', 'app/'], ['app/index.html', 'app/']]) {
    const s = SW.strategy(req(path, { mode: 'navigate' }), SCOPE)
    assert.equal(s.kind, 'swr', path)
    assert.equal(s.key, SCOPE + key, path)
    assert.equal(s.shell, true, path)
    assert.equal(s.notify, true, path)
  }
  assert.equal(SW.strategy(req('app/manifest.webmanifest'), SCOPE).kind, 'swr')
  assert.equal(SW.strategy(req('icon-180.png'), SCOPE).shell, false)
})

test('pages, template files, images and fonts are stale-while-revalidate; only pages report changes', () => {
  const page = SW.strategy(req('code/side-projects/agent-pages/sync/plan.html', { mode: 'navigate' }), SCOPE)
  assert.deepEqual([page.kind, page.cache, page.notify, page.shell], ['swr', SW.CACHES.pages, true, false])
  assert.equal(SW.strategy(req('lessons/2026-01-02_x/'), SCOPE).notify, true) // a lesson, even prefetched without navigate
  for (const p of ['_template/report.css', '_template/report.js', '_template/review-sync.js', '_template/fonts/serif-kr.woff2',
    'lessons/_assets/report.css', 'documents/area/figures/chart.png', 'documents/a/fig.svg', 'favicon.png']) {
    const s = SW.strategy(req(p), SCOPE)
    assert.deepEqual([s.kind, s.notify], ['swr', false], p)
  }
})

test('a reload asks the network first and keeps the cached copy for offline', () => {
  for (const cache of ['no-cache', 'reload', 'no-store']) {
    const s = SW.strategy(req('documents/a/page.html', { mode: 'navigate', cache }), SCOPE)
    assert.equal(s.kind, 'network-first', cache)
    assert.equal(s.cache, SW.CACHES.pages, cache)
  }
  assert.equal(kind('_template/report.css', { cache: 'no-cache' }), 'network-first')
})

test('the API is never cached, except the lists the app shows offline', () => {
  for (const p of ['api/items', 'api/projects', 'api/theme.css']) {
    const s = SW.strategy(req(p), SCOPE)
    assert.deepEqual([s.kind, s.cache], ['network-first', SW.CACHES.api], p)
  }
  // api/pages and api/lessons were the lists before the one list (api/items); the server answers 404 now
  for (const p of ['api/pages', 'api/lessons', 'api/lessons?project=x', 'api/inbox', 'api/reviews/doc-1', 'api/lessons/x/review',
    'api/pages/status?url=/a.html', 'api/jobs/1/log',
    'healthz', 'index.json', 'sw.js']) {
    assert.equal(kind(p), 'network', p)
  }
})

test('never cached: other methods, ranges, other origins, paths outside the scope, media', () => {
  assert.equal(kind('api/pages', { method: 'POST' }), 'network')
  assert.equal(kind('documents/a/page.html', { method: 'HEAD' }), 'network')
  assert.equal(kind('documents/a/clip.png', { range: true }), 'network')
  assert.equal(SW.strategy({ url: 'https://fonts.example.com/x.woff2', method: 'GET' }, SCOPE).kind, 'network')
  assert.equal(SW.strategy(req('/other/page.html'), 'https://box.ts.net:8443/tutor/').kind, 'network')
  assert.equal(SW.strategy(req('/tutor/assets/a-1.js'), 'https://box.ts.net:8443/tutor/').kind, 'cache-first')
  for (const p of ['documents/a/clip.mp4', 'documents/a/clip.webm', 'documents/a/talk.mp3', 'documents/a/notes.py']) {
    assert.equal(kind(p), 'network', p)
  }
})

test('refsOf: the same-origin files a page loads, not the pages it links', () => {
  const html = `<!doctype html><html><head>
<link rel="stylesheet" href="/_template/report.css"><link rel=icon href='/_template/favicon.png'>
<script src="/_template/review-sync.js"></script><script src="/_template/report.js" defer></script>
<link rel="preconnect" href="https://fonts.example.com"><link rel="alternate" href="other.html">
</head><body>
<img src="figures/chart.png" alt=""> <img srcset="figures/a.png 1x, figures/a@2x.png 2x" src="figures/a.png">
<picture><source srcset="figures/b.webp" type="image/webp"><img src="figures/b.png"></picture>
<video src="figures/clip.mp4" poster="figures/poster.jpg"></video>
<img src="data:image/png;base64,AAAA"> <img src="https://cdn.example.com/x.png">
<a href="other.html">next</a> <a href="figures/big.png">full size</a>
</body></html>`
  const got = SW.refsOf(html, SCOPE + 'documents/area/page.html')
  const rel = Array.from(got, (u) => u).map((u) => u.slice(SCOPE.length)).sort()
  assert.deepEqual(rel, [
    '_template/favicon.png', '_template/report.css', '_template/report.js', '_template/review-sync.js',
    'documents/area/figures/a.png', 'documents/area/figures/a@2x.png', 'documents/area/figures/b.png',
    'documents/area/figures/b.webp', 'documents/area/figures/chart.png', 'documents/area/figures/poster.jpg',
  ])
})

test('refsOf: tags written inside a script are not references (the app shell writes its theme link from JS)', () => {
  const inline = `<head><script>
  var base = './'
  document.write('<link rel="stylesheet" id="app-theme-css" href="' + base + 'api/theme.css">')
  var s = "<script src='x.js'><\\/script>"
</script><script type="module" crossorigin src="./assets/index-ABC.js"></script>
<link rel="stylesheet" crossorigin href="./assets/index-DEF.css"></head>`
  const real = readFileSync(new URL('../apps/ui/index.html', import.meta.url), 'utf8')
  for (const html of [inline, real]) {
    const got = SW.refsOf(html, SCOPE)
    for (const u of got) assert.ok(!/'|%20\+%20|%27/.test(u), u)
  }
  const got = Array.from(SW.refsOf(inline, SCOPE), (u) => u.slice(SCOPE.length)).sort()
  assert.deepEqual(got, ['assets/index-ABC.js', 'assets/index-DEF.css'])
})

test('cssRefs: url() files relative to the stylesheet, data: skipped', () => {
  const css = `@font-face{src:url("fonts/serif-kr.woff2") format("woff2")} .a{background:url(data:image/svg+xml,%3Csvg%3E)}
  .b{background:url('../img/x.png')} @import url("themes/tum.css");`
  const got = Array.from(SW.cssRefs(css, SCOPE + "_template/report.css")).map((u) => u.slice(SCOPE.length)).sort()
  assert.deepEqual(got, ['_template/fonts/serif-kr.woff2', '_template/themes/tum.css', 'img/x.png'])
})

test('pageBody: a new review state alone is not a new version of the page', () => {
  const page = (state, text) => `<head><meta charset="utf-8">
<script src="/_template/review-sync.js"></script>
<script>TutorSync.page({"api": "/api/", "path": "reviews/d", "state": ${state}});</script>
<title>T</title></head><body>${text}</body>`
  const a = page('{"updated": 1, "data": {}}', 'Answer.')
  assert.equal(SW.pageBody(a), SW.pageBody(page('{"updated": 7, "data": {"c": [{"id": "x"}]}}', 'Answer.')))
  assert.notEqual(SW.pageBody(a), SW.pageBody(page('{"updated": 1, "data": {}}', 'Revised answer.')))
})

test('liveAssets: cached app files the current shell still reaches, directly or through its CSS and JS', () => {
  const shell = '<script type="module" src="./assets/index-NEW.js"></script><link rel="stylesheet" href="./assets/index-NEW.css">'
  const files = [
    { name: 'index-NEW.js', text: 'import("./Chunk-AAA.js")' },
    { name: 'index-NEW.css', text: '@font-face{src:url(./Pretendard.0-BBB.woff2)}' },
    { name: 'Chunk-AAA.js', text: 'export {}' },
    { name: 'Pretendard.0-BBB.woff2' },
    { name: 'index-OLD.js', text: 'import("./Chunk-OLD.js")' },
    { name: 'Chunk-OLD.js', text: '' },
    { name: 'index-OLD.css', text: '' },
  ]
  assert.deepEqual([...SW.liveAssets(shell, files)].sort(), ['Chunk-AAA.js', 'Pretendard.0-BBB.woff2', 'index-NEW.css', 'index-NEW.js'])
})

// The worker itself, with stubbed caches, fetch and clients. files: path under the scope -> body, or {body, etag, type};
// the server answers 304 to a request with the file's ETag in If-None-Match, and nothing at all while w.down is true.
const typeOf = (rel) => (/\.css$/.test(rel) ? 'text/css' : /\.m?js$/.test(rel) ? 'text/javascript' : /\.(png|jpe?g|webp|svg)$/.test(rel) ? 'image/png'
  : /^api\//.test(rel) ? 'application/json' : 'text/html')
function worker(files) {
  const stores = new Map()
  const posted = []
  const listeners = {}
  const fetched = [] // [path, If-None-Match] of every request that reached the server
  const res = (body, { status = 200, etag = null, type = 'text/html' } = {}) => ({
    status, type: 'basic', redirected: false, body,
    headers: {
      get: (h) => ({ etag, 'content-type': type, 'content-length': status === 200 ? String(body.length) : null })[h.toLowerCase()] ?? null,
    },
    clone: () => res(body, { status, etag, type }),
    text: async () => body,
  })
  class Response {
    constructor(body, init = {}) {
      const h = init.headers || {}
      return res(String(body ?? ''), { status: init.status || 200, type: h['Content-Type'] || 'text/plain' })
    }
  }
  const urlOf = (k) => (typeof k === 'string' ? k : k.url)
  const cache = (name) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const m = stores.get(name)
    return {
      match: async (k) => m.get(urlOf(k)),
      put: async (k, r) => { m.set(urlOf(k), r) },
      keys: async () => [...m.keys()].map((url) => ({ url })),
      delete: async (k) => m.delete(urlOf(k)),
    }
  }
  const self = {
    registration: { scope: SCOPE },
    addEventListener: (t, f) => { listeners[t] = f },
    skipWaiting: () => {},
    clients: { matchAll: async () => [{ postMessage: (m) => posted.push(m) }], claim: async () => {} },
  }
  const w = { down: false }
  const fetch = async (u, init = {}) => {
    const rel = new URL(urlOf(u)).pathname.slice(1)
    const inm = (init.headers || {})['If-None-Match'] || null
    if (w.down) throw new TypeError('Failed to fetch')
    fetched.push([rel, inm])
    if (!(rel in files)) return res('not found', { status: 404 })
    const f = typeof files[rel] === 'string' ? { body: files[rel] } : files[rel]
    const etag = f.etag || '"new"'
    if (inm === etag) return res('', { status: 304, etag })
    return res(f.body, { etag, type: f.type || typeOf(rel) })
  }
  vm.runInNewContext(SRC, { URL, console, Set, Promise, JSON, Response, self, caches: { open: async (n) => cache(n), keys: async () => [...stores.keys()] }, fetch })
  const settle = async (waits) => {
    for (let i = 0; i < waits.length; i++) await waits[i]
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  }
  return Object.assign(w, {
    posted,
    fetched,
    files,
    put: (name, key, body, etag, type) => cache(name).put(key, res(body, { etag, type: type || typeOf(new URL(key).pathname.slice(1)) })),
    text: async (name, key) => (await cache(name).match(key))?.body,
    keys: async (name) => (await cache(name).keys()).map((k) => k.url),
    // a message from the app, answered on its port
    ask: async (data) => {
      const waits = []
      let answer
      const got = new Promise((r) => { answer = r })
      listeners.message({ data, ports: [{ postMessage: answer }], waitUntil: (p) => waits.push(p) })
      if (!waits.length) return undefined
      const out = await got
      await settle(waits)
      return out
    },
    // a request from the app (fetch(), cache mode no-store like api.ts) or a page; resolves to the response
    request: async (url, { mode = 'cors', cache: c = 'no-store' } = {}) => {
      const waits = []
      let response
      listeners.fetch({
        request: { url, method: 'GET', mode, cache: c, headers: { has: () => false } },
        respondWith: (p) => { response = p },
        waitUntil: (p) => waits.push(p),
      })
      if (!response) return fetch(url)
      const r = await response
      await settle(waits)
      return r
    },
    // a navigation to the shell, served from the cache; resolves once the background revalidation is done
    open: async (url) => {
      const waits = []
      let response
      listeners.fetch({
        request: { url, method: 'GET', mode: 'navigate', cache: 'default', headers: { has: () => false } },
        respondWith: (p) => { response = p },
        waitUntil: (p) => waits.push(p),
      })
      await response
      await settle(waits)
    },
  })
}

const NEW_SHELL = `<!doctype html><head><link rel="icon" href="./favicon.png"><link rel="apple-touch-icon" href="./icon-180.png">
<link rel="manifest" href="./app/manifest.webmanifest"><link rel="stylesheet" href="./api/theme.css">
<script type="module" crossorigin src="./assets/index-NEW.js"></script></head><body></body>`

test('a new shell is stored and announced although its icon, manifest and theme answer 404 (best effort)', async () => {
  const w = worker({ '': NEW_SHELL, 'assets/index-NEW.js': 'export {}' })
  await w.put(SW.CACHES.pages, SCOPE, '<!doctype html>old shell', '"old"')
  await w.open(SCOPE)
  assert.equal(await w.text(SW.CACHES.pages, SCOPE), NEW_SHELL)
  assert.equal(await w.text(SW.CACHES.assets, SCOPE + 'assets/index-NEW.js'), 'export {}')
  assert.deepEqual(w.posted.filter((m) => m.type === 'agent-pages:updated').map((m) => [m.url, m.shell]), [[SCOPE, true]])
})

test('a new shell whose hashed asset cannot be cached is neither stored nor announced (it would not work offline)', async () => {
  const w = worker({ '': NEW_SHELL, 'favicon.png': 'png', 'icon-180.png': 'png', 'app/manifest.webmanifest': '{}', 'api/theme.css': '' })
  await w.put(SW.CACHES.pages, SCOPE, '<!doctype html>old shell', '"old"')
  await w.open(SCOPE)
  assert.equal(await w.text(SW.CACHES.pages, SCOPE), '<!doctype html>old shell')
  assert.deepEqual(w.posted.filter((m) => m.type === 'agent-pages:updated'), [])
})

// The lists the app's first screen loads (store.ts loadPages) and the ones it asks the worker to keep after a fresh
// install (offline.ts LISTS, sent with agent-pages:warm once the worker controls the app).
const STORE = readFileSync(new URL('../apps/ui/src/lib/store.ts', import.meta.url), 'utf8')
const OFFLINE = readFileSync(new URL('../apps/ui/src/lib/offline.ts', import.meta.url), 'utf8')
const loadPagesSrc = STORE.slice(STORE.indexOf('async loadPages()'), STORE.indexOf('async loadInbox()'))
const LIST_CALLS = [...loadPagesSrc.matchAll(/api<[^>]*>\('([\w/.-]+)'\)/g)].map((m) => `api/${m[1]}`).sort()
const LISTS = [...OFFLINE.match(/const LISTS = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()

test('after a fresh install, with the network down, the lists the app loads come from the cache', async () => {
  assert.ok(LIST_CALLS.includes('api/items'), LIST_CALLS.join())
  assert.deepEqual(LISTS, LIST_CALLS)
  const w = worker({ 'api/items': '{"items":[{"id":"a"}]}', 'api/projects': '{"projects":[]}' })
  await w.ask({ type: 'agent-pages:warm', urls: [SCOPE, ...LISTS.map((p) => SCOPE + p)] })
  w.down = true
  for (const p of LIST_CALLS) {
    const r = await w.request(SCOPE + p)
    assert.equal(r.status, 200, p)
    assert.equal(await r.text(), w.files[p], p)
  }
  assert.deepEqual(w.fetched.map((f) => f[0]).filter((p) => /api\/(pages|lessons)$/.test(p)), [], 'no request for the lists that are gone')
})
