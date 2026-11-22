// apps/ui/public/sw.js outside a browser: the pure parts of the service worker (which request gets which strategy,
// what a page links, what counts as a change, which cached app assets are still used).
//     node --test tests/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
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
// the server answers 304 to a request with the file's ETag in If-None-Match, and nothing at all while w.down is true
// (or, for one file, while its down is true); a file with a wait promise answers once it resolves.
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
  const w = { down: false, slow: false, inFlight: 0, maxInFlight: 0 }
  const fetch = async (u, init = {}) => {
    const rel = new URL(urlOf(u)).pathname.slice(1)
    const inm = (init.headers || {})['If-None-Match'] || null
    if (w.down) throw new TypeError('Failed to fetch')
    fetched.push([rel, inm])
    if (w.slow) {
      w.maxInFlight = Math.max(w.maxInFlight, ++w.inFlight)
      await new Promise((r) => setTimeout(r, 2))
      w.inFlight--
    }
    if (!(rel in files)) return res('not found', { status: 404 })
    const f = typeof files[rel] === 'string' ? { body: files[rel] } : files[rel]
    if (f.down) throw new TypeError('Failed to fetch')
    if (f.wait) await f.wait
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

// Every Open page downloaded (agent-pages:auto): the app sends the URLs of the pages whose status is open, newest first.
const pageHtml = (img, pad = '') => `<!doctype html><head><link rel="stylesheet" href="/_template/report.css"></head><body>${pad}<img src="${img}"></body>`
const auto = (w, paths, budget) => w.ask({ type: 'agent-pages:auto', urls: paths.map((p) => SCOPE + p), budget })
const pagesCached = async (w) => (await w.keys(SW.CACHES.pages)).map((u) => u.slice(SCOPE.length)).sort()

test('auto: every open page is saved with its images and stylesheets, two requests at a time, with progress', async () => {
  const files = { '_template/report.css': 'body{}' }
  for (let i = 1; i <= 5; i++) {
    files[`documents/a/p${i}.html`] = pageHtml(`img/p${i}.png`)
    files[`documents/a/img/p${i}.png`] = 'PNG'
  }
  const w = worker(files)
  w.slow = true
  const r = await auto(w, [1, 2, 3, 4, 5].map((i) => `documents/a/p${i}.html`))
  assert.equal(r.saved, 5)
  assert.deepEqual([...r.notSaved], [])
  assert.deepEqual(await pagesCached(w), ['_template/report.css', ...[1, 2, 3, 4, 5].flatMap((i) => [`documents/a/img/p${i}.png`, `documents/a/p${i}.html`])].sort())
  assert.equal(w.maxInFlight, 2)
  const progress = w.posted.filter((m) => m.type === 'agent-pages:progress')
  assert.deepEqual({ ...progress.at(-1) }, { type: 'agent-pages:progress', done: 5, total: 5, running: false })
  assert.ok(progress.some((m) => m.running && m.done < 5))
})

test('auto: a page cached with the ETag the server still has is not downloaded again (conditional request)', async () => {
  const files = {
    '_template/report.css': 'body{}',
    'documents/a/same.html': { body: pageHtml('img/s.png'), etag: '"s1"' },
    'documents/a/img/s.png': 'PNG',
    'documents/a/changed.html': { body: pageHtml('img/c2.png', 'v2'), etag: '"c2"' },
    'documents/a/img/c2.png': 'PNG2',
  }
  const w = worker(files)
  await w.put(SW.CACHES.pages, SCOPE + 'documents/a/same.html', pageHtml('img/s.png'), '"s1"')
  await w.put(SW.CACHES.pages, SCOPE + 'documents/a/img/s.png', 'PNG', '"x"')
  await w.put(SW.CACHES.pages, SCOPE + '_template/report.css', 'body{}', '"x"')
  await w.put(SW.CACHES.pages, SCOPE + 'documents/a/changed.html', pageHtml('img/c1.png', 'v1'), '"c1"')
  const r = await auto(w, ['documents/a/same.html', 'documents/a/changed.html'])
  assert.deepEqual(w.fetched, [['documents/a/same.html', '"s1"'], ['documents/a/changed.html', '"c1"'], ['documents/a/img/c2.png', null]])
  assert.equal(r.unchanged, 1)
  assert.equal(await w.text(SW.CACHES.pages, SCOPE + 'documents/a/changed.html'), files['documents/a/changed.html'].body)
})

test('auto: past the budget it stops; the rest is not saved and not even asked for', async () => {
  const files = {}
  for (let i = 1; i <= 6; i++) files[`documents/a/b${i}.html`] = `<!doctype html><body>${'x'.repeat(80)}</body>` // 108 bytes
  const w = worker(files)
  const paths = [1, 2, 3, 4, 5, 6].map((i) => `documents/a/b${i}.html`)
  const r = await auto(w, paths, 250)
  assert.deepEqual(await pagesCached(w), ['documents/a/b1.html', 'documents/a/b2.html'])
  assert.deepEqual([...r.notSaved].map((u) => u.slice(SCOPE.length)).sort(), paths.slice(2))
  assert.equal(r.bytes, 216)
  // two at a time: the page beside the one that passed the budget may be on its way already, none after it
  assert.deepEqual(w.fetched.map((f) => f[0]).filter((p) => /b[56]/.test(p)), [])
})

test('auto: a page it saved before that is still open but now past the budget is evicted; one it could not reach stays', async () => {
  const files = {}
  for (let i = 1; i <= 3; i++) files[`documents/a/b${i}.html`] = `<!doctype html><body>${'x'.repeat(80)}</body>` // 108 bytes
  const w = worker(files)
  const paths = [1, 2, 3].map((i) => `documents/a/b${i}.html`)
  await auto(w, paths, 1000)
  assert.deepEqual(await pagesCached(w), paths)
  files['documents/a/b2.html'] = { body: files['documents/a/b2.html'], down: true } // a network error: never evicted
  const r = await auto(w, paths, 150) // b1 fits, b3 (unchanged, 304) no longer does
  assert.deepEqual([...r.notSaved].map((u) => u.slice(SCOPE.length)), ['documents/a/b3.html'])
  assert.deepEqual([...r.failed].map((u) => u.slice(SCOPE.length)), ['documents/a/b2.html'])
  assert.deepEqual([...r.evicted].map((u) => u.slice(SCOPE.length)), ['documents/a/b3.html'])
  assert.deepEqual(await pagesCached(w), ['documents/a/b1.html', 'documents/a/b2.html'])
  assert.equal(r.bytes, 108)
})

test('auto: a page saved with Download while a run is saving it stays the reader\'s (the run does not take it back)', async () => {
  const files = { 'documents/a/d1.html': pageHtml('img/d1.png'), 'documents/a/img/d1.png': 'D', 'documents/a/d2.html': '<!doctype html>d2' }
  const w = worker(files)
  w.slow = true
  const run = auto(w, ['documents/a/d1.html', 'documents/a/d2.html'])
  const download = w.ask({ type: 'agent-pages:prefetch', urls: [SCOPE + 'documents/a/d1.html'] }) // during the run
  await Promise.all([run, download])
  const r = await auto(w, ['documents/a/other.html']) // d1 and d2 are done now
  assert.deepEqual([...r.evicted].map((u) => u.slice(SCOPE.length)), ['documents/a/d2.html'])
  assert.deepEqual(await pagesCached(w), ['documents/a/d1.html', 'documents/a/img/d1.png'])
})

test('auto: each page goes into the record once saved, so a run cut short (the worker stopped) can still evict it', async () => {
  let release
  const files = {
    'documents/a/r1.html': pageHtml('img/r1.png'), 'documents/a/img/r1.png': 'R', '_template/report.css': 'body{}',
    'documents/a/r2.html': { body: '<!doctype html>r2', wait: new Promise((r) => { release = r }) },
  }
  const w = worker(files)
  const run = auto(w, ['documents/a/r1.html', 'documents/a/r2.html'])
  for (let i = 0; i < 50 && !(await w.keys(SW.CACHES.pages)).includes(SCOPE + 'documents/a/img/r1.png'); i++) await new Promise((r) => setTimeout(r, 1))
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  const rec = JSON.parse((await w.text(SW.CACHES.meta, SCOPE + '.agent-pages-auto.json')) ?? '{}')
  assert.deepEqual([...(rec.pages?.[SCOPE + 'documents/a/r1.html'] ?? [])].sort(), [SCOPE + '_template/report.css', SCOPE + 'documents/a/img/r1.png'])
  release()
  await run
})

test('auto: the switch turned off stops a run (no new request); the eviction still runs and the pages not reached keep their copy', async () => {
  const files = { 'documents/a/gone.html': '<!doctype html>g' }
  for (let i = 1; i <= 3; i++) files[`documents/a/s${i}.html`] = { body: `<!doctype html>s${i}`, etag: `"s${i}"` }
  const w = worker(files)
  await auto(w, ['documents/a/gone.html', 'documents/a/s1.html'])
  files['documents/a/s1.html'] = { body: '<!doctype html>s1 v2', etag: '"s1b"' }
  w.fetched.length = 0
  w.slow = true
  const run = auto(w, ['documents/a/s1.html', 'documents/a/s2.html', 'documents/a/s3.html'])
  await w.ask({ type: 'agent-pages:auto-stop' })
  const r = await run
  assert.deepEqual(w.fetched, [])
  assert.equal(r.stopped, true)
  assert.deepEqual([...r.notSaved], [])
  assert.deepEqual([...r.evicted].map((u) => u.slice(SCOPE.length)), ['documents/a/gone.html'])
  assert.deepEqual(await pagesCached(w), ['documents/a/s1.html'])
  assert.equal(await w.text(SW.CACHES.pages, SCOPE + 'documents/a/s1.html'), '<!doctype html>s1')
})

test('the switch turned off sends the stop message the worker handles', () => {
  const set = OFFLINE.slice(OFFLINE.indexOf('export function setAutoSave'))
  assert.match(set.slice(0, set.indexOf('\n}\n')), /'agent-pages:auto-stop'/)
  assert.match(SRC, /d\.type === 'agent-pages:auto-stop'/)
})

test('auto: a record in the first layout ({pageUrl: [fileUrl]}) is read as the pages auto saved', async () => {
  const w = worker({})
  await w.put(SW.CACHES.pages, SCOPE + 'documents/a/old.html', '<!doctype html>old', '"o"')
  await w.put(SW.CACHES.meta, SCOPE + '.agent-pages-auto.json', JSON.stringify({ [SCOPE + 'documents/a/old.html']: [] }), null, 'application/json')
  const r = await auto(w, ['documents/a/other.html'])
  assert.deepEqual([...r.evicted].map((u) => u.slice(SCOPE.length)), ['documents/a/old.html'])
})

test('auto: a page no longer open is evicted when it was auto-downloaded; one saved with Download or opened stays', async () => {
  const files = {
    '_template/report.css': 'body{}',
    'documents/a/auto.html': pageHtml('img/only-auto.png') + '<img src="img/shared.png">',
    'documents/a/img/only-auto.png': 'A',
    'documents/a/img/shared.png': 'S',
    'documents/a/hand.html': pageHtml('img/shared.png'),
    'documents/a/seen.html': pageHtml('img/seen.png'),
    'documents/a/img/seen.png': 'V',
    'documents/a/still.html': pageHtml('img/still.png'),
    'documents/a/img/still.png': 'T',
    'documents/a/later.html': pageHtml('img/later.png'),
    'documents/a/img/later.png': 'L',
  }
  const w = worker(files)
  await w.request(SCOPE + 'documents/a/seen.html', { mode: 'navigate', cache: 'default' }) // opened in the app before
  await auto(w, ['documents/a/auto.html', 'documents/a/hand.html', 'documents/a/seen.html', 'documents/a/still.html', 'documents/a/later.html'])
  await w.ask({ type: 'agent-pages:prefetch', urls: [SCOPE + 'documents/a/hand.html'] }) // Download for offline
  await w.request(SCOPE + 'documents/a/later.html', { mode: 'navigate', cache: 'default' }) // auto saved it, then it was opened
  const r = await auto(w, ['documents/a/still.html']) // the others are done or archived now
  assert.deepEqual([...r.evicted].map((u) => u.slice(SCOPE.length)), ['documents/a/auto.html'])
  assert.deepEqual(await pagesCached(w), [
    '_template/report.css', 'documents/a/hand.html', 'documents/a/img/later.png', 'documents/a/img/seen.png', 'documents/a/img/shared.png',
    'documents/a/img/still.png', 'documents/a/later.html', 'documents/a/seen.html', 'documents/a/still.html',
  ])
})

// A page as the server serves it: its head gets review-sync.js and agent-send.js from app.py's inject_boot, so the
// saved copy has to keep them for comments and Send to agent (its offline copy of the export) to work with no network.
const servedPage = (body) => execFileSync('uv', ['run', '--quiet', 'python', '-c', `import json, sys
from agent_pages.server.app import inject_boot
sys.stdout.write(inject_boot(sys.argv[1], json.loads(sys.argv[2]), json.loads(sys.argv[3])))`,
`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/_template/report.css">
<script src="/_template/report.js" defer></script></head><body>${body}</body></html>`,
JSON.stringify({ api: '/api/', path: 'reviews/d', lesson: false, shared: [], state: null }),
JSON.stringify({ api: '/api/', page: 'd', new: false })], { cwd: new URL('..', import.meta.url), encoding: 'utf8' })

test('Download and auto save the template scripts a served page loads, agent-send.js too, and serve them offline', async () => {
  const html = servedPage('Answer.')
  const template = ['_template/report.css', '_template/report.js', '_template/review-sync.js', '_template/agent-send.js']
  for (const [how, ask] of [
    ['Download', (w) => w.ask({ type: 'agent-pages:prefetch', urls: [SCOPE + 'documents/a/p.html'] })],
    ['auto', (w) => auto(w, ['documents/a/p.html'])],
  ]) {
    const files = { 'documents/a/p.html': html }
    for (const t of template) files[t] = `/* ${t} */`
    const w = worker(files)
    await ask(w)
    assert.deepEqual(await pagesCached(w), ['documents/a/p.html', ...template].sort(), how)
    w.down = true
    for (const t of template) {
      const r = await w.request(SCOPE + t, { mode: 'no-cors', cache: 'default' })
      assert.equal(r.status, 200, `${how}: ${t}`)
      assert.equal(await r.text(), files[t], `${how}: ${t}`)
    }
  }
})
