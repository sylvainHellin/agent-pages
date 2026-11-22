// template/review-sync.js in a fake browser: three-way merge and the bootstrap a served page runs.
//     node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SRC = readFileSync(new URL('../template/review-sync.js', import.meta.url), 'utf8')

// Two windows of one device (the app and the lesson in its frame, or two tabs) share `store` (localStorage) and
// `net` (the server). A change to the store fires a "storage" event in every other window that shares it, as browsers do.
function browser({ docId = 'doc-1', path = '/documents/a/page.html', framed = false, controlled = false, slowGets = false,
  store = new Map(), net = { server: { updated: 0, data: {} } }, parent = null } = {}) {
  const listeners = {}
  const posts = []
  const gets = []
  const intervals = []
  const held = [] // GETs waiting for answer() when slowGets
  const wins = store.wins || (store.wins = [])
  const broadcast = (key, oldValue, newValue) => {
    if (oldValue === newValue) return
    for (const w of wins) {
      if (w === win) continue
      setTimeout(() => (w.listeners.storage || []).forEach((f) => f({ key, oldValue, newValue, storageArea: w.localStorage })), 0)
    }
  }
  const win = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { const o = store.has(k) ? store.get(k) : null; store.set(k, String(v)); broadcast(k, o, String(v)) },
      removeItem: (k) => { const o = store.has(k) ? store.get(k) : null; store.delete(k); broadcast(k, o, null) },
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
    setInterval: (f) => (intervals.push(f), 0),
    setTimeout: (f) => setTimeout(f, 0),
    addEventListener: (t, f) => ((listeners[t] = listeners[t] || []).push(f)),
    navigator: { serviceWorker: { controller: controlled ? {} : null } },
    fetch: async (url, opts = {}) => {
      if (opts.method !== 'POST') gets.push(url)
      if (opts.method === 'POST') {
        const body = JSON.parse(opts.body)
        posts.push({ url, data: body.data, at: body.at, keepalive: !!opts.keepalive })
        if (body.at != null && body.at < net.server.updated) { // as the server: a push from an older base is refused
          const updated = net.server.updated
          return { ok: false, status: 409, json: async () => ({ error: 'stale', stale: true, updated }) }
        }
        net.server = { updated: net.server.updated + 1, data: body.data }
        const updated = net.server.updated
        return { ok: true, json: async () => ({ updated }) }
      }
      const snap = JSON.parse(JSON.stringify(net.server))
      if (slowGets) await new Promise((r) => held.push(r))
      return { ok: true, json: async () => snap }
    },
  }
  win.window = win
  win.listeners = listeners
  wins.push(win)
  win.parent = parent || (framed ? {} : win)
  win.frames = [] // the app: its reader's iframe once a test puts it there
  vm.createContext(win)
  vm.runInContext(SRC, win)
  const ls = (k) => (store.has(k) ? JSON.parse(store.get(k)) : undefined)
  const set = (k, v) => win.localStorage.setItem(k, JSON.stringify(v))
  return {
    win, ls, set, posts, gets, listeners,
    server: () => net.server,
    setServer: (s) => { net.server = s },
    settle: async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)) },
    every: async () => { for (const f of intervals) f(); for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)) },
    answer: async () => { held.splice(0).forEach((r) => r()); for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)) },
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

test('page: opened from the offline cache and edited before its load-time pull answers, the other device\'s comment survives', async () => {
  // this device synced [a]; the phone added b since; the cached head still says [a]; the reader types c at once
  const b = browser({ controlled: true, slowGets: true })
  b.set('anno:doc-1', [c('a')])
  b.set('tl-sync:doc-1', { at: 1, sig: JSON.stringify({ c: [c('a')] }) })
  b.setServer({ updated: 2, data: { c: [c('a'), c('b')] } })
  b.win.TutorSync.page({ api: '/api/', path: 'reviews/r1', state: { updated: 1, data: { c: [c('a')] } } })
  b.win.document.activeElement = { tagName: 'TEXTAREA' }
  b.set('anno:doc-1', [c('a'), c('c')]) // report.js saves the new comment
  await b.every() // the 1.5 s push, before the pull answered
  await b.answer() // the pull answers while the reader is still typing
  b.set('anno:doc-1', [c('a'), c('c'), c('d')]) // report.js saves again from its own copy
  await b.every()
  b.win.document.activeElement = null // done typing
  await b.every() // takes the newer state in and reloads
  await b.answer()
  await b.every() // the reloaded page pushes the merge
  await b.answer()
  assert.deepEqual(b.server().data.c.map((x) => x.id).sort(), ['a', 'b', 'c', 'd'])
  assert.ok(b.win.location.reloaded >= 1)
})

