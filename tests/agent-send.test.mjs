// template/agent-send.js in a fake browser: when the Send to agent button shows, what it posts, the status line
// it keeps from the server's answers, Start a new agent and the offline fallback.
//     node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SRC = readFileSync(new URL('../template/agent-send.js', import.meta.url), 'utf8')
const PAGE = 'r0123456789abcdef'

function browser({ sessions = 'aaaaaaaa-0000-4000-8000-000000000001' } = {}) {
  const store = new Map()
  const listeners = {}
  const calls = []
  const timers = []
  const answers = { post: [], get: [] } // queued replies: {status, body} or 'offline'
  const win = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    document: {
      visibilityState: 'visible',
      querySelector: (sel) => (sel === 'meta[name="agent-pages-session"]' && sessions != null
        ? { getAttribute: () => sessions } : null),
      addEventListener: (t, f) => ((listeners[t] = listeners[t] || []).push(f)),
    },
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a } },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].f = null },
    fetch: async (url, opts = {}) => {
      const method = opts.method || 'GET'
      calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : undefined })
      const a = (method === 'POST' ? answers.post : answers.get).shift()
      if (!a || a === 'offline') throw new TypeError('Failed to fetch')
      return { ok: a.status < 400, status: a.status, json: async () => a.body }
    },
  }
  win.window = win
  vm.createContext(win)
  vm.runInContext(SRC, win)
  const copied = []
  let sentMarks = 0
  const hooks = {
    markdown: () => '# Comments on Page\n\n## Comment 1\n\nfix it\n',
    exportable: () => true,
    copy: (text, done) => { copied.push(text); done(true) },
    sent: () => { sentMarks++ },
  }
  const view = () => ({
    btn: { disabled: false, hidden: true },
    line: { textContent: '', hidden: true },
    again: { disabled: false, hidden: true },
  })
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) }
  return {
    win, calls, answers, copied, store, view, settle, listeners,
    sentMarks: () => sentMarks,
    controller: () => win.AgentSend.controller(hooks),
    // run the timers due now (the 3 s poll), as the browser would after the delay
    tick: async () => {
      const due = timers.splice(0).filter((t) => t.f)
      due.forEach((t) => t.f())
      await settle()
      return due.map((t) => t.ms)
    },
    pending: () => timers.filter((t) => t.f).length,
    fire: async (t) => { for (const f of listeners[t] || []) f(); await settle() },
  }
}

const rec = (over) => ({ id: 'x', page: PAGE, state: 'pending', route: 'live', where: 't17', harness: 'herdr', host: 'h', error: null, ...over })

test('no button without the server or without a session to send to', () => {
  const none = browser()
  assert.equal(none.controller(), null) // the page was not served by agent-pages: no AgentSend.page()
  const noSession = browser({ sessions: null })
  noSession.win.AgentSend.page({ api: '/api/', page: PAGE, new: false })
  assert.equal(noSession.controller(), null)
  const blank = browser({ sessions: '  ' })
  blank.win.AgentSend.page({ api: '/api/', page: PAGE, new: false })
  assert.equal(blank.controller(), null)
  const canStart = browser({ sessions: null })
  canStart.win.AgentSend.page({ api: '/api/', page: PAGE, new: true })
  assert.notEqual(canStart.controller(), null) // no session, but a new agent can start
  const withSession = browser()
  withSession.win.AgentSend.page({ api: '/api/', page: PAGE, new: false })
  const c = withSession.controller()
  const v = withSession.view()
  c.view(v)
  assert.equal(v.btn.hidden, false)
  assert.equal(v.line.hidden, true)
  assert.equal(v.again.hidden, true)
})

