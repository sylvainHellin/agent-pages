/* #/r/<url>: one page inside the app. The app puts Back and the page's status into the page's own top bar (same
   origin), and Download for offline and Open alone into that bar's More menu, so one bar carries the title; a page
   without that bar (no report.js) gets the app's bar.
   Opening it in place kept the app's history but left the phone's standalone app with no way back.
   The status button opens the details dialog (status, tags, projects; PATCH api/items/<id>); the lesson tag writes the
   lesson marker into the page file, and the page goes on to the lesson reader (#/l/<slug>), as does a #/r/ link to a
   page that already has the tag.
   "Download for offline" saves the page with its template files and images in the service worker's cache. */
import { useEffect, useRef, useState } from 'react'
import { ArrowUpRightIcon, ChevronLeftIcon, CloudDownloadIcon, MoreHorizontalIcon } from 'lucide-react'
import { toast } from 'sonner'
import { rootUrl, STATUSES, type Status } from '@/lib/api'
import { prefetchPages } from '@/lib/offline'
import { stackTables } from '@/lib/reader-page'
import { bindPageTheme, borrowPageTokens } from '@/lib/theme'
import { lessonHash, navigate } from '@/lib/router'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconTip, STATUS_LABEL } from '@/components/bits'
import { DetailsDialog, StatusMenu, TagsButton } from '@/components/lesson-meta'
import { ThemeMenuItem } from '@/components/theme-toggle'

const ICON = {
  back: '<path d="m15 18-6-6 6-6"/>',
  alone: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  download: '<path d="M12 13v8l-4-4"/><path d="m12 21 4-4"/><path d="M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284"/>',
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
`

interface BarActions {
  back: string
  alone: string
  path?: string
  status?: Status
  details?: () => void
  download?: () => void
}

/** Back and the status button in the page's own top bar, Download for offline and Open alone in its More menu (in the
    bar on a page whose report.js has no menu); false when the page has no such bar. */
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

export function PageView({ url, backHash }: { url: string; backHash: string }) {
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

  // a page with the lesson tag is read in the lesson reader (just tagged, old #/r/ links, tagged on another device),
  // once the details dialog has closed
  const slug = page?.slug
  useEffect(() => {
    if (!slug) return
    setDetails(false)
    const t = setTimeout(() => navigate(lessonHash(slug), { replace: true }), 250)
    return () => clearTimeout(t)
  }, [slug])

  useEffect(() => {
    document.title = `${shown} · Agent Pages`
  }, [shown])
  useEffect(() => {
    setReady(false)
    setMerged(null)
  }, [url])
  useEffect(() => () => borrowPageTokens(null), [])

  /* the page's bar learns the path, the status and the tags once the list has loaded, and follows their changes */
  const actions: BarActions = { back: backHash, alone: src, path: page?.path, status: page?.status, details: page ? () => setDetails(true) : undefined, download: () => downloadForOffline(url) }
  const actionsRef = useRef(actions)
  actionsRef.current = actions
  useEffect(() => {
    const d = frameRef.current?.contentDocument
    if (merged && d) mountBar(d, actionsRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merged, page?.path, page?.status, backHash])

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
      {page ? <DetailsDialog item={page} open={details} onOpenChange={setDetails} /> : null}
    </div>
  )
}
