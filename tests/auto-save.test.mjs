// apps/ui/src/lib/auto-save.ts under node (type stripping): when the app asks its offline worker to save every Open page.
//     node --test tests/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUTO_KEY, autoSaver, readAutoSetting, writeAutoSetting } from '../apps/ui/src/lib/auto-save.ts'

const items = [
  { url: '/documents/a/old.html', status: 'open', changed: 10 },
  { url: '/documents/a/done.html', status: 'done', changed: 50 },
  { url: '/lessons/2026-11-01_x/', status: 'open', changed: 30 },
  { url: '/documents/a/sent.html', status: 'sent', changed: 40 },
  { url: '/documents/a/archived.html', status: 'archived', changed: 60 },
]

function setup({ enabled = true, online = true } = {}) {
  const asked = []
  const env = { enabled, online, t: 0 }
  const run = autoSaver({
    enabled: () => env.enabled,
    online: () => env.online,
    now: () => env.t,
    toUrl: (u) => 'https://box.ts.net' + u,
    ask: async (msg) => {
      asked.push(msg)
      return { pages: msg.urls.length, saved: 0, unchanged: 0, bytes: 0, notSaved: [], failed: [], evicted: [] }
    },
  })
  return { asked, env, run }
}

test('the switch off: nothing is asked of the worker, for any reason (no download, no eviction)', async () => {
  const { asked, env, run } = setup({ enabled: false })
  for (const reason of ['load', 'online', 'visible', 'switch']) {
    env.t += 3_600_000
    assert.equal(await run(items, reason), null, reason)
  }
  assert.deepEqual(asked, [])
})

test('the Open pages, newest change first, with the 150 MB budget', async () => {
  const { asked, run } = setup()
  await run(items, 'load')
  assert.equal(asked.length, 1)
  assert.equal(asked[0].type, 'agent-pages:auto')
  assert.deepEqual(asked[0].urls, ['https://box.ts.net/lessons/2026-11-01_x/', 'https://box.ts.net/documents/a/old.html'])
  assert.equal(asked[0].budget, 150e6)
})

test('online and visible run again at most once per 30 minutes; the list loaded and the switch turned on always run', async () => {
  const { asked, env, run } = setup()
  await run(items, 'load')
  env.t += 60_000
  assert.equal(await run(items, 'visible'), null)
  assert.equal(await run(items, 'online'), null)
  env.t += 29 * 60_000
  assert.notEqual(await run(items, 'online'), null)
  env.t += 60_000
  assert.equal(await run(items, 'visible'), null)
  await run(items, 'switch')
  assert.equal(asked.length, 3)
})

test('nothing while offline, and the 30 minutes start only from a run that happened', async () => {
  const { asked, env, run } = setup({ online: false })
  assert.equal(await run(items, 'load'), null)
  env.online = true
  env.t += 60_000
  assert.notEqual(await run(items, 'visible'), null)
  assert.equal(asked.length, 1)
})

test('one run at a time', async () => {
  let release
  const asked = []
  const run = autoSaver({
    enabled: () => true, online: () => true, now: () => 0, toUrl: (u) => u,
    ask: (msg) => { asked.push(msg); return new Promise((r) => { release = r }) },
  })
  const first = run(items, 'load')
  assert.equal(await run(items, 'switch'), null)
  release({ notSaved: [] })
  await first
  assert.equal(asked.length, 1)
})

test('the setting: on unless the reader turned it off, kept in localStorage', () => {
  const m = new Map()
  const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }
  assert.equal(readAutoSetting(storage), true)
  writeAutoSetting(storage, false)
  assert.equal(m.get(AUTO_KEY), '0')
  assert.equal(readAutoSetting(storage), false)
  writeAutoSetting(storage, true)
  assert.equal(readAutoSetting(storage), true)
  const broken = { getItem: () => { throw new Error('private mode') }, setItem: () => { throw new Error('private mode') } }
  assert.equal(readAutoSetting(broken), true)
  writeAutoSetting(broken, false)
})
