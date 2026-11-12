/* What the app adds to a lesson page in the reader's iframe (same origin; the lesson HTML stays as it is):
     - reader.css (phone reading sizes, stacked wide tables, text size, focus mode) and the table labels,
     - the text size: --tl-fs on <html>, which scales the root font size so lines rewrap to the screen width,
     - pinch to change the text size (iOS gesture events, two-finger touch distance elsewhere), with the
       native page zoom stopped, so a pinch never pushes lines off the screen,
     - a tap on the text (not on a control, not a scroll, a selection or a pinch) and Esc: focus mode,
     - the app's light or dark mode, and the page's own toggle followed by the app (theme.ts).
   Every listener is attached once per document; dressPage() may run many times while a page loads. */
import { create } from 'zustand'
import { bindPageTheme } from './theme'

const READER_CSS = new URL('reader.css', document.baseURI).href

/* ---------- text size (shared by every lesson, kept per device) ---------- */

const LS_SCALE = 'tl-text-scale'
export const SCALE_MIN = 0.8
export const SCALE_MAX = 2
export const SCALE_STEP = 0.1

const clamp = (f: number) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, f))
const round = (f: number, step = 0.05) => Math.round(clamp(f) / step) * step

function readScale(): number {
  try {
    const v = parseFloat(localStorage.getItem(LS_SCALE) || '')
    return Number.isFinite(v) ? clamp(v) : 1
  } catch {
    return 1
  }
}

export const useTextScale = create<{ scale: number; set(f: number): void }>()((set) => ({
  scale: readScale(),
  set: (f) => {
    const v = +round(f).toFixed(2)
    try {
      if (v === 1) localStorage.removeItem(LS_SCALE)
      else localStorage.setItem(LS_SCALE, String(v))
    } catch {
      /* private mode */
    }
    set({ scale: v })
  },
}))

/* ---------- keeping the reading position while the text size changes ---------- */

type Anchor = { range: Range; top: number } | { el: Element; top: number; ratio: number; y: number } | null

function caretRange(d: Document, x: number, y: number): Range | null {
  const doc = d as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  let r: Range | null = null
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y)
    if (p) {
      r = d.createRange()
      r.setStart(p.offsetNode, p.offset)
    }
  } else if (doc.caretRangeFromPoint) r = doc.caretRangeFromPoint(x, y)
  if (!r) return null
  const n = r.startContainer
  if (n.nodeType !== Node.TEXT_NODE) return null
  // one character wide: a collapsed range has no box in some engines
  const len = (n.nodeValue || '').length
  if (!len) return null
  const o = Math.min(r.startOffset, len - 1)
  r.setStart(n, o)
  r.setEnd(n, o + 1)
  return r
}

const rectTop = (r: Range) => {
  const rs = r.getClientRects()
  return rs.length ? rs[0].top : r.getBoundingClientRect().top
}

/** The text line (or block) at (x, y) of the page's viewport, to keep it at the same height on screen. */
function anchorAt(d: Document, x: number, y: number): Anchor {
  const r = caretRange(d, x, y)
  if (r) {
    const top = rectTop(r)
    if (Math.abs(top - y) < 200) return { range: r, top }
  }
  const el = d.elementFromPoint(x, y)
  if (!el || el === d.documentElement || el === d.body) return null
  const b = el.getBoundingClientRect()
  return { el, top: b.top, ratio: b.height ? (y - b.top) / b.height : 0, y }
}

function jump(w: Window, dy: number) {
  if (!dy) return
  const h = w.document.documentElement
  const was = h.style.scrollBehavior
  h.style.scrollBehavior = 'auto' // report.css scrolls smoothly; this must be instant
  w.scrollBy(0, dy)
  h.style.scrollBehavior = was
}

/** Set --tl-fs on the page; with an anchor, scroll so the anchored line stays where it was on screen. */
export function applyScale(d: Document, f: number, anchor: Anchor = null) {
  const h = d.documentElement
  if (!h) return
  const cur = h.style.getPropertyValue('--tl-fs')
  const next = String(+f.toFixed(3))
  if (cur === next) return
  h.style.setProperty('--tl-fs', next)
  h.style.setProperty('--tl-fs-inv', String(+(1 / f).toFixed(4)))
  const w = d.defaultView
  if (!anchor || !w) return
  if ('range' in anchor) jump(w, rectTop(anchor.range) - anchor.top)
  else {
    const b = anchor.el.getBoundingClientRect()
    jump(w, b.top + anchor.ratio * b.height - anchor.y)
  }
}

