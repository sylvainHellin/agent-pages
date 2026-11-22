/* Offline reading: registers the service worker (public/sw.js, served at the app root), tracks whether the app is
   offline (navigator.onLine, or the worker saying a request failed), keeps the set of pages saved on this device,
   shows the "updated, reload" hint the worker asks for, downloads pages for offline reading (prefetchPages), and
   has the worker save every Open page unless the reader turned that off (autoSave, auto-save.ts). */
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { APP_ROOT, rootUrl } from './api'
import { AUTO_BUDGET, autoSaver, notSavedCount, readAutoSetting, writeAutoSetting, type AutoReason, type AutoResult } from './auto-save'
import { askWorker, type Msg } from './worker-ask'

export interface PrefetchResult {
  pages: number
  files: number
  bytes: number
  skipped: string[]
  failed: string[]
  error?: string
}

let workerOffline = false
let saved = new Set<string>() // pathnames of the pages saved in the worker's cache
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
const subscribe = (f: () => void) => {
  subs.add(f)
  return () => subs.delete(f)
}

export const isOffline = () => !navigator.onLine || workerOffline
export const useOffline = () => useSyncExternalStore(subscribe, isOffline)
const savedSnapshot = () => saved
/** The pathnames of the pages this device can show offline. */
export const useSavedPages = () => useSyncExternalStore(subscribe, savedSnapshot)

let saving: { done: number; total: number } | null = null // the worker's auto run, while it saves the Open pages
const savingSnapshot = () => saving
export const useSaving = () => useSyncExternalStore(subscribe, savingSnapshot)

let autoOn = typeof localStorage === 'undefined' ? true : readAutoSetting(localStorage)
const autoSnapshot = () => autoOn
/** Whether every Open page is downloaded (the switch, on by default). */
export const useAutoSave = () => useSyncExternalStore(subscribe, autoSnapshot)

const supported = () => 'serviceWorker' in navigator && window.isSecureContext && !import.meta.env.DEV

/** A request to the worker that controls the app (worker-ask.ts: it gives up after `timeout`, also when the worker
    never registered). */
async function ask<T>(msg: Msg, timeout = 10_000): Promise<T> {
  if (!supported()) throw new Error('Offline copies need the app over https (or on localhost)')
  return askWorker<T>(navigator.serviceWorker, msg, timeout)
}

export async function refreshSaved(): Promise<void> {
  try {
    const r = await ask<{ urls?: string[]; online?: boolean }>({ type: 'agent-pages:cached' })
    saved = new Set((r.urls || []).map((u) => new URL(u).pathname))
    workerOffline = r.online === false // the worker's last request failed, even if the browser thinks it is online
    emit()
  } catch {
    /* no worker: nothing is saved */
  }
}

/** Download pages (their HTML, the template files and the images they reference) for offline reading,
    adding at most `budget` bytes; files already saved cost nothing. */
