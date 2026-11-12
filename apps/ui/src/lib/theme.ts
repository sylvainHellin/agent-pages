/* Light and dark for the app, one state with the pages it shows (template/report.js):
     - the same localStorage key 'bn-theme' and the same fallback to the OS setting; data-theme and data-theme-src
       ('stored' | 'os' | 'url') on <html>, set before the first paint by the script in index.html,
     - a switch in the app sets data-theme (and data-theme-src="stored") on every open page iframe,
     - the page's own button (#bn-theme) changes the app too: a MutationObserver on the page's <html>, and the
       storage event the page's localStorage write fires here (also from other tabs),
     - <meta name=theme-color> follows the background, so the iOS status bar matches.
   The colours come from the app theme (api/theme.css, mapped in index.css), except while a page fills the screen (the
   lesson reader, a report page): the app then borrows that page's own tokens, so its bars match the page's theme. */
import { create } from 'zustand'

export type Mode = 'light' | 'dark'
type Src = 'stored' | 'os' | 'url'

const KEY = 'bn-theme'
const root = document.documentElement
const os = matchMedia('(prefers-color-scheme: dark)')
const osMode = (): Mode => (os.matches ? 'dark' : 'light')
const isMode = (v: unknown): v is Mode => v === 'light' || v === 'dark'

function start(): { mode: Mode; src: Src } {
  const t = root.getAttribute('data-theme')
  const s = root.getAttribute('data-theme-src')
  if (isMode(t)) return { mode: t, src: s === 'stored' || s === 'url' ? s : 'os' }
  try {
    const v = localStorage.getItem(KEY)
    if (isMode(v)) return { mode: v, src: 'stored' }
  } catch {
    /* private mode */
  }
  return { mode: osMode(), src: 'os' }
}

let src: Src = start().src

export const useTheme = create<{ mode: Mode }>()(() => ({ mode: start().mode }))

/** The app's <html> and its status bar colour. */
function paint(mode: Mode) {
  root.setAttribute('data-theme', mode)
  root.setAttribute('data-theme-src', src)
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  const bg = document.body ? getComputedStyle(document.body).backgroundColor : ''
  if (meta && bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') meta.content = bg
}

/** A page in an iframe: same mode as the app, unless the page's URL forces one (?theme=). */
function paintPage(d: Document | null | undefined, mode: Mode) {
  const h = d?.documentElement
  if (!h || h.getAttribute('data-theme-src') === 'url') return
  if (h.getAttribute('data-theme') !== mode) h.setAttribute('data-theme', mode)
  const s = src === 'os' ? 'os' : 'stored'
  if (h.getAttribute('data-theme-src') !== s) h.setAttribute('data-theme-src', s)
}

function frames(): Document[] {
  const out: Document[] = []
  for (const f of Array.from(document.querySelectorAll('iframe'))) {
    try {
      if (f.contentDocument) out.push(f.contentDocument)
    } catch {
      /* another origin */
    }
  }
  return out
}

/* the page tokens index.css maps onto the app (as --pg-*) */
const TOKENS = [
  'bg', 'surface', 'surface-2', 'ink', 'muted', 'faint', 'line', 'line-strong', 'primary', 'primary-hover', 'on-primary',
  'primary-soft', 'accent', 'danger', 'ok', 'font', 'font-display', 'font-mono', 'font-features', 'selection',
]
let borrowed: Document | null = null

/** The app's bars take the tokens of the page shown full screen; null gives the app theme back. Inline on <html>, so
    they win over api/theme.css; read again on every light or dark switch. */
export function borrowPageTokens(d: Document | null) {
  borrowed = d
  for (const t of TOKENS) root.style.removeProperty(`--pg-${t}`)
  const view = d?.defaultView
  if (d && view) {
    try {
      const cs = view.getComputedStyle(d.documentElement)
      for (const t of TOKENS) {
        const v = cs.getPropertyValue(`--${t}`).trim()
        if (v) root.style.setProperty(`--pg-${t}`, v)
      }
    } catch {
      /* the page went away */
    }
  }
  paint(useTheme.getState().mode)
}

function apply(mode: Mode, from: Src) {
  src = from
  paint(mode)
  for (const d of frames()) paintPage(d, mode)
  if (borrowed) borrowPageTokens(borrowed)
  if (useTheme.getState().mode !== mode) useTheme.setState({ mode })
}

/** The app's switch: store the choice, as the page's own button does. */
export function setMode(mode: Mode) {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    /* private mode: this session only */
  }
  apply(mode, 'stored')
}

export const toggleMode = () => setMode(useTheme.getState().mode === 'dark' ? 'light' : 'dark')

const watched = new WeakSet<Document>()

/** Bring a page in an iframe to the app's mode and follow its own toggle; safe to call many times per page. */
export function bindPageTheme(d: Document | null | undefined) {
  const h = d?.documentElement
  if (!d || !h || d.URL === 'about:blank') return
  paintPage(d, useTheme.getState().mode)
  if (watched.has(d)) return
  watched.add(d)
  new MutationObserver(() => {
    const t = h.getAttribute('data-theme')
    const s = h.getAttribute('data-theme-src')
    if (!isMode(t) || s === 'url' || t === useTheme.getState().mode) return
    apply(t, s === 'os' ? 'os' : 'stored')
  }).observe(h, { attributes: true, attributeFilter: ['data-theme'] })
}

/* the page's toggle (its localStorage write), another tab, or the OS */
window.addEventListener('storage', (e) => {
  if (e.key !== KEY && e.key !== null) return
  let v: string | null = null
  try {
    v = localStorage.getItem(KEY)
  } catch {
    return
  }
  if (isMode(v)) {
    if (v !== useTheme.getState().mode || src !== 'stored') apply(v, 'stored')
  } else if (src === 'stored') apply(osMode(), 'os')
})
os.addEventListener('change', () => {
  if (src === 'os') apply(osMode(), 'os')
})

/* first paint: index.html set the attributes; the status bar colour waits for the theme stylesheet */
paint(useTheme.getState().mode)
const sheet = document.getElementById('app-theme-css') as HTMLLinkElement | null
sheet?.addEventListener('load', () => paint(useTheme.getState().mode))
window.addEventListener('load', () => paint(useTheme.getState().mode))