/** The line at the top of the reading area: what A− / A+ keep in place. */
export function topAnchor(d: Document): Anchor {
  const w = d.defaultView
  if (!w) return null
  const bar = d.querySelector('.bn-bar') as HTMLElement | null
  const y = (bar && !d.documentElement.classList.contains('tl-focus') ? bar.getBoundingClientRect().bottom : 0) + 24
  const main = d.querySelector('.bn-main, main') as HTMLElement | null
  const mb = main?.getBoundingClientRect()
  const x = mb && mb.width ? mb.left + Math.min(40, mb.width / 4) : w.innerWidth / 2
  return anchorAt(d, x, y)
}

/* ---------- the page ---------- */

export interface PageHooks {
  /** focus mode is on: the page hides its own top bar */
  focus(): boolean
  /** a tap on the text */
  tap(): void
  /** Esc with nothing of the page's own open */
  esc(): void
}

const wired = new WeakSet<Document>()

/** Label every cell with its column name so reader.css can show a wide table as one card per row. */
export function stackTables(d: Document) {
  for (const t of Array.from(d.querySelectorAll('table'))) {
    if (t.classList.contains('tl-stack')) continue
    const heads = Array.from(t.querySelectorAll('thead tr:last-child th, thead tr:last-child td')).map((h) => (h.textContent || '').trim())
    if (!heads.length) continue
    const wide = heads.length >= 3 || t.scrollWidth > (t.parentElement?.clientWidth || 0) + 1
    if (!wide) continue
    for (const tr of Array.from(t.querySelectorAll('tbody tr'))) Array.from(tr.children).forEach((c, i) => heads[i] && c.setAttribute('data-label', heads[i]))
    t.classList.add('tl-stack')
    t.closest('.bn-table')?.classList.add('tl-stack-wrap')
  }
}

/** Safe to call at any point of the page's life (from the first parsed bytes to after load). */
export function dressPage(d: Document, hooks: PageHooks) {
  const h = d.documentElement
  if (!h) return
  applyScale(d, useTextScale.getState().scale)
  bindPageTheme(d)
  h.classList.toggle('tl-focus', hooks.focus())
  h.classList.add('tl-app')
  if (d.head && !d.getElementById('tutor-app-css')) {
    const link = d.createElement('link')
    link.id = 'tutor-app-css'
    link.rel = 'stylesheet'
    link.href = READER_CSS
    d.head.append(link)
  }
  if (!wired.has(d) && d.defaultView) {
    wired.add(d)
    wire(d, d.defaultView, hooks)
  }
}

/** Focus mode as the page shows it (its own top bar). */
export function setPageFocus(d: Document | null | undefined, on: boolean) {
  d?.documentElement?.classList.toggle('tl-focus', on)
}

/* Taps that are not "show / hide the controls" */
const CONTROLS = [
  'a', 'button', 'input', 'textarea', 'select', 'option', 'label', 'summary', 'video', 'audio', 'iframe', 'object', 'embed', 'canvas',
  '[role=button]', '[role=link]', '[role=checkbox]', '[role=radio]', '[role=tab]', '[role=menuitem]', '[role=slider]',
  '[contenteditable]:not([contenteditable=false])', '[tabindex]:not([tabindex="-1"])',
  'figure', '.question', '.qa', 'mark.anno', '[data-anno]',
  // report.js controls (its data-bn-ui marks the layout too, so it cannot be used here)
  '.bn-bar', '.bn-toc', '.bn-fold', '.bn-copy', '.bn-chgbars', '.bn-chg-pop', '.bn-pins', '.bn-toast', '.bn-lightbox', '.bn-modal',
  '.bn-pick-hint', '.anno-add', '.anno-pop', '.anno-drawer', '.anno-foot', '.q-meta',
].join(',')

