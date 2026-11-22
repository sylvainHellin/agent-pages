/* A request to the service worker that controls the app, answered on a message port (offline.ts uses it).
   No imports, so tests/worker-ask.test.mjs runs it under node. */

export type Msg = { type: string; [k: string]: unknown }

/** One timer covers the wait for the worker too: `ready` never resolves when register() failed (a first start
    offline), and a worker may never answer. */
export async function askWorker<T>(container: Pick<ServiceWorkerContainer, 'ready' | 'controller'>, msg: Msg, timeout: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined
  let ch: MessageChannel | undefined
  const late = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error('The offline worker did not answer')), timeout)
  })
  try {
    const reg = await Promise.race([container.ready, late])
    const sw = container.controller || reg.active
    if (!sw) throw new Error('The offline worker is not running yet')
    const answer = new Promise<T>((resolve) => {
      ch = new MessageChannel()
      ch.port1.onmessage = (e) => resolve(e.data as T)
      sw.postMessage(msg, [ch.port2])
    })
    return await Promise.race([answer, late])
  } finally {
    clearTimeout(t)
    ch?.port1.close()
  }
}
