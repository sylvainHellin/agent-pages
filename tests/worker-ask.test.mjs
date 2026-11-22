// apps/ui/src/lib/worker-ask.ts under node (type stripping): the app's request to its offline worker gives up after
// its timeout, also when the worker never registered.
//     node --test tests/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { askWorker } from '../apps/ui/src/lib/worker-ask.ts'

const never = () => new Promise(() => {})
// fails the test instead of hanging it when askWorker never settles
const within = (p, ms = 1000) => {
  let t
  const late = new Promise((_, no) => { t = setTimeout(() => no(new Error('askWorker never settled')), ms) })
  return Promise.race([p, late]).finally(() => clearTimeout(t))
}

test('askWorker: the worker never registered (ready never resolves), it rejects after the timeout', async () => {
  const container = { ready: never(), controller: null }
  await assert.rejects(within(askWorker(container, { type: 'agent-pages:prefetch' }, 30)), /did not answer/)
})

test('askWorker: a worker that never answers, it rejects after the timeout', async () => {
  const sw = { postMessage: () => {} }
  const container = { ready: Promise.resolve({ active: sw }), controller: sw }
  await assert.rejects(within(askWorker(container, { type: 'agent-pages:cached' }, 30)), /did not answer/)
})

test('askWorker: the answer on the message port', async () => {
  const sw = { postMessage: (msg, [port]) => port.postMessage({ echo: msg.type }) }
  const container = { ready: Promise.resolve({ active: sw }), controller: null }
  assert.deepEqual(await within(askWorker(container, { type: 'agent-pages:cached' }, 500)), { echo: 'agent-pages:cached' })
})
