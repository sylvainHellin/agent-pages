/* #/r/<url>: every page inside the app, a lesson (a page with the lesson tag, or a tutor lesson) included.
   The app puts Back and the page's status into the page's own top bar (same origin), and its own items into that
   bar's More menu (text size, Hide the bar, Earlier and Later lesson on a lesson, Copy link, Download for offline,
   Open the page alone), so one bar carries the title; a page without that bar (no report.js) gets the app's bar.
   The status button opens the details dialog (status, tags, projects; PATCH api/items/<id>).
   The page syncs its own comments between devices (review-sync.js, which the server puts into its head).
   What the app adds inside the page (reader.css, text size, pinch, tap to hide the bar) is src/lib/reader-page.ts.
   Hide the bar (the menu item, Esc, a tap on the text with a touch screen) slides the page's bar away.
   #/l/<slug>, the old lesson reader's route, goes on to the page (LessonRedirect).
   "Download for offline" saves the page with its template files and images in the service worker's cache. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRightIcon, ChevronLeftIcon, CloudDownloadIcon, LinkIcon, MoreHorizontalIcon } from 'lucide-react'
import { toast } from 'sonner'
import { rootUrl, STATUSES, type Item, type Status } from '@/lib/api'
import { copyText, useIsDesktop } from '@/lib/hooks'
import { prefetchPages } from '@/lib/offline'
import { applyScale, dressPage, SCALE_MAX, SCALE_MIN, SCALE_STEP, setPageFocus, stackTables, topAnchor, useTextScale, type PageHooks } from '@/lib/reader-page'
import { bindPageTheme, borrowPageTokens } from '@/lib/theme'
import { hereUrl, navigate, pageHash } from '@/lib/router'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconTip, STATUS_LABEL } from '@/components/bits'
import { DetailsDialog, StatusMenu, TagsButton } from '@/components/lesson-meta'
import { NotFound } from '@/components/lessons'
import { ThemeMenuItem } from '@/components/theme-toggle'

const ICON = {
  back: '<path d="m15 18-6-6 6-6"/>',
  alone: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  download: '<path d="M12 13v8l-4-4"/><path d="m12 21 4-4"/><path d="M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284"/>',
  hide: '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  earlier: '<path d="m15 18-6-6 6-6"/>',
  later: '<path d="m9 18 6-6-6-6"/>',
}

/** Save one page for offline reading, with a toast saying what it cost. */
async function downloadForOffline(url: string) {
  const id = toast.loading('Saving the page for offline reading…')
  try {
    const r = await prefetchPages([url])
    const kb = Math.round(r.bytes / 1024)
    if (r.skipped.length || r.failed.length) toast.warning('Saved in part', { id, description: `${r.skipped.length + r.failed.length} files missing, ${kb} kB saved` })
    else toast.success('Saved for offline reading', { id, description: `${r.pages + r.files} new files, ${kb} kB` })
  } catch (e) {
    toast.error((e as Error).message, { id })
  }
}

/* the status dot of the page bar, drawn with the page's own tokens */
const DOT: Record<Status, string> = {
  open: 'border:1.5px solid var(--accent, currentColor)',
  sent: 'border:1.5px solid var(--primary, currentColor);background:radial-gradient(var(--primary, currentColor) 0 1px,transparent 1.5px)',
  done: 'background:var(--primary, currentColor)',
  archived: 'background:var(--muted, #999);opacity:.6',
}

const BAR_CSS = `
.bn-app-back { margin-left: -.55rem; color: var(--muted); text-decoration: none; }
.bn-app-back:hover { color: var(--ink); }
.bn-app-sep { flex: none; width: 1px; height: 1.25rem; margin: 0 .15rem; background: var(--line); }
a.bn-btn { text-decoration: none; }
.bn-app-status { gap: .4rem; font-size: .8rem; }
.bn-app-status .bn-app-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; flex: none; box-sizing: border-box; }
@media (max-width: 720px) { .bn-app-back { margin-left: -.35rem; } .bn-app-sep { display: none; } }
@media (max-width: 720px) { .bn-bar-in > .bn-app-alone, .bn-bar-in > .bn-app-download { display: none; } }
.bn-app-ts { display: flex; align-items: center; gap: .15rem; padding: .2rem .35rem .2rem .7rem; font-size: .84rem; }
.bn-app-ts .t { flex: 1; }
.bn-app-ts button { font: inherit; font-size: .8rem; font-weight: 500; color: var(--ink); background: none; border: 0;
  border-radius: 6px; min-width: 2rem; height: 1.75rem; cursor: pointer; font-variant-numeric: tabular-nums; }
.bn-app-ts button:hover:not(:disabled), .bn-app-ts button:focus-visible { background: var(--surface-2); outline: none; }
.bn-app-ts button:disabled { opacity: .4; cursor: default; }
.bn-app-ts .bn-app-ts-val { min-width: 2.75rem; color: var(--muted); font-weight: 400; }
`