test('page: open on a desk while another device wrote, its push is refused, merged with the newer state and sent again', async () => {
  const b = browser()
  b.win.TutorSync.page({ api: '/api/', path: 'reviews/r1', state: { updated: 1, data: { c: [c('a')] } } })
  b.setServer({ updated: 5, data: { c: [c('a'), c('b')] } }) // the phone added b
  b.set('anno:doc-1', [c('a'), c('c')])
  await b.every() // refused: based on 1
  await b.every() // pulls, merges, reloads
  await b.every() // pushes the merge
  assert.deepEqual(b.server().data.c.map((x) => x.id).sort(), ['a', 'b', 'c'])
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

test('the app API: a push refused because another device saved since pulls, merges and sends the merge', async () => {
  const b = browser()
  b.setServer({ updated: 3, data: { c: [c('a')] } })
  await b.win.TutorSync.pull('/api/', 'L1')
  b.setServer({ updated: 4, data: { c: [c('a'), c('b')] } }) // the phone added b
  b.set('anno:L1', [c('a'), c('l')])
  await b.win.TutorSync.push('/api/', 'L1')
  assert.deepEqual(b.server().data.c.map((x) => x.id).sort(), ['a', 'b', 'l'])
  assert.deepEqual(b.ls('anno:L1').map((x) => x.id).sort(), ['a', 'b', 'l'])
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

test('the app beside a lesson in its frame: a refused push leaves the merge to the page, so report.js cannot write its older copy over it', async () => {
  const store = new Map(), net = { server: { updated: 3, data: { c: [c('a')] } } }
  const app = browser({ docId: null, path: '/app/', store, net })
  await app.win.TutorSync.pull('/api/', 'L1') // the app pulls before it loads the lesson
  const frame = browser({ docId: 'L1', path: '/lessons/L1/', framed: true, controlled: true, store, net, parent: app.win })
  app.win.frames.push(frame.win)
  frame.win.TutorSync.page({ api: '/api/', path: 'lessons/L1/review', lesson: true, state: { updated: 3, data: { c: [c('a')] } } })
  let memory = frame.ls('anno:L1') // report.js's own copy of what is stored
  const save = (x) => { memory = [...memory, x]; frame.set('anno:L1', memory) } // report.js writes its copy back on each edit
  net.server = { updated: 4, data: { c: [c('a'), c('b')] } } // the phone added b
  save(c('c'))
  await app.win.TutorSync.push('/api/', 'L1') // the app's 1.5 s tick: refused, based on 3
  await app.settle()
  save(c('d')) // report.js still holds [a, c]
  await frame.every() // the page catches up: merges and reloads
  await frame.settle()
  if (frame.win.location.reloaded) memory = frame.ls('anno:L1') // the reloaded report.js reads what is stored
  await frame.every()
  await frame.settle()
  await app.win.TutorSync.push('/api/', 'L1')
  await app.settle()
  assert.deepEqual(net.server.data.c.map((x) => x.id).sort(), ['a', 'b', 'c', 'd'])
  assert.deepEqual(frame.ls('anno:L1').map((x) => x.id).sort(), ['a', 'b', 'c', 'd'])
})


test('page: hidden or left while behind with a comment being typed, it neither writes the storage nor reloads, now or when shown again', async () => {
  // report.js still holds the draft and its own copy: the comment saved here reaches the server the next time the page opens
  const b = browser()
  b.win.TutorSync.page({ api: '/api/', path: 'reviews/r1', state: { updated: 1, data: { c: [c('a')] } } })
  b.setServer({ updated: 5, data: { c: [c('a'), c('b')] } }) // the phone added b
  b.win.document.activeElement = { tagName: 'TEXTAREA' }
  b.set('anno:doc-1', [c('a'), c('c')]) // report.js saves the new comment
  await b.every() // refused: based on 1
  await b.every() // still typing: it waits
  const posts = b.posts.length
  b.win.document.visibilityState = 'hidden'
  await b.fire('visibilitychange')
  await b.fire('pagehide')
  await b.settle()
  assert.deepEqual(b.ls('anno:doc-1'), [c('a'), c('c')])
  assert.equal(b.ls('tl-sync:doc-1').at, 1)
  assert.equal(b.posts.length, posts)
  b.win.document.visibilityState = 'visible'
  await b.fire('visibilitychange') // shown again, still typing
  await b.settle()
  assert.deepEqual(b.ls('anno:doc-1'), [c('a'), c('c')])
  assert.equal(b.win.location.reloaded, 0)
})

test('the app pulls a lesson its frame shows while the reader types there: it asks the page to catch up, which waits until typing ends and reloads once', async () => {
  const store = new Map(), net = { server: { updated: 3, data: { c: [c('a')] } } }
  const app = browser({ docId: null, path: '/app/', store, net })
  await app.win.TutorSync.pull('/api/', 'L1') // the app pulls before it loads the lesson
  const frame = browser({ docId: 'L1', path: '/lessons/L1/', framed: true, store, net, parent: app.win })
  app.win.frames.push(frame.win)
  frame.win.TutorSync.page({ api: '/api/', path: 'lessons/L1/review', lesson: true, state: { updated: 3, data: { c: [c('a')] } } })
  net.server = { updated: 4, data: { c: [c('a'), c('b')] } } // the phone added b
  frame.win.document.activeElement = { tagName: 'TEXTAREA' }
  frame.set('anno:L1', [c('a'), c('c')]) // report.js saves the new comment, the reader keeps typing
  assert.equal(await app.win.TutorSync.pull('/api/', 'L1'), false) // the app comes back to the front: no reload of the frame
  await app.settle()
  assert.deepEqual(store.get('anno:L1'), JSON.stringify([c('a'), c('c')]))
  assert.equal(frame.ls('tl-sync:L1').at, 3)
  assert.equal(frame.win.location.reloaded, 0)
  await frame.every() // still typing: the page waits
  await frame.settle()
  assert.deepEqual(frame.ls('anno:L1'), [c('a'), c('c')])
  assert.equal(frame.win.location.reloaded, 0)
  frame.win.document.activeElement = null // done typing
  await frame.every() // the page catches up: merges and reloads
  await frame.settle()
  assert.deepEqual(frame.ls('anno:L1').map((x) => x.id).sort(), ['a', 'b', 'c'])
  assert.equal(frame.win.location.reloaded, 1)
  await frame.every() // the reloaded page pushes the merge
  await frame.settle()
  assert.deepEqual(net.server.data.c.map((x) => x.id).sort(), ['a', 'b', 'c'])
  assert.equal(frame.win.location.reloaded, 1)
})

test('the app beside a frame running an older review-sync without catchUp: its pull resolves false and writes nothing', async () => {
  // the frame loads /_template/review-sync.js and the app /lessons/_assets/review-sync.js: two cache entries, two versions
  const store = new Map(), net = { server: { updated: 4, data: { c: [c('a'), c('b')] } } }
  const app = browser({ docId: null, path: '/app/', store, net })
  const frame = browser({ docId: 'L1', path: '/lessons/L1/', framed: true, store, net, parent: app.win })
  app.win.frames.push(frame.win)
  frame.set('anno:L1', [c('a')])
  frame.set('tl-sync:L1', { at: 3, sig: JSON.stringify({ c: [c('a')] }) })
  frame.win.TutorSync = { hosts: (k) => k === 'L1', send: async () => false } // the older copy: no catchUp
  assert.equal(await app.win.TutorSync.pull('/api/', 'L1'), false)
  await app.settle()
  assert.deepEqual(frame.ls('anno:L1'), [c('a')])
  assert.equal(frame.ls('tl-sync:L1').at, 3)
  assert.deepEqual(app.gets, [])
})

test('two tabs of one page: another tab writing the storage under this one\'s report.js loses neither device\'s comment', async () => {
  // tab T shows [a]; the phone saves [a, b]; another tab opens the page and stores [a, b]; T, still holding [a], adds c
  const store = new Map(), net = { server: { updated: 1, data: { c: [c('a')] } } }
  const tab = (state) => {
    const b = browser({ store, net })
    b.win.TutorSync.page({ api: '/api/', path: 'reviews/r1', state })
    const t = { b, memory: b.ls('anno:doc-1'), reloads: 0 } // report.js's own copy of what is stored
    t.save = (x) => { t.memory = [...(t.memory || []), x]; b.set('anno:doc-1', t.memory) } // written back on each edit
    t.tick = async () => {
      await b.every()
      await b.settle()
      if (b.win.location.reloaded !== t.reloads) { t.reloads = b.win.location.reloaded; t.memory = b.ls('anno:doc-1') }
    }
    return t
  }
  const T = tab({ updated: 1, data: { c: [c('a')] } })
  net.server = { updated: 2, data: { c: [c('a'), c('b')] } } // the phone added b
  T.b.win.document.activeElement = { tagName: 'TEXTAREA' } // the reader in T is typing c
  const O = tab({ updated: 2, data: { c: [c('a'), c('b')] } }) // the other tab: served with the newer state
  await T.b.settle()
  T.save(c('c'))
  await O.tick()
  await T.tick() // still typing
  T.b.win.document.activeElement = null
  for (let i = 0; i < 4; i++) { await O.tick(); await T.tick() }
  assert.deepEqual(net.server.data.c.map((x) => x.id).sort(), ['a', 'b', 'c'])
  assert.deepEqual(T.memory.map((x) => x.id).sort(), ['a', 'b', 'c'])
  assert.deepEqual(O.memory.map((x) => x.id).sort(), ['a', 'b', 'c'])
})