export async function prefetchPages(urls: string[], { budget = 50e6 }: { budget?: number } = {}): Promise<PrefetchResult> {
  const r = await ask<PrefetchResult>({ type: 'agent-pages:prefetch', urls: urls.map((u) => rootUrl(u.replace(/^\//, ''))), budget }, 300_000)
  if (r.error) throw new Error(r.error)
  refreshSaved()
  return r
}

const runAuto = autoSaver({
  enabled: () => autoOn,
  online: () => supported() && !isOffline(),
  now: () => Date.now(),
  toUrl: (u) => rootUrl(u.replace(/^\//, '')),
  ask: (msg) => ask<AutoResult>(msg, 30 * 60_000),
  /* the worker's last progress message may never come (it was stopped mid-run, or the run was busy or failed) */
  settled: () => {
    if (!saving) return
    saving = null
    emit()
  },
})
let shownNotSaved = 0

/** Have the worker save every Open page of `items` (the list just loaded from the server), evict the ones it saved that
    are no longer open or no longer fit the budget, and say once how many Open pages this device cannot show offline
    (a page opened or saved with Download stays). Nothing when the switch is off. */
export async function autoSave(items: { url: string; status: string; changed: number }[], reason: AutoReason): Promise<void> {
  let r: AutoResult | null
  try {
    r = await runAuto(items, reason)
  } catch {
    return // no worker, or it did not answer in time
  }
  if (!r || r.busy || r.error) return
  await refreshSaved()
  const n = notSavedCount(r.notSaved, saved)
  if (n && n !== shownNotSaved) {
    toast.warning(`${n} Open page${n > 1 ? 's' : ''} not saved offline`, {
      id: 'auto-save',
      description: `Over the ${Math.round(AUTO_BUDGET / 1e6)} MB kept for Open pages: the ones changed last are saved. Open or download a page to keep it.`,
    })
  }
  shownNotSaved = n
}

/** The switch: kept in localStorage; turned on, it saves the Open pages of `items` at once (null: the list has not
    loaded, so nothing runs, since an empty list would evict every page saved so far). */
export function setAutoSave(on: boolean, items: { url: string; status: string; changed: number }[] | null): void {
  autoOn = on
  writeAutoSetting(localStorage, on)
  emit()
  if (on && items) autoSave(items, 'switch')
}

/* The lists the app's first screen loads (store.ts loadPages); the worker keeps their last copy for offline use.
   tests/sw.test.mjs checks the two agree. */
const LISTS = ['api/items', 'api/projects']

/** Everything the app and its page frames loaded before the worker controlled them, so the first visit is saved too,
    and the lists, whose first requests may still have been on their way when the worker took over. */
function loadedUrls(): string[] {
  const out = new Set<string>([location.href.split('#')[0], ...LISTS.map(rootUrl)])
  const add = (w: Window) => {
    try {
      out.add(w.location.href.split('#')[0])
      for (const e of w.performance.getEntriesByType('resource')) if (e.name.startsWith(location.origin)) out.add(e.name)
    } catch {
      /* another origin */
    }
  }
  add(window)
  document.querySelectorAll('iframe').forEach((f) => f.contentWindow && add(f.contentWindow))
  return [...out]
}

function onMessage(e: MessageEvent) {
  const d = (e.data || {}) as Msg
  if (d.type === 'agent-pages:net') {
    workerOffline = d.online === false
    emit()
  } else if (d.type === 'agent-pages:progress') {
    const total = Number(d.total) || 0
    saving = d.running && total ? { done: Number(d.done) || 0, total } : null
    emit()
  } else if (d.type === 'agent-pages:saved' && typeof d.url === 'string') {
    const p = new URL(d.url).pathname
    if (!saved.has(p)) {
      saved = new Set(saved).add(p)
      emit()
    }
  } else if (d.type === 'agent-pages:updated' && typeof d.url === 'string') {
    const url = d.url
    if (d.shell) {
      if (new URL(url).pathname !== location.pathname.replace(/index\.html$/, '')) return
      toast('A new version of the app is ready', { id: 'updated:app', duration: 20_000, action: { label: 'Reload', onClick: () => location.reload() } })
      return
    }
    /* the worker can finish asking the server before the frame has shown the cached copy, so its src counts too */
    const frame = [...document.querySelectorAll('iframe')].find((f) => {
      try {
        return f.src.split('#')[0] === url || f.contentWindow?.location.href.split('#')[0] === url
      } catch {
        return false
      }
    })
    if (!frame) return
    toast('This page was updated', {
      id: `updated:${url}`,
      duration: 20_000,
      action: { label: 'Reload', onClick: () => frame.contentWindow?.location.reload() },
    })
  }
}

/** Once, at start: the worker, the online and offline events, and the list of saved pages. */
export function startOffline(): void {
  const net = () => {
    if (navigator.onLine) workerOffline = false
    emit()
  }
  window.addEventListener('online', net)
  window.addEventListener('offline', net)
  if (!supported()) return
  const first = !navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('message', onMessage)
  if (first) {
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => ask({ type: 'agent-pages:warm', urls: loadedUrls() }, 60_000).then(refreshSaved, () => {}),
      { once: true },
    )
  }
  if (!first) refreshSaved() // before register(), which fails offline (it fetches sw.js to look for a new one)
  navigator.serviceWorker
    .register(rootUrl('sw.js'), { scope: APP_ROOT.href })
    .then(persistOnce)
    .catch((e) => first && console.warn('agent-pages: no offline worker:', e))
}

/** WebKit keeps a Home Screen app's storage when asked: asked once, and not again once granted. */
let persistAsked = false
function persistOnce() {
  if (persistAsked || !navigator.storage?.persist) return
  persistAsked = true
  Promise.resolve(navigator.storage.persisted?.())
    .then((granted) => granted || navigator.storage.persist())
    .catch(() => {})
}