test('the post carries the page, a send id and the export; a retry after a lost answer reuses the id', async () => {
  const b = browser()
  b.win.AgentSend.page({ api: '/api/', page: PAGE, new: true })
  const c = b.controller()
  const v = b.view()
  c.view(v)
  b.answers.post.push('offline')
  c.send()
  await b.settle()
  const first = b.calls[0]
  assert.equal(first.url, '/api/send')
  assert.equal(first.method, 'POST')
  assert.equal(first.body.page, PAGE)
  assert.match(first.body.id, /^[A-Za-z0-9_-]{6,64}$/)
  assert.equal(first.body.markdown, '# Comments on Page\n\n## Comment 1\n\nfix it\n')
  assert.equal(first.body.new, undefined)
  assert.equal(v.btn.disabled, false) // offline: the reader can try again
  b.answers.post.push({ status: 200, body: rec({ id: first.body.id, state: 'started' }) })
  c.send()
  await b.settle()
  assert.equal(b.calls[1].body.id, first.body.id)
  assert.equal(v.line.textContent, 'Sent')
  // after a final state a new click is a new send
  b.answers.post.push({ status: 200, body: rec({ state: 'started' }) })
  c.send()
  await b.settle()
  assert.notEqual(b.calls[2].body.id, first.body.id)
})

test('live: queued, polled every 3 s while not final, then sent; the button waits while the post is out or the send is claimed', async () => {
  const b = browser()
  b.win.AgentSend.page({ api: '/api/', page: PAGE, new: false })
  const c = b.controller()
  const v = b.view()
  c.view(v)
  b.answers.post.push({ status: 200, body: rec({}) })
  c.send()
  assert.equal(v.btn.disabled, true) // disabled while the post is out
  await b.settle()
  const id = b.calls[0].body.id
  assert.equal(v.line.textContent, 'Queued in herdr t17')
  assert.equal(v.line.hidden, false)
  assert.equal(v.btn.disabled, false) // still pending: a click now is a new send, which replaces this one
  assert.equal(b.sentMarks(), 1) // the page records what went out, as Export does
  b.answers.get.push({ status: 200, body: { sends: [rec({ id, state: 'claimed' })] } })
  assert.deepEqual(await b.tick(), [3000])
  assert.equal(b.calls[1].url, `/api/sends?page=${PAGE}`)
  assert.equal(v.line.textContent, 'Queued in herdr t17')
  assert.equal(v.btn.disabled, true) // claimed: the server would not cancel it, so a click would deliver twice
  c.send()
  await b.settle()
  assert.equal(b.calls.filter((x) => x.method === 'POST').length, 1) // a click on a claimed send posts nothing
  b.answers.get.push({ status: 200, body: { sends: [rec({ id: 'newer', state: 'pending' }), rec({ id, state: 'started' })] } })
  assert.deepEqual(await b.tick(), [3000])
  assert.equal(v.line.textContent, 'Sent')
  assert.equal(v.btn.disabled, false)
  assert.equal(b.pending(), 0) // final: no more polling
})

test('each route and state reads as one plain line', async () => {
  const b = browser()
  b.win.AgentSend.page({ api: '/api/', page: PAGE, new: true })
  const d = b.win.AgentSend.describe
  assert.equal(d(rec({ route: 'pending', harness: 'pi', where: '', host: 'sylvain-mac' })).text, 'Waiting for pi on sylvain-mac')
  assert.equal(d(rec({ route: 'pending', harness: '', where: 'agents reconnecting', host: '' })).text, 'Waiting for agents to reconnect')
  assert.equal(d(rec({ route: 'resuming', state: 'claimed', harness: '', where: 'Paseo pages' })).text, 'Resuming in Paseo pages')
  assert.equal(d(rec({ route: 'paseo', state: 'claimed', harness: 'paseo', where: 'aaaaaaaa-0000-4000-8000-000000000001' })).text, 'Sending to Paseo agent aaaaaaaa')
  assert.equal(d(rec({ route: 'new', state: 'claimed', harness: 'paseo', where: 'new agent' })).text, 'Starting a new agent')
  assert.equal(d(rec({ route: 'failed', state: 'failed', error: 'working folder removed' })).text, 'Failed: working folder removed')
  assert.equal(d(rec({ state: 'cancelled' })).text, 'Replaced by a newer send')
  assert.equal(d(rec({ state: 'started' })).final, true)
  assert.equal(d(rec({ state: 'pending' })).final, false)
})

