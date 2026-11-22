// template/review-sync.js in a fake browser: three-way merge and the bootstrap a served page runs.
//     node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SRC = readFileSync(new URL('../template/review-sync.js', import.meta.url), 'utf8')

function browser({ docId = 'doc-1', path = '/documents/a/page.html', framed = false, controlled = false } = {}) {
  const store = new Map()
  const listeners = {}
  const posts = []
  const gets = []
  let server = { updated: 0, data: {} }
  const win = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    document: {
      documentElement: { getAttribute: (n) => (n === 'data-doc-id' ? docId : null) },
      visibilityState: 'visible',
      activeElement: null,
      querySelector: () => null,
      addEventListener: (t, f) => ((listeners[t] = listeners[t] || []).push(f)),
    },
    location: { pathname: path, reloaded: 0, reload() { this.reloaded++ } },
    console: { warn: (...a) => win.warned.push(a.join(' ')) },
    warned: [],
    setInterval: () => 0,
    setTimeout: (f) => setTimeout(f, 0),
    addEventListener: (t, f) => ((listeners[t] = listeners[t] || []).push(f)),
    navigator: { serviceWorker: { controller: controlled ? {} : null } },
    fetch: async (url, opts = {}) => {
      if (opts.method !== 'POST') gets.push(url)
      if (opts.method === 'POST') {
        const body = JSON.parse(opts.body)
        posts.push({ url, data: body.data })
        server = { updated: server.updated + 1, data: body.data }
        return { ok: true, json: async () => ({ updated: server.updated }) }
      }
      return { ok: true, json: async () => server }
    },
  }
  win.window = win
  win.parent = framed ? {} : win
  vm.createContext(win)
  vm.runInContext(SRC, win)
  const ls = (k) => (store.has(k) ? JSON.parse(store.get(k)) : undefined)
  const set = (k, v) => store.set(k, JSON.stringify(v))
  return {
    win, ls, set, posts, gets, listeners,
    setServer: (s) => { server = s },
    fire: async (t) => { for (const f of listeners[t] || []) f(); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)) },
  }
}

const plain = (x) => JSON.parse(JSON.stringify(x))
const tick = () => new Promise((r) => setTimeout(r, 0))
const c = (id, body = id) => ({ id, body })

test('merge: a comment deleted on one side stays deleted', () => {
  const { win } = browser()
  const base = { c: [c('a'), c('b')] }
  const srv = { c: [c('a'), c('b'), c('s')] } // other device added s
  const loc = { c: [c('b'), c('l')] } // this device deleted a, added l
  const out = plain(win.TutorSync.merge(srv, loc, base))
  assert.deepEqual(out.c.map((x) => x.id).sort(), ['b', 'l', 's'])
})

test('merge: an edit wins over the untouched copy, both edited keeps this device', () => {
  const { win } = browser()
  const base = { c: [c('a', 'old'), c('b', 'old')] }
  const srv = { c: [c('a', 'srv edit'), c('b', 'srv edit')] }
  const loc = { c: [c('a', 'old'), c('b', 'loc edit')] }
  const byId = Object.fromEntries(win.TutorSync.merge(srv, loc, base).c.map((x) => [x.id, x.body]))
  assert.deepEqual(byId, { a: 'srv edit', b: 'loc edit' })
})

test('merge: answers and notes follow the same rules', () => {
  const { win } = browser()
  const base = { answers: { q1: { text: 'x' }, q2: { text: 'y' } }, notes: 'base' }
  const srv = { answers: { q1: { text: 'x' }, q3: { text: 'z' } }, notes: 'base' } // q2 cleared there
  const loc = { answers: { q1: { text: 'x2' }, q2: { text: 'y' } }, notes: 'base and more' }
  const out = plain(win.TutorSync.merge(srv, loc, base))
  assert.deepEqual(Object.keys(out.answers).sort(), ['q1', 'q3'])
  assert.equal(out.answers.q1.text, 'x2')
  assert.equal(out.notes, 'base and more')
})

test('merge: without a base nothing counts as deleted', () => {
  const { win } = browser()
  const out = plain(win.TutorSync.merge({ c: [c('a')] }, { c: [c('b')] }, null))
  assert.deepEqual(out.c.map((x) => x.id).sort(), ['a', 'b'])
})

test('page: the server state written into the page lands in storage before report.js reads it', () => {
  const b = browser()
  b.win.TutorSync.page({ api: '/api/', path: 'reviews/r1', state: { updated: 5, data: { c: [c('a')], notes: 'n' } } })
  assert.deepEqual(b.ls('anno:doc-1'), [c('a')])
  assert.equal(b.ls('anno:doc-1:notes'), 'n')
  assert.equal(b.ls('tl-sync:doc-1').at, 5)
})

