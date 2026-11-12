/* #/r/<url>: one report page inside the app. The app puts Back, "Move to lessons" and "Open alone" into the page's own
   top bar (same origin), so one bar carries the title; a page without that bar (no report.js) gets the app's bar.
   Opening it in place kept the app's history but left the phone's standalone app with no way back.
   "Move to lessons" adds the lesson marker to the page file (POST api/pages/kind) and opens it as a lesson. */
import { useEffect, useRef, useState } from 'react'
import { ArrowUpRightIcon, ChevronLeftIcon, GraduationCapIcon } from 'lucide-react'
import { toast } from 'sonner'
import { rootUrl } from '@/lib/api'
import { stackTables } from '@/lib/reader-page'
import { bindPageTheme, borrowPageTokens } from '@/lib/theme'
import { lessonHash, navigate } from '@/lib/router'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { IconTip } from '@/components/bits'
import { ThemeButton } from '@/components/theme-toggle'

const ICON = {
  back: '<path d="m15 18-6-6 6-6"/>',
  lesson:
    '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  alone: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
}

const BAR_CSS = `
.bn-app-back { margin-left: -.55rem; color: var(--muted); text-decoration: none; }
.bn-app-back:hover { color: var(--ink); }
.bn-app-sep { flex: none; width: 1px; height: 1.25rem; margin: 0 .15rem; background: var(--line); }
a.bn-btn { text-decoration: none; }
@media (max-width: 720px) { .bn-app-back { margin-left: -.35rem; } .bn-app-alone, .bn-app-sep { display: none; } }
`

interface BarActions {
  back: string
  alone: string
  path?: string
  toLessons?: () => void
}

/** Back, Move to lessons and Open alone in the page's own top bar; false when the page has no such bar. */
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
  const back = btn('a', 'bn-app-back', 'Back to the reports', ICON.back) as HTMLAnchorElement
  back.href = new URL(a.back, location.href).href
  back.target = '_top'
  back.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return
    e.preventDefault()
    navigate(a.back)
  })
  bar.insertBefore(back, bar.firstChild)
  const sep = d.createElement('span')
  sep.className = 'bn-app-sep'
  sep.setAttribute('data-app-ui', '')
  bar.appendChild(sep)
  if (a.toLessons) {
    const l = btn('button', 'bn-app-lesson', 'Move to lessons', ICON.lesson)
    l.addEventListener('click', a.toLessons)
    bar.appendChild(l)
  }
  const alone = btn('a', 'bn-app-alone', 'Open the page alone', ICON.alone, a.path ? `Open the page alone: ${a.path}` : undefined) as HTMLAnchorElement
  alone.href = a.alone
  alone.target = '_blank'
  alone.rel = 'noopener'
  bar.appendChild(alone)
  return true
}

export function PageView({ url, backHash }: { url: string; backHash: string }) {
  const pages = useStore((s) => s.pages)
  const page = pages.find((p) => p.url === url)
  const src = rootUrl(url.replace(/^\//, ''))
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [title, setTitle] = useState('')
  const [moving, setMoving] = useState(false)
  /* null while loading, true once the page's own bar carries the app's buttons, false for a page without one */
  const [merged, setMerged] = useState<boolean | null>(null)
  const setPageKind = useStore((s) => s.setPageKind)
  const toLessons = async () => {
    if (moving) return
    setMoving(true)
    try {
      const r = await setPageKind(url, 'lesson')
      if (r.slug) navigate(lessonHash(r.slug), { replace: true })
      toast.success('Moved to lessons', { description: 'The page file now carries the lesson marker.' })
    } catch (e) {
      toast.error((e as Error).message)
    }
    setMoving(false)
  }
  const shown = page?.title || title || decodeURIComponent(url.split('/').pop() || '')

  useEffect(() => {
    document.title = `${shown} · Agent Pages`
  }, [shown])
  useEffect(() => {
    setReady(false)
    setMerged(null)
  }, [url])
  useEffect(() => () => borrowPageTokens(null), [])

  /* the page's bar learns the path and the lesson action once the page list has loaded */
  const actions: BarActions = { back: backHash, alone: src, path: page?.path, toLessons: page ? toLessons : undefined }
  const actionsRef = useRef(actions)
  actionsRef.current = actions
  useEffect(() => {
    const d = frameRef.current?.contentDocument
    if (merged && d) mountBar(d, actionsRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merged, page?.path, backHash])

  return (
    <div className="fixed inset-0 flex flex-col bg-background pt-[var(--safe-top)]">
      {merged === null ? (
        <IconTip label="Back to the reports" side="bottom">
          <Button variant="ghost" size="icon" asChild className="absolute top-[calc(var(--safe-top)+0.5rem)] left-1.5 z-30 desk:size-7">
            <a href={backHash} aria-label="Back to the reports">
              <ChevronLeftIcon className="size-5 desk:size-4" />
            </a>
          </Button>
        </IconTip>
      ) : null}
      {merged === false ? (
      <header className="relative z-20 shrink-0 border-b bg-card">
        <div className="flex h-[3.25rem] items-center gap-1 px-1.5 desk:h-12 desk:gap-1.5 desk:px-2">
          <IconTip label="Back to the reports" side="bottom">
            <Button variant="ghost" size="icon" asChild className="shrink-0 desk:size-7">
              <a href={backHash} aria-label="Back to the reports">
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
            <IconTip label="Move to lessons" side="bottom">
              <Button variant="ghost" size="icon" className="shrink-0 desk:size-7" disabled={moving} onClick={toLessons} aria-label="Move to lessons">
                <GraduationCapIcon className="size-[18px] desk:size-4" />
              </Button>
            </IconTip>
          ) : null}
          <ThemeButton className="desk:size-7" iconClassName="size-[18px] desk:size-4" />
          <IconTip label="Open the page alone" side="bottom">
            <Button variant="ghost" size="icon" asChild className="shrink-0 desk:size-7">
              <a href={src} target="_blank" rel="noopener" aria-label="Open the page alone">
                <ArrowUpRightIcon className="size-[18px] desk:size-4" />
              </a>
            </Button>
          </IconTip>
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
    </div>
  )
}