function wire(d: Document, w: Window, hooks: PageHooks) {
  /* ----- pinch: text size ----- */
  let pinch: { f0: number; anchor: Anchor; d0: number; gesture: boolean } | null = null
  let lastPinch = 0
  let centre: { x: number; y: number } | null = null
  let want = 0
  let raf = 0

  const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
  const mid = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 })

  const begin = (x: number, y: number, d0: number, gesture: boolean) => {
    if (pinch) {
      pinch.gesture ||= gesture
      return
    }
    const sel = d.getSelection()
    if (sel && !sel.isCollapsed) sel.removeAllRanges()
    pinch = { f0: useTextScale.getState().scale, anchor: anchorAt(d, x, y), d0, gesture }
    h().classList.add('tl-pinching')
  }
  const h = () => d.documentElement
  const scaleTo = (s: number) => {
    if (!pinch || !Number.isFinite(s) || s <= 0) return
    want = clamp(pinch.f0 * s)
    if (raf) return
    raf = w.requestAnimationFrame(() => {
      raf = 0
      if (!pinch) return
      // reflow in 2.5 % steps: smooth enough to follow the fingers, few enough relayouts of a long page
      const cur = parseFloat(h().style.getPropertyValue('--tl-fs')) || 1
      const next = Math.round(want / 0.025) * 0.025
      if (Math.abs(next - cur) >= 0.0125) applyScale(d, next, pinch.anchor)
    })
  }
  const end = () => {
    if (!pinch) return
    if (raf) w.cancelAnimationFrame(raf)
    raf = 0
    const f = round(want || pinch.f0)
    applyScale(d, f, pinch.anchor)
    useTextScale.getState().set(f)
    pinch = null
    want = 0
    lastPinch = Date.now()
    h().classList.remove('tl-pinching')
  }

  d.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 2) {
        centre = mid(e.touches)
        begin(centre.x, centre.y, dist(e.touches), false)
        if (pinch && !pinch.d0) pinch.d0 = dist(e.touches)
      }
    },
    { passive: true },
  )
  d.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length < 2) return
      e.preventDefault() // no native zoom, no two-finger scroll: the pinch is ours
      centre = mid(e.touches)
      if (pinch && !pinch.gesture && pinch.d0) scaleTo(dist(e.touches) / pinch.d0)
    },
    { passive: false },
  )
  const touchEnd = (e: TouchEvent) => {
    if (e.touches.length < 2 && pinch && !pinch.gesture) end()
  }
  d.addEventListener('touchend', touchEnd, { passive: true })
  d.addEventListener('touchcancel', touchEnd, { passive: true })

  // iOS: gesture events carry the pinch scale (and stop Safari's own zoom when cancelled)
  type GestureEv = Event & { scale?: number; clientX?: number; clientY?: number }
  d.addEventListener('gesturestart', (e: GestureEv) => {
    e.preventDefault()
    const x = centre?.x ?? e.clientX ?? w.innerWidth / 2
    const y = centre?.y ?? e.clientY ?? w.innerHeight / 2
    begin(x, y, 0, true)
  }, { passive: false } as AddEventListenerOptions)
  d.addEventListener('gesturechange', (e: GestureEv) => {
    e.preventDefault()
    if (pinch) {
      pinch.gesture = true
      scaleTo(e.scale ?? 1)
    }
  }, { passive: false } as AddEventListenerOptions)
  d.addEventListener('gestureend', (e: GestureEv) => {
    e.preventDefault()
    end()
  }, { passive: false } as AddEventListenerOptions)

  /* ----- tap: focus mode ----- */
  let down: { x: number; y: number; t: number; sy: number; ok: boolean } | null = null
  const pointers = new Set<number>()
  let pending = 0
  let lastScroll = 0
  w.addEventListener('scroll', () => (lastScroll = Date.now()), { passive: true })

  const busy = () => {
    const b = d.body
    if (!b) return true
    if (b.classList.contains('bn-picking') || b.classList.contains('bn-toc-open')) return true
    const lb = d.getElementById('bn-lightbox')
    if (lb && !lb.hidden) return true
    return !!d.querySelector('.anno-pop, .anno-drawer.open, .bn-modal')
  }
  const selecting = () => {
    const s = d.getSelection()
    return !!s && !s.isCollapsed && !!String(s).trim()
  }

  d.addEventListener(
    'pointerdown',
    (e) => {
      if (e.isPrimary) pointers.clear() // a lost pointerup must not block every later tap
      pointers.add(e.pointerId)
      const again = !!pending // the second tap of a double tap / double click
      w.clearTimeout(pending)
      pending = 0
      const t = e.target as Element | null
      const ok =
        !again &&
        pointers.size === 1 &&
        e.isPrimary &&
        e.button === 0 &&
        !pinch &&
        Date.now() - lastPinch > 400 &&
        Date.now() - lastScroll > 120 && // this touch stops a moving page
        !selecting() &&
        !busy() &&
        !!t?.closest &&
        !t.closest(CONTROLS)
      down = { x: e.clientX, y: e.clientY, t: Date.now(), sy: w.scrollY, ok }
    },
    true,
  )
  d.addEventListener(
    'pointermove',
    (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) down.ok = false
    },
    true,
  )
  const drop = (e: PointerEvent) => {
    pointers.delete(e.pointerId)
    down = null
  }
  d.addEventListener('pointercancel', drop, true)
  d.addEventListener(
    'pointerup',
    (e) => {
      pointers.delete(e.pointerId)
      const p = down
      down = null
      if (!p || !p.ok || pointers.size || pinch) return
      if (Date.now() - p.t > 500 || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10 || Math.abs(w.scrollY - p.sy) > 2) return
      // wait a moment: a double click selects a word, a second tap may follow
      pending = w.setTimeout(() => {
        pending = 0
        if (selecting() || busy() || Date.now() - lastPinch < 400) return
        hooks.tap()
      }, 260)
    },
    true,
  )

  /* ----- Esc ----- */
  w.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return
      if (busy() || selecting()) return // the page closes its own things first
      hooks.esc()
    },
    true,
  )
}