test('page: storage key falls back to the path, as report.js does', () => {
  const b = browser({ docId: 'report-slug' })
  b.win.TutorSync.page({ api: '/api/', path: 'reviews/r1', state: { updated: 1, data: { c: [c('a')] } } })
  assert.deepEqual(b.ls('anno:/documents/a/page.html'), [c('a')])
})

test('page: edits made here and there since the last sync are merged and sent', async () => {
  const b = browser()
  b.set('anno:doc-1', [c('a'), c('l')])
  b.set('tl-sync:doc-1', { at: 1, sig: JSON.stringify({ c: [c('a')] }) })
  b.win.TutorSync.page({ api: '/api/', path: 'reviews/r1', state: { updated: 2, data: { c: [c('a'), c('s')] } } })
  assert.deepEqual(b.ls('anno:doc-1').map((x) => x.id).sort(), ['a', 'l', 's'])
  await tick()
  assert.equal(b.posts.length, 1)
  assert.equal(b.posts[0].url, '/api/reviews/r1')
  assert.deepEqual(b.posts[0].data.c.map((x) => x.id).sort(), ['a', 'l', 's'])
})

test('page: a comment written while offline is pushed when the page hides', async () => {
  const b = browser()
  b.win.TutorSync.page({ api: '/api/', path: 'reviews/r1', state: { updated: 1, data: {} } })
  b.set('anno:doc-1', [c('new')])
  b.win.document.visibilityState = 'hidden'
  await b.fire('visibilitychange')
  assert.deepEqual(b.posts.map((p) => p.data.c[0].id), ['new'])
})

test('page: newer state from another device reloads the page when it comes back to the front', async () => {
  const b = browser()
  b.win.TutorSync.page({ api: '/api/', path: 'reviews/r1', state: { updated: 1, data: {} } })
  b.setServer({ updated: 9, data: { c: [c('far')] } })
  await b.fire('visibilitychange')
  assert.deepEqual(b.ls('anno:doc-1'), [c('far')])
  assert.equal(b.win.location.reloaded, 1)
})

test('page: opened from the offline cache, it pulls once at load and reloads when another device wrote since', async () => {
  // the service worker serves the cached copy first, so the state in its head can be older than the server's
  const b = browser({ controlled: true })
  b.setServer({ updated: 9, data: { c: [c('far')] } })
  b.win.TutorSync.page({ api: '/api/', path: 'reviews/r1', state: { updated: 1, data: {} } })
  await tick()
  await tick()
  assert.deepEqual(b.gets, ['/api/reviews/r1'])
  assert.deepEqual(b.ls('anno:doc-1'), [c('far')])
  assert.equal(b.win.location.reloaded, 1)
})

test('page: served by the server itself, its head is current and nothing is pulled at load', async () => {
  const b = browser()
  b.win.TutorSync.page({ api: '/api/', path: 'reviews/r1', state: { updated: 1, data: {} } })
  await tick()
  assert.deepEqual(b.gets, [])
})

test('page: a lesson inside the app leaves the focus pull to the app', async () => {
  const b = browser({ framed: true })
  b.win.TutorSync.page({ api: '/api/', path: 'lessons/x/review', lesson: true, state: { updated: 1, data: {} } })
  b.setServer({ updated: 9, data: { c: [c('far')] } })
  await b.fire('visibilitychange')
  assert.equal(b.win.location.reloaded, 0)
})

test('page: a shared page id syncs nothing and says why', async () => {
  const b = browser()
  b.set('anno:doc-1', [c('mine')])
  b.win.TutorSync.page({ api: '/api/', path: 'reviews/r1', shared: ['/documents/a.html', '/documents/b.html'], state: null })
  b.win.document.visibilityState = 'hidden'
  await b.fire('visibilitychange')
  assert.equal(b.posts.length, 0)
  assert.deepEqual(b.ls('anno:doc-1'), [c('mine')])
  assert.match(b.win.warned[0], /a\.html/)
})

test('the app API keeps working: pull and push by lesson slug', async () => {
  const b = browser()
  b.setServer({ updated: 3, data: { notes: 'from phone' } })
  assert.equal(await b.win.TutorSync.pull('/api/', 'L1'), true)
  assert.equal(b.ls('anno:L1:notes'), 'from phone')
  b.set('anno:L1', [c('x')])
  assert.equal(await b.win.TutorSync.push('/api/', 'L1'), true)
  assert.equal(b.posts[0].url, '/api/lessons/L1/review')
})