test('none: Start a new agent posts a new send with new: true', async () => {
  const b = browser()
  b.win.AgentSend.page({ api: '/api/', page: PAGE, new: true })
  const c = b.controller()
  const v = b.view()
  c.view(v)
  b.answers.post.push({ status: 200, body: rec({ state: null, route: 'none', where: '', harness: '' }) })
  c.send()
  await b.settle()
  assert.equal(v.line.textContent, 'No agent has this session')
  assert.equal(v.again.hidden, false)
  assert.equal(v.btn.disabled, false)
  assert.equal(b.pending(), 0)
  const first = b.calls[0].body.id
  b.answers.post.push({ status: 200, body: rec({ state: 'claimed', route: 'new', harness: 'paseo', where: 'new agent' }) })
  c.startNew()
  await b.settle()
  assert.equal(b.calls[1].body.new, true)
  assert.notEqual(b.calls[1].body.id, first)
  assert.equal(v.again.hidden, true)
  assert.equal(v.line.textContent, 'Starting a new agent')
  assert.equal(v.btn.disabled, true) // the new agent's send is claimed
})

test('none stored after the server start grace offers Start a new agent too; without one it points to Export', async () => {
  const b = browser()
  b.win.AgentSend.page({ api: '/api/', page: PAGE, new: false })
  const c = b.controller()
  const v = b.view()
  c.view(v)
  b.answers.post.push({ status: 200, body: rec({ route: 'pending', harness: '', where: 'agents reconnecting', host: '' }) })
  c.send()
  await b.settle()
  const id = b.calls[0].body.id
  b.answers.get.push({ status: 200, body: { sends: [rec({ id, state: 'none', route: 'none' })] } })
  await b.tick()
  assert.equal(v.line.textContent, 'No agent has this session: use Export')
  assert.equal(v.again.hidden, true) // the server cannot start one
})

test('offline: the export is copied as Export does, and the line says so', async () => {
  const b = browser()
  b.win.AgentSend.page({ api: '/api/', page: PAGE, new: false })
  const c = b.controller()
  const v = b.view()
  c.view(v)
  b.answers.post.push('offline')
  c.send()
  await b.settle()
  assert.deepEqual(b.copied, ['# Comments on Page\n\n## Comment 1\n\nfix it\n'])
  assert.equal(v.line.textContent, 'Offline: export copied')
  assert.equal(b.sentMarks(), 1)
  assert.equal(b.pending(), 0)
})

test('a refused send shows the server reason; nothing to send says so without a request', async () => {
  const b = browser()
  b.win.AgentSend.page({ api: '/api/', page: PAGE, new: false })
  const c = b.controller()
  const v = b.view()
  c.view(v)
  b.answers.post.push({ status: 400, body: { error: 'the export is larger than 600 kB' } })
  c.send()
  await b.settle()
  assert.equal(v.line.textContent, 'Failed: the export is larger than 600 kB')
  assert.equal(b.sentMarks(), 0)
  const empty = browser()
  empty.win.AgentSend.page({ api: '/api/', page: PAGE, new: false })
  const c2 = empty.win.AgentSend.controller({ markdown: () => '', exportable: () => false, copy: () => {}, sent: () => {} })
  const v2 = empty.view()
  c2.view(v2)
  c2.send()
  await empty.settle()
  assert.equal(empty.calls.length, 0)
  assert.equal(v2.line.textContent, 'Nothing to send yet')
})

test('polling stops while the tab is hidden and resumes when it is visible again', async () => {
  const b = browser()
  b.win.AgentSend.page({ api: '/api/', page: PAGE, new: false })
  const c = b.controller()
  const v = b.view()
  c.view(v)
  b.answers.post.push({ status: 200, body: rec({ route: 'pending', harness: 'pi', host: 'mac', where: '' }) })
  c.send()
  await b.settle()
  const id = b.calls[0].body.id
  b.win.document.visibilityState = 'hidden'
  await b.fire('visibilitychange')
  assert.equal(b.pending(), 0)
  assert.equal(b.calls.length, 1)
  b.win.document.visibilityState = 'visible'
  b.answers.get.push({ status: 200, body: { sends: [rec({ id, state: 'started' })] } })
  await b.fire('visibilitychange')
  assert.equal(b.calls[1].url, `/api/sends?page=${PAGE}`)
  assert.equal(v.line.textContent, 'Sent')
})

