/* Every Open page downloaded for the train: when the app asks its offline worker to save the pages whose status is
   open (public/sw.js, agent-pages:auto), and the switch that turns it off. iOS cannot tell Wi-Fi from cellular, so the
   reader turns it off on a cellular-heavy day instead (.agents/research/2026-11-21-pwa-offline.md, section 2).
   No imports, so tests/auto-save.test.mjs runs it under node; offline.ts wires it to the worker. */

export const AUTO_KEY = 'ap-auto-offline'
/** How often 'online' and the app coming back to the front run it again. */
export const AUTO_EVERY = 30 * 60_000
/** The pages and files of the Open list the worker keeps at most. */
export const AUTO_BUDGET = 150e6

export interface AutoResult {
  pages: number
  saved: number
  unchanged: number
  bytes: number
  notSaved: string[]
  failed: string[]
  evicted: string[]
  busy?: boolean
  /** the switch was turned off during the run (agent-pages:auto-stop) */
  stopped?: boolean
  error?: string
}

/** load: the app loaded the list; switch: the reader turned the switch on; online, visible: at most every AUTO_EVERY. */
export type AutoReason = 'load' | 'online' | 'visible' | 'switch'

export interface AutoDeps {
  enabled(): boolean
  online(): boolean
  now(): number
  /** a server path (/documents/x.html) to its full URL */
  toUrl(path: string): string
  ask(msg: { type: 'agent-pages:auto'; urls: string[]; budget: number }): Promise<AutoResult>
  /** after the worker answered or the ask failed (busy, error, timeout too): offline.ts clears its progress badge */
  settled?(): void
}

type Listed = { url: string; status: string; changed: number }

/** run(items, reason): the worker's answer, or null when nothing was asked (switch off, offline, too soon, one running,
    or an empty list, which would evict every page saved so far). */
export function autoSaver(deps: AutoDeps) {
  let last = -Infinity
  let running = false
  return async function run(items: Listed[], reason: AutoReason): Promise<AutoResult | null> {
    if (!deps.enabled() || !deps.online() || running || items.length === 0) return null
    const now = deps.now()
    if ((reason === 'online' || reason === 'visible') && now - last < AUTO_EVERY) return null
    last = now
    running = true
    try {
      const urls = items
        .filter((i) => i.status === 'open')
        .sort((a, b) => b.changed - a.changed)
        .map((i) => deps.toUrl(i.url))
      return await deps.ask({ type: 'agent-pages:auto', urls, budget: AUTO_BUDGET })
    } finally {
      running = false
      deps.settled?.()
    }
  }
}

/** How many of the pages the budget left out (full URLs) this device cannot show offline: the worker evicts its own
    copies of them, but a page opened or saved with Download stays. saved: the pathnames of the pages cached now. */
export function notSavedCount(notSaved: string[], saved: Set<string>): number {
  return notSaved.filter((u) => !saved.has(new URL(u).pathname)).length
}

type KV = Pick<Storage, 'getItem' | 'setItem'>

/** On unless the reader turned it off. */
export function readAutoSetting(storage: KV): boolean {
  try {
    return storage.getItem(AUTO_KEY) !== '0'
  } catch {
    return true
  }
}

export function writeAutoSetting(storage: KV, on: boolean): void {
  try {
    storage.setItem(AUTO_KEY, on ? '1' : '0')
  } catch {
    /* private mode: offline.ts keeps the choice for this visit */
  }
}