interface BarActions {
  back: string
  alone: string
  path?: string
  status?: Status
  details?: () => void
  download?: () => void
  copy?: () => void
  hide?: () => void
  scale?: (f: number) => void
  earlier?: Item
  later?: Item
}

/** The text size row of the page's More menu: A−, the size (a click resets it), A+; it keeps the menu open. */
function showScale(d: Document, s: number) {
  const val = d.getElementById('bn-app-ts-val')
  if (val) val.textContent = `${Math.round(s * 100)}%`
  const less = d.getElementById('bn-app-ts-less') as HTMLButtonElement | null
  const more = d.getElementById('bn-app-ts-more') as HTMLButtonElement | null
  if (less) less.disabled = s <= SCALE_MIN + 0.001
  if (more) more.disabled = s >= SCALE_MAX - 0.001
}

/** Back and the status button in the page's own top bar, the app's items in its More menu (Download for offline and
    Open alone in the bar on a page whose report.js has no menu); false when the page has no such bar. */
function mountBar(d: Document, a: BarActions): boolean {
  const bar = d.querySelector('.bn-bar-in')
  if (!bar) return false
  bar.querySelectorAll('[data-app-ui]').forEach((n) => n.remove())
  if (!d.getElementById('bn-app-css')) {
    const s = d.createElement('style')
    s.id = 'bn-app-css'
    s.textContent = BAR_CSS
    d.head.appendChild(s)
  }
  const svg = (p: string) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`
  const btn = (tag: 'a' | 'button', cls: string, label: string, icon: string, title = label) => {
    const b = d.createElement(tag)
    b.className = `bn-btn ${cls}`
    b.setAttribute('data-app-ui', '')
    b.setAttribute('aria-label', label)
    b.title = title
    b.innerHTML = svg(icon)
    if (tag === 'button') (b as HTMLButtonElement).type = 'button'
    return b
  }
  const back = btn('a', 'bn-app-back', 'Back to the list', ICON.back) as HTMLAnchorElement
  back.href = new URL(a.back, location.href).href
  back.target = '_top'
  back.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return
    e.preventDefault()
    navigate(a.back)
  })
  bar.insertBefore(back, bar.firstChild)
  /* the status goes before the page's More menu; an older report.js without one gets everything at the end */
  const moreWrap = d.getElementById('bn-more-wrap')
  const put = (n: Element) => (moreWrap && moreWrap.parentNode === bar ? bar.insertBefore(n, moreWrap) : bar.appendChild(n))
  const sep = d.createElement('span')
  sep.className = 'bn-app-sep'
  sep.setAttribute('data-app-ui', '')
  put(sep)
  if (a.details && a.status && STATUSES.includes(a.status)) {
    const st = btn('button', 'bn-app-status', `Status: ${STATUS_LABEL[a.status]}`, '', 'Status, tags and projects')
    st.innerHTML = `<span class="bn-app-dot" style="${DOT[a.status]}"></span><span class="lbl">${STATUS_LABEL[a.status]}</span>`
    st.addEventListener('click', a.details)
    put(st)
  }
  const menu = d.getElementById('bn-menu-app')
  const item = (tag: 'a' | 'button', cls: string, label: string, icon: string, title?: string) => {
    if (!menu) return btn(tag, cls, label, icon, title)
    const b = d.createElement(tag)
    b.className = `bn-mi ${cls}`
    b.setAttribute('data-app-ui', '')
    b.setAttribute('role', 'menuitem')
    if (title) b.title = title
    b.innerHTML = `${svg(icon)}<span class="t">${label}</span>`
    if (tag === 'button') (b as HTMLButtonElement).type = 'button'
    return b
  }
  const add = (n: Element) => (menu ? menu.appendChild(n) : bar.appendChild(n))
  if (menu && a.scale) {
    const set = a.scale
    const row = d.createElement('div')
    row.className = 'bn-app-ts'
    row.setAttribute('data-app-ui', '')
    row.setAttribute('role', 'group')
    row.setAttribute('aria-label', 'Text size')
    row.innerHTML =
      '<span class="t">Text size</span>' +
      '<button type="button" id="bn-app-ts-less" aria-label="Smaller text">A−</button>' +
      '<button type="button" id="bn-app-ts-val" class="bn-app-ts-val" aria-label="Reset text size" title="Reset"></button>' +
      '<button type="button" id="bn-app-ts-more" aria-label="Larger text">A+</button>'
    const now = () => useTextScale.getState().scale
    row.querySelector('#bn-app-ts-less')!.addEventListener('click', () => set(now() - SCALE_STEP))
    row.querySelector('#bn-app-ts-val')!.addEventListener('click', () => set(1))
    row.querySelector('#bn-app-ts-more')!.addEventListener('click', () => set(now() + SCALE_STEP))
    menu.appendChild(row)
    showScale(d, now())
  }
  if (menu && a.hide) {
    const hide = item('button', 'bn-app-hide', 'Hide the bar', ICON.hide, 'Hide the bar while reading; Esc or a tap on the text brings it back')
    hide.insertAdjacentHTML('beforeend', '<kbd>Esc</kbd>')
    hide.addEventListener('click', a.hide)
    add(hide)
  }
  for (const [x, label, icon] of [
    [a.earlier, 'Earlier lesson', ICON.earlier],
    [a.later, 'Later lesson', ICON.later],
  ] as const) {
    if (!menu || !x) continue
    const to = item('a', 'bn-app-step', label, icon, x.title) as HTMLAnchorElement
    const hash = pageHash(x.url)
    to.href = new URL(hash, location.href).href
    to.target = '_top'
    to.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return
      e.preventDefault()
      navigate(hash)
    })
    add(to)
  }
  if (menu && a.copy) {
    const cp = item('button', 'bn-app-copy', 'Copy link', ICON.link, 'Copy the link to this page in the app')
    cp.addEventListener('click', a.copy)
    add(cp)
  }
  if (a.download) {
    const dl = item('button', 'bn-app-download', 'Download for offline', ICON.download)
    dl.addEventListener('click', a.download)
    add(dl)
  }
  const alone = item('a', 'bn-app-alone', 'Open the page alone', ICON.alone, a.path ? `Open the page alone: ${a.path}` : undefined) as HTMLAnchorElement
  alone.href = a.alone
  alone.target = '_blank'
  alone.rel = 'noopener'
  add(alone)
  return true
}

/** #/l/<slug> (old links, lesson-to-lesson links inside a page, the tutor's jobs): the page reader of that lesson. */
export function LessonRedirect({ slug }: { slug: string }) {
  const pages = useStore((s) => s.pages)
  const loaded = useStore((s) => s.pagesLoaded)
  const loadPages = useStore((s) => s.loadPages)
  const [retried, setRetried] = useState<{ slug: string; done: boolean } | null>(null)
  const target = pages.find((p) => p.slug === slug)
  useEffect(() => {
    if (target) navigate(pageHash(target.url), { replace: true })
  }, [target])
  // a lesson written after the list was loaded: load the list once more before "not found"
  useEffect(() => {
    if (loaded && !target && retried?.slug !== slug) {
      setRetried({ slug, done: false })
      loadPages()
        .catch(() => {})
        .finally(() => setRetried({ slug, done: true }))
    }
  }, [loaded, target, slug, retried, loadPages])
  if (loaded && !target && retried?.slug === slug && retried.done) {
    return (
      <div className="min-h-dvh">
        <NotFound what={`No lesson ${slug}.`} />
      </div>
    )
  }
  return null
}

/** On a phone the app itself must not zoom (a pinch changes the text size instead). */
function useNoPageZoom(on: boolean) {
  useEffect(() => {
    if (!on) return
    const meta = document.querySelector<HTMLMetaElement>('meta[name=viewport]')
    const was = meta?.content
    if (meta) meta.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
    const stop = (e: Event) => e.preventDefault()
    document.addEventListener('gesturestart', stop, { passive: false } as AddEventListenerOptions)
    return () => {
      if (meta && was) meta.content = was
      document.removeEventListener('gesturestart', stop)
    }
  }, [on])
}

const LS_HINT = 'tl-focus-hint'

const typingIn = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)
}

export function PageView({ url, backHash }: { url: string; backHash: string }) {
  const desk = useIsDesktop()
  const pages = useStore((s) => s.pages)
  const page = pages.find((p) => p.url === url)
  const src = rootUrl(url.replace(/^\//, ''))
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState(false)
  /* null while loading, true once the page's own bar carries the app's buttons, false for a page without one */
  const [merged, setMerged] = useState<boolean | null>(null)
  const shown = page?.title || title || decodeURIComponent(url.split('/').pop() || '')

  /* a lesson steps to the lesson written before or after it */
  const lessons = useMemo(() => pages.filter((p) => p.slug).sort((a, b) => (b.created || '').localeCompare(a.created || '') || (b.slug || '').localeCompare(a.slug || '')), [pages])
  const li = page?.slug ? lessons.findIndex((p) => p.url === url) : -1
  const earlier = li >= 0 ? lessons[li + 1] : undefined
  const later = li > 0 ? lessons[li - 1] : undefined

  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  useNoPageZoom(!desk || coarse)

  const doc = useCallback(() => {
    try {
      const d = frameRef.current?.contentDocument
      return d && d.URL !== 'about:blank' ? d : null
    } catch {
      return null
    }
  }, [])

  /* Hide the bar: the page's own bar slides away (reader.css, html.tl-focus); a hint says how to get it back, once */
  const focusRef = useRef(false)
  const [hint, setHint] = useState(false)
  const setFocus = useCallback(
    (on: boolean) => {
      if (focusRef.current === on) return
      focusRef.current = on
      setPageFocus(doc(), on)
      if (!on) return setHint(false)
      let seen = false
      try {
        seen = !!localStorage.getItem(LS_HINT)
        localStorage.setItem(LS_HINT, '1')
      } catch {
        seen = true
      }
      if (!seen) setHint(true)
    },
    [doc],
  )
  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(false), 2800)
    return () => clearTimeout(t)
  }, [hint])
  // what the page calls back: a tap on the text, Esc
  const setFocusRef = useRef(setFocus)
  setFocusRef.current = setFocus
  const pageHooks = useRef<PageHooks>({
    focus: () => focusRef.current,
    tap: () => setFocusRef.current(!focusRef.current),
    esc: () => setFocusRef.current(!focusRef.current),
  }).current

  // Esc in the app (the page sends its own): hide or show the bar, unless a menu or dialog takes it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.metaKey || e.ctrlKey || e.altKey || typingIn(e.target)) return
      if (document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"],[data-slot="popover-content"]')) return
      setFocus(!focusRef.current)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [setFocus])

  const onScale = useCallback(
    (f: number) => {
      const d = doc()
      const v = Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(f * 20) / 20))
      if (d) applyScale(d, v, topAnchor(d))
      useTextScale.getState().set(v)
    },
    [doc],
  )
  const scale = useTextScale((s) => s.scale)
  useEffect(() => {
    const d = doc()
    if (d) showScale(d, scale)
  }, [scale, doc])

  // dress the page as soon as it exists (not only at load, which waits for every image)
  useEffect(() => {
    if (ready) return
    let raf = 0
    const until = Date.now() + 20000
    const tick = () => {
      const d = doc()
      if (d && d.documentElement) dressPage(d, pageHooks)
      if (Date.now() < until) raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [ready, doc, pageHooks])

  useEffect(() => {
    document.title = `${shown} · Agent Pages`
  }, [shown])
  useEffect(() => {
    setReady(false)
    setMerged(null)
    setFocus(false)
  }, [url, setFocus])
  useEffect(() => () => borrowPageTokens(null), [])

  /* the page's bar learns the path, the status and the tags once the list has loaded, and follows their changes */
  const copy = async () => ((await copyText(hereUrl(pageHash(url)))) ? toast.success('Link copied') : toast.error('Could not copy'))
  const actions: BarActions = {
    back: backHash,
    alone: src,
    path: page?.path,
    status: page?.status,
    details: page ? () => setDetails(true) : undefined,
    download: () => downloadForOffline(url),
    copy,
    hide: () => setFocus(true),
    scale: onScale,
    earlier,
    later,
  }
  const actionsRef = useRef(actions)
  actionsRef.current = actions
  useEffect(() => {
    const d = frameRef.current?.contentDocument
    if (merged && d) mountBar(d, actionsRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merged, page?.path, page?.status, backHash, earlier?.url, later?.url])

  return (
    <div className="fixed inset-0 flex flex-col bg-background pt-[var(--safe-top)]">
      {merged === null ? (
        <IconTip label="Back to the list" side="bottom">
          <Button variant="ghost" size="icon" asChild className="absolute top-[calc(var(--safe-top)+0.5rem)] left-1.5 z-30 desk:size-7">
            <a href={backHash} aria-label="Back to the list">
              <ChevronLeftIcon className="size-5 desk:size-4" />
            </a>
          </Button>
        </IconTip>
      ) : null}
      {merged === false ? (
      <header className="relative z-20 shrink-0 border-b bg-card">
        <div className="flex h-[3.25rem] items-center gap-1 px-1.5 desk:h-12 desk:gap-1.5 desk:px-2">
          <IconTip label="Back to the list" side="bottom">
            <Button variant="ghost" size="icon" asChild className="shrink-0 desk:size-7">
              <a href={backHash} aria-label="Back to the list">
                <ChevronLeftIcon className="size-5 desk:size-4" />
              </a>
            </Button>
          </IconTip>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] leading-tight font-semibold tracking-[-0.01em] desk:text-[13.5px]" title={shown}>
              {shown}
            </div>
            {page ? (
              <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={page.path}>
                {page.path}
              </div>
            ) : null}
          </div>
          {page ? (
            <>
              <TagsButton item={page} className="shrink-0" />
              <StatusMenu item={page} className="shrink-0" />
            </>
          ) : null}
          <DropdownMenu>
            <IconTip label="More" side="bottom">
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="shrink-0 desk:size-7" aria-label="More">
                  <MoreHorizontalIcon className="size-[18px] desk:size-4" />
                </Button>
              </DropdownMenuTrigger>
            </IconTip>
            <DropdownMenuContent align="end" className="w-56">
              <ThemeMenuItem />
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={copy}>
                <LinkIcon /> Copy link
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadForOffline(url)}>
                <CloudDownloadIcon /> Download for offline
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={src} target="_blank" rel="noopener">
                  <ArrowUpRightIcon /> Open the page alone
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      ) : null}
      <div className="relative min-h-0 flex-1 bg-background pb-[var(--safe-bottom)]">
        <div className={cn('pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden transition-opacity', ready ? 'opacity-0' : 'opacity-100')}>
          <div className="h-full w-1/3 animate-[tl-load_1.1s_ease-in-out_infinite] bg-primary/60" />
        </div>
        <iframe
          key={url}
          ref={frameRef}
          src={src}
          title={shown}
          allow="clipboard-write"
          className="absolute inset-0 size-full border-0"
          onLoad={() => {
            try {
              const d = frameRef.current?.contentDocument
              if (d) {
                dressPage(d, pageHooks)
                setMerged(mountBar(d, actionsRef.current))
                bindPageTheme(d)
                borrowPageTokens(d)
                if (d.title) setTitle(d.title)
                stackTables(d)
                setTimeout(() => stackTables(d), 600) // report.js wraps tables after load
              } else setMerged(false)
            } catch {
              setMerged(false) /* another origin */
            }
            setReady(true)
          }}
        />
      </div>
      <div
        aria-live="polite"
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-[calc(var(--safe-bottom)+1rem)] z-30 flex justify-center transition-[opacity,translate] duration-200',
          hint ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
        )}
      >
        {hint ? (
          <span className="rounded-full bg-zinc-900/85 px-3.5 py-1.5 text-[12.5px] font-medium text-white shadow-pop backdrop-blur">
            {desk && !coarse ? 'Press Esc to show the bar' : 'Tap the text to show the bar'}
          </span>
        ) : null}
      </div>
      {page ? <DetailsDialog item={page} open={details} onOpenChange={setDetails} /> : null}
    </div>
  )
}