test('a reload while a send waits picks up its state again', async () => {
  const b = browser()
  b.win.AgentSend.page({ api: '/api/', page: PAGE, new: false })
  b.answers.post.push({ status: 200, body: rec({}) })
  const c = b.controller()
  c.view(b.view())
  c.send()
  await b.settle()
  const id = b.calls[0].body.id
  // the same page loads again in this browser
  const again = browser()
  for (const [k, val] of b.store) again.store.set(k, val)
  again.win.AgentSend.page({ api: '/api/', page: PAGE, new: false })
  again.answers.get.push({ status: 200, body: { sends: [rec({ id, state: 'claimed' })] } })
  const c2 = again.controller()
  const v2 = again.view()
  c2.view(v2)
  await again.settle()
  assert.equal(again.calls[0].url, `/api/sends?page=${PAGE}`)
  assert.equal(v2.line.textContent, 'Queued in herdr t17')
  assert.equal(v2.btn.disabled, true) // claimed
  assert.equal(again.pending(), 1) // still polled
})

test('a pending send keeps Send and Start a new agent enabled; a new click replaces it', async () => {
  const b = browser()
  b.win.AgentSend.page({ api: '/api/', page: PAGE, new: true })
  const c = b.controller()
  const v = b.view()
  c.view(v)
  b.answers.post.push({ status: 200, body: rec({ route: 'pending', harness: 'pi', host: 'mac', where: '' }) })
  c.send()
  assert.equal(v.btn.disabled, true) // only while the post is out
  await b.settle()
  const first = b.calls[0].body.id
  assert.equal(v.line.textContent, 'Waiting for pi on mac')
  assert.equal(v.btn.disabled, false)
  assert.equal(v.again.hidden, false)
  assert.equal(v.again.disabled, false)
  assert.equal(v.again.textContent, 'Start a new agent')
  b.answers.post.push({ status: 200, body: rec({ route: 'live', state: 'pending' }) })
  c.send()
  await b.settle()
  const second = b.calls[1].body
  assert.notEqual(second.id, first) // a new send: the server cancels the pending one
  assert.equal(v.line.textContent, 'Queued in herdr t17')
  // a late poll answer about the first send changes nothing
  b.answers.get.push({ status: 200, body: { sends: [rec({ id: first, state: 'cancelled' }), rec({ id: second.id })] } })
  await b.tick()
  assert.equal(v.line.textContent, 'Queued in herdr t17')
  // Start a new agent from a pending send
  b.answers.post.push({ status: 200, body: rec({ route: 'pending', harness: 'pi', host: 'mac', where: '' }) })
  c.send()
  await b.settle()
  b.answers.post.push({ status: 200, body: rec({ state: 'claimed', route: 'new', harness: 'paseo', where: 'new agent' }) })
  c.again()
  await b.settle()
  assert.equal(b.calls.at(-1).body.new, true)
})

test('a click on a pending send posts a new send, and the server answer for the old one reads as replaced', async () => {
  const b = browser()
  b.win.AgentSend.page({ api: '/api/', page: PAGE, new: false })
  const c = b.controller()
  const v = b.view()
  c.view(v)
  b.answers.post.push({ status: 200, body: rec({ state: 'pending', route: 'live' }) })
  c.send()
  await b.settle()
  const first = b.calls[0].body.id
  assert.equal(v.btn.disabled, false)
  b.answers.post.push({ status: 200, body: rec({ state: 'pending', route: 'live' }) })
  c.send()
  await b.settle()
  const posts = b.calls.filter((x) => x.method === 'POST')
  assert.equal(posts.length, 2)
  assert.notEqual(posts[1].body.id, first) // a new send, not a retry of the first
  assert.equal(posts[1].body.markdown, posts[0].body.markdown)
  assert.equal(c.state().id, posts[1].body.id) // the page follows the new send
  assert.equal(b.win.AgentSend.describe(rec({ id: first, state: 'cancelled' })).text, 'Replaced by a newer send')
})

test('a send the Paseo watcher claims shows as claimed on the next poll and disables the buttons', async () => {
  const b = browser()
  b.win.AgentSend.page({ api: '/api/', page: PAGE, new: true })
  const c = b.controller()
  const v = b.view()
  c.view(v)
  const agent = 'aaaaaaaa-0000-4000-8000-000000000001'
  b.answers.post.push({ status: 200, body: rec({ state: 'pending', route: 'pending', harness: 'paseo', where: agent }) })
  c.send()
  await b.settle()
  const id = b.calls[0].body.id
  assert.equal(v.line.textContent, 'Waiting for Paseo agent aaaaaaaa')
  assert.equal(v.btn.disabled, false)
  assert.equal(v.again.hidden, false) // Start a new agent while it waits
  b.answers.get.push({ status: 200, body: { sends: [rec({ id, state: 'claimed', route: 'paseo', harness: 'paseo', where: agent })] } })
  await b.tick()
  assert.equal(v.line.textContent, 'Sending to Paseo agent aaaaaaaa')
  assert.equal(v.btn.disabled, true)
  assert.equal(v.again.hidden, true)
  assert.equal(b.pending(), 1) // still polled until it starts
  assert.equal(b.win.AgentSend.describe(rec({ state: 'claimed', route: 'paseo' })).state, 'claimed')
})

test('the line says how long a send has waited', () => {
  const b = browser()
  b.win.AgentSend.page({ api: '/api/', page: PAGE, new: false })
  const d = b.win.AgentSend.describe
  const now = 1_800_000_000
  const waiting = (ago) => d(rec({ route: 'pending', harness: 'pi', host: 'mac', where: '', created: now - ago }), now).text
  assert.equal(waiting(30), 'Waiting for pi on mac')
  assert.equal(waiting(12 * 60 + 5), 'Waiting for pi on mac for 12 min')
  assert.equal(waiting(3 * 3600 + 5 * 60), 'Waiting for pi on mac for 3 h 5 min')
  assert.equal(waiting(2 * 3600), 'Waiting for pi on mac for 2 h')
  assert.equal(d(rec({ created: now - 120 }), now).text, 'Queued in herdr t17 for 2 min')
  assert.equal(d(rec({ state: 'started', created: now - 600 }), now).text, 'Sent') // final: no time
})

test('held: the line names the folder and Resume anyway posts again with force', async () => {
  const b = browser()
  b.win.AgentSend.page({ api: '/api/', page: PAGE, new: true })
  const c = b.controller()
  const v = b.view()
  c.view(v)
  b.answers.post.push({ status: 200, body: rec({ state: 'held', route: 'held', where: '/home/s/work', terminal: 'herdr t4w', harness: 'paseo' }) })
  c.send()
  await b.settle()
  assert.equal(v.line.textContent, 'A pi without Send to agent may hold this session in /home/s/work (herdr t4w): reload it, or resume anyway')
  assert.equal(b.sentMarks(), 0) // nothing went out
  assert.equal(b.pending(), 0) // final: no polling
  assert.equal(v.again.hidden, false)
  assert.equal(v.again.textContent, 'Resume anyway')
  assert.equal(v.btn.disabled, false)
  const first = b.calls[0].body.id
  b.answers.post.push({ status: 200, body: rec({ state: 'claimed', route: 'resuming', harness: 'paseo', where: 'Paseo pages' }) })
  c.again()
  await b.settle()
  const forced = b.calls[1].body
  assert.equal(forced.force, true)
  assert.equal(forced.new, undefined)
  assert.notEqual(forced.id, first)
  assert.equal(v.line.textContent, 'Resuming in Paseo pages')
  assert.equal(v.again.hidden, true)
  assert.equal(b.win.AgentSend.describe(rec({ state: 'held', route: 'held', where: '/w', terminal: 'Paseo agent aaaaaaaa-0000-4000-8000-000000000001' })).text,
    'A pi without Send to agent may hold this session in /w (Paseo agent aaaaaaaa): reload it, or resume anyway')
})
