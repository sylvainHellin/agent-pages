/* #/l/<slug>: the lesson page in an iframe (same origin), its bar, and the review bar under it.

   The page (lessons/_assets/report.js) keeps answers, comments and notes in localStorage and exposes
   window.bn.review. This view
     - pulls the review state of other devices before the page loads and pushes it while reading (sync.ts),
     - counts what is ready and sends it to the tutor (POST api/lessons/<slug>/feedback = a revise job),
     - shows the revise job's state and reloads the page when the job is done.
   Links between lessons inside the page set this window's hash (#/l/<slug>), so the same iframe switches
   lesson with location.replace (no extra history entries).
   What the app adds inside the page (reader.css, text size, pinch, tap-to-focus) is src/lib/reader-page.ts.
   An in-place lesson (a marked page under a root, slug page-<hash>) loads from its own server path, syncs
   its review under the page's storage key, shows its folder in the bar and can move back to the reports.
   Focus mode: a tap on the text (or Esc) folds the bars away; the page is scrolled by the same amount the
   iframe moves, so the line being read stays where it is. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangleIcon,
  ArrowUpRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
  FolderPlusIcon,
  LinkIcon,
  Maximize2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SendIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, folderOf, isActive, lessonDocKey, lessonPageUrl, type Lesson } from '@/lib/api'
import { dayLabel, plural } from '@/lib/format'
import { copyText, useIsDesktop } from '@/lib/hooks'
import { applyScale, dressPage, SCALE_MAX, SCALE_MIN, SCALE_STEP, setPageFocus, stackTables, topAnchor, useTextScale, type PageHooks } from '@/lib/reader-page'
import { hereUrl, lessonHash, navigate, pageHash } from '@/lib/router'
import { useStore } from '@/lib/store'
import * as sync from '@/lib/sync'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconTip, Kbd, ProjectChip, Spinner } from '@/components/bits'
import { EditLesson, ProjectPicker, StatusMenu } from '@/components/lesson-meta'
import { ThemeMenuItem } from '@/components/theme-toggle'
import { borrowPageTokens } from '@/lib/theme'
import { NotFound } from '@/components/lessons'

interface Review {
  markdown(): string
  sent(): void
  counts(): { answers: number; comments: number; notes: number }
}
type Counts = ReturnType<Review['counts']>

type PageWindow = Window & { bn?: { review?: Review } }

/* ---------- bar ---------- */

/** A− 100% A+ inside the ⋯ menu; the menu stays open while the size changes. */
function TextSizeRow({ onScale }: { onScale: (f: number) => void }) {
  const scale = useTextScale((s) => s.scale)
  const btn = 'h-7 w-8 justify-center rounded-md px-0 text-[13px] font-medium tabular-nums'
  return (
    <div className="flex items-center gap-0.5 py-0.5 pr-1 pl-2 text-[13px]">
      <span className="flex-1 text-foreground/90">Text size</span>
      <DropdownMenuItem
        className={btn}
        disabled={scale <= SCALE_MIN + 0.001}
        aria-label="Smaller text"
        onSelect={(e) => {
          e.preventDefault()
          onScale(scale - SCALE_STEP)
        }}
      >
        A−
      </DropdownMenuItem>
      <DropdownMenuItem
        className="h-7 w-11 justify-center rounded-md px-0 text-xs text-muted-foreground tabular-nums"
        aria-label="Reset text size"
        title="Reset"
        onSelect={(e) => {
          e.preventDefault()
          onScale(1)
        }}
      >
        {Math.round(scale * 100)}%
      </DropdownMenuItem>
      <DropdownMenuItem
        className={btn}
        disabled={scale >= SCALE_MAX - 0.001}
        aria-label="Larger text"
        onSelect={(e) => {
          e.preventDefault()
          onScale(scale + SCALE_STEP)
        }}
      >
        A+
      </DropdownMenuItem>
    </div>
  )
}

function ReaderBar({
  lesson: l,
  backHash,
  older,
  newer,
  onScale,
  onFocus,
}: {
  lesson: Lesson
  backHash: string
  older?: Lesson
  newer?: Lesson
  onScale: (f: number) => void
  onFocus: () => void
}) {
  const desk = useIsDesktop()
  const unlink = useStore((s) => s.unlinkProject)
  const setPageKind = useStore((s) => s.setPageKind)
  const [picker, setPicker] = useState(false)
  const [edit, setEdit] = useState(false)
  const toReports = async () => {
    if (!l.url) return
    try {
      const r = await setPageKind(l.url, 'report')
      navigate(pageHash(r.url || l.url), { replace: true })
      toast.success('Moved to reports', { description: 'The lesson marker is removed from the page file.' })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const copy = async () => ((await copyText(hereUrl(lessonHash(l.slug)))) ? toast.success('Link copied') : toast.error('Could not copy'))
  const go = (x?: Lesson) => x && navigate(lessonHash(x.slug))
  const sub = [l.topic, dayLabel(l.created, true)].filter(Boolean).join(' · ')
  return (
    <header className="border-b bg-card">
      <div className="flex h-[3.25rem] items-center gap-1 px-1.5 desk:h-12 desk:gap-1.5 desk:px-2">
        <IconTip label="Back to the library" side="bottom">
          <Button variant="ghost" size="icon" asChild className="shrink-0 desk:size-7">
            <a href={backHash} aria-label="Back to the library">
              <ChevronLeftIcon className="size-5 desk:size-4" />
            </a>
          </Button>
        </IconTip>
        <div className="min-w-0 flex-1 desk:flex desk:items-baseline desk:gap-2.5">
          <div className="truncate text-[14px] leading-tight font-semibold tracking-[-0.01em] break-keep desk:min-w-0 desk:shrink desk:text-[13.5px]" title={l.title}>
            {l.title}
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground desk:mt-0 desk:max-w-[16rem] desk:shrink-0 desk:text-xs" title={sub}>
            {sub}
          </div>
          {l.inplace && l.path ? (
            <div className="hidden min-w-0 shrink truncate font-mono text-[11px] text-muted-foreground desk:block" title={l.path}>
              {folderOf(l.path)}
            </div>
          ) : null}
        </div>
        <div className="hidden min-w-0 shrink items-center gap-1 overflow-hidden desk:flex">
          {l.projects.map((p) => (
            <ProjectChip key={p} id={p} warn={l.unknown_projects?.includes(p)} onRemove={() => unlink(l.slug, p).catch(() => {})} />
          ))}
          {l.projects.length ? (
            <IconTip label="Link to projects" side="bottom">
              <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => setPicker(true)} aria-label="Link to projects">
                <PlusIcon />
              </Button>
            </IconTip>
          ) : (
            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setPicker(true)}>
              <PlusIcon /> Link to project
            </Button>
          )}
        </div>
        <span aria-hidden className="mx-1 hidden h-4 w-px shrink-0 bg-border desk:block" />
        <StatusMenu lesson={l} className="shrink-0" />
        <DropdownMenu>
          <IconTip label="More" side="bottom">
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 desk:size-7" aria-label="More">
                <MoreHorizontalIcon className="size-[18px] desk:size-4" />
              </Button>
            </DropdownMenuTrigger>
          </IconTip>
          <DropdownMenuContent align="end" className="w-60">
            <TextSizeRow onScale={onScale} />
            <DropdownMenuItem onSelect={onFocus}>
              <Maximize2Icon /> <span className="flex-1">Hide controls</span>
              {desk ? <Kbd>Esc</Kbd> : null}
            </DropdownMenuItem>
            <ThemeMenuItem />
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setPicker(true)}>
              <FolderPlusIcon /> <span className="min-w-0 flex-1 truncate">Link to projects{l.projects.length ? ` (${l.projects.length})` : '…'}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEdit(true)}>
              <PencilIcon /> Edit details…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!older} onSelect={() => go(older)}>
              <ChevronLeftIcon /> Earlier lesson
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!newer} onSelect={() => go(newer)}>
              <ChevronRightIcon /> Later lesson
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={copy}>
              <LinkIcon /> Copy link
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={lessonPageUrl(l)} target="_blank" rel="noopener">
                <ArrowUpRightIcon /> Open the page alone
              </a>
            </DropdownMenuItem>
            {l.inplace && l.url ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={toReports}>
                  <FileTextIcon /> Move to reports
                </DropdownMenuItem>
                {l.path ? (
                  <div className="truncate px-2 pt-1 pb-1.5 font-mono text-[11px] text-muted-foreground desk:hidden" title={l.path}>
                    {folderOf(l.path)}
                  </div>
                ) : null}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ProjectPicker slug={l.slug} open={picker} onOpenChange={setPicker} />
      <EditLesson lesson={l} open={edit} onOpenChange={setEdit} />
    </header>
  )
}

/* ---------- review bar ---------- */

function ReviewBar({ slug, frame, shown }: { slug: string; frame: () => PageWindow | null; shown: () => string | null }) {
  const jobs = useStore((s) => s.jobs)
  const send = useStore((s) => s.sendFeedback)
  const revision = jobs.find((j) => j.kind === 'revise' && j.slug === slug && isActive(j))
  const [counts, setCounts] = useState<Counts | null>(null)
  const [sending, setSending] = useState(false)
  const review = useCallback((): Review | null => {
    try {
      return frame()?.bn?.review || null
    } catch {
      return null
    }
  }, [frame])

  useEffect(() => {
    setCounts(null)
    if (revision) return
    const tick = () => {
      if (shown() !== slug) return setCounts(null)
      sync.push(slug)
      let c: Counts | null = null
      try {
        c = review()?.counts?.() || null
      } catch {
        c = null
      }
      setCounts((p) => (p && c && p.answers === c.answers && p.comments === c.comments && p.notes === c.notes ? p : c))
    }
    tick()
    const t = setInterval(tick, 1500)
    return () => clearInterval(t)
  }, [slug, !!revision, review, shown]) // eslint-disable-line react-hooks/exhaustive-deps

  const onSend = async () => {
    const r = review()
    if (!r) return
    setSending(true)
    try {
      await send(slug, r.markdown())
      try {
        r.sent()
      } catch {
        /* older page */
      }
      sync.push(slug)
      toast.success('Sent. The tutor revises this page.')
    } catch (e) {
      toast.error((e as Error).message)
    }
    setSending(false)
  }

  let body: React.ReactNode = null
  let action: React.ReactNode = null
  if (revision) {
    body =
      revision.status === 'attention' ? (
        <span className="flex items-center gap-2 text-attention">
          <AlertTriangleIcon className="size-3.5 shrink-0" /> The tutor is waiting for you (tuios session “tutor”)
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <Spinner /> {revision.status === 'queued' ? 'Waiting for the tutor…' : 'The tutor is revising this page…'}
        </span>
      )
    action = (
      <Button variant="ghost" size="sm" asChild className="shrink-0">
        <a href="#/jobs">
          Jobs <ChevronRightIcon />
        </a>
      </Button>
    )
  } else if (counts) {
    const n = counts.answers + counts.comments + counts.notes
    if (n) {
      body = (
        <span>
          <b className="font-medium text-foreground">
            {[counts.answers && plural(counts.answers, 'answer'), counts.comments && plural(counts.comments, 'comment'), counts.notes && 'notes'].filter(Boolean).join(' · ')}
          </b>{' '}
          ready to send
        </span>
      )
      action = (
        <Button onClick={onSend} disabled={sending} className="shrink-0 max-desk:h-9 max-desk:px-3.5">
          {sending ? <Spinner className="border-primary-foreground/30 border-t-primary-foreground" /> : <SendIcon className="size-3.5" />} Send to tutor
        </Button>
      )
    } else body = <span>Answer the questions, or select text to comment. Answers sync across your devices.</span>
  }
  if (!body) return null
  return (
    <footer className="flex min-h-[3.25rem] items-center gap-3 border-t bg-card px-4 py-2 text-[13px] leading-snug text-muted-foreground desk:min-h-11 desk:py-1.5 desk:pr-2 desk:pl-4">
      <div className="min-w-0 flex-1 break-keep">{body}</div>
      {action}
    </footer>
  )
}

/* ---------- focus mode ---------- */

const LS_HINT = 'tl-focus-hint'

/** Folds its content away (height and opacity) without unmounting it. */
function Fold({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('grid transition-[grid-template-rows,opacity] duration-[180ms] ease-out motion-reduce:transition-none', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr] opacity-0', className)}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

/** On a phone the page itself must not zoom (a pinch changes the text size instead). */
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

const typingIn = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)
}

/* ---------- view ---------- */

export function ReaderView({ slug, backHash }: { slug: string; backHash: string }) {
  const desk = useIsDesktop()
  const lessons = useStore((s) => s.lessons)
  const loaded = useStore((s) => s.lessonsLoaded)
  const loadLessons = useStore((s) => s.loadLessons)
  const jobs = useStore((s) => s.jobs)
  const i = lessons.findIndex((l) => l.slug === slug)
  useEffect(() => () => borrowPageTokens(null), []) // the library gets the app theme back
  const lesson = i >= 0 ? lessons[i] : undefined
  const frameRef = useRef<HTMLIFrameElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const current = useRef<string | null>(null) // the lesson whose page is in the iframe
  const [retried, setRetried] = useState<{ slug: string; done: boolean } | null>(null)
  const [ready, setReady] = useState(false)
  const [focus, setFocusState] = useState(false)
  const [hint, setHint] = useState(false)
  const focusRef = useRef(false)
  const moving = useRef(0) // until when the bars are folding: keep the text still

  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  useNoPageZoom(!desk || coarse)

  const win = useCallback(() => (frameRef.current?.contentWindow as PageWindow | null) || null, [])
  const doc = useCallback(() => {
    try {
      return frameRef.current?.contentDocument || null
    } catch {
      return null
    }
  }, [])
  const shown = useCallback(() => current.current, [])
  const reload = useCallback(() => {
    try {
      setReady(false)
      frameRef.current?.contentWindow?.location.reload()
    } catch {
      /* gone */
    }
  }, [])

  const setFocus = useCallback(
    (on: boolean) => {
      if (focusRef.current === on) return
      focusRef.current = on
      moving.current = Date.now() + 450
      setFocusState(on)
      setPageFocus(doc(), on)
      if (on) {
        let seen = false
        try {
          seen = !!localStorage.getItem(LS_HINT)
          localStorage.setItem(LS_HINT, '1')
        } catch {
          seen = true
        }
        if (!seen) setHint(true)
      } else setHint(false)
    },
    [doc],
  )
  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(false), 2800)
    return () => clearTimeout(t)
  }, [hint])

  // what the page calls back: a tap on the text, Esc
  const hooks = useRef<PageHooks>({ focus: () => false, tap: () => {}, esc: () => {} })
  hooks.current.focus = () => focusRef.current
  hooks.current.tap = () => setFocus(!focusRef.current)
  hooks.current.esc = () => setFocus(!focusRef.current)
  const pageHooks = useRef<PageHooks>({
    focus: () => hooks.current.focus(),
    tap: () => hooks.current.tap(),
    esc: () => hooks.current.esc(),
  }).current

  const onScale = useCallback(
    (f: number) => {
      const d = doc()
      const v = Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(f * 20) / 20))
      if (d) applyScale(d, v, topAnchor(d))
      useTextScale.getState().set(v)
    },
    [doc],
  )

  // Esc in the app (the page sends its own): fold or show the bars, unless a menu or dialog takes it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.metaKey || e.ctrlKey || e.altKey || typingIn(e.target)) return
      if (document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"],[data-slot="popover-content"]')) return
      setFocus(!focusRef.current)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [setFocus])

  // while the bars fold, scroll the page by as much as the iframe moves: the text stays put
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    let top = box.getBoundingClientRect().top
    const ro = new ResizeObserver(() => {
      const t = box.getBoundingClientRect().top
      const dy = t - top
      top = t
      if (!dy || Date.now() > moving.current) return
      const w = frameRef.current?.contentWindow
      if (!w) return
      try {
        const h = w.document.documentElement
        const was = h.style.scrollBehavior
        h.style.scrollBehavior = 'auto'
        w.scrollBy(0, dy)
        h.style.scrollBehavior = was
      } catch {
        /* cross-origin */
      }
    })
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  // dress the page as soon as it exists (not only at load, which waits for every image)
  useEffect(() => {
    if (ready) return
    let raf = 0
    const until = Date.now() + 20000
    const tick = () => {
      const d = doc()
      if (d && d.documentElement && d.URL !== 'about:blank') dressPage(d, pageHooks)
      if (Date.now() < until) raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [ready, doc, pageHooks])

  useEffect(() => {
    if (lesson) document.title = `${lesson.title} · Agent Pages`
  }, [lesson])

  // a lesson written after the list was loaded: load the list once more before "not found"
  useEffect(() => {
    if (loaded && !lesson && retried?.slug !== slug) {
      setRetried({ slug, done: false })
      loadLessons()
        .catch(() => {})
        .finally(() => setRetried({ slug, done: true }))
    }
  }, [loaded, lesson, slug, retried, loadLessons])

  // put the lesson into the iframe: push the one we leave, pull this one, then load it in place
  const exists = !!lesson
  useEffect(() => {
    if (!exists || current.current === slug) return
    let cancelled = false
    const prev = current.current
    if (prev) sync.push(prev)
    setReady(false)
    const target = lessons.find((l) => l.slug === slug)!
    sync.setKey(slug, lessonDocKey(target))
    const url = lessonPageUrl(target)
    sync.pull(slug).then(() => {
      const f = frameRef.current
      if (cancelled || !f) return
      current.current = slug
      try {
        f.contentWindow!.location.replace(url)
      } catch {
        f.src = url
      }
    })
    api(`lessons/${encodeURIComponent(slug)}/opened`, { method: 'POST' }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [slug, exists]) // eslint-disable-line react-hooks/exhaustive-deps

  // leaving the reader; the app going to the background; coming back with answers from another device
  useEffect(() => {
    let lastPull = 0
    const comeBack = () => {
      const s = current.current
      if (!s || Date.now() - lastPull < 5000) return
      lastPull = Date.now()
      sync.pull(s).then((changed) => {
        if (changed && current.current === s) {
          reload()
          toast('Updated with answers from another device')
        }
      })
    }
    const onVis = () => (document.visibilityState === 'hidden' ? sync.push(current.current, true) : comeBack())
    const onHide = () => sync.push(current.current, true)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onHide)
    window.addEventListener('focus', comeBack)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('focus', comeBack)
      sync.push(current.current)
    }
  }, [reload])

  // the revise job for this lesson finished: show the new page
  const watching = useRef<string | null>(null)
  useEffect(() => {
    const active = jobs.find((j) => j.kind === 'revise' && j.slug === slug && isActive(j))
    if (active) {
      watching.current = active.id
      return
    }
    if (!watching.current) return
    const j = jobs.find((x) => x.id === watching.current)
    watching.current = null
    if (j?.status === 'done' && j.slug === current.current) {
      reload()
      toast.success('Page revised')
    }
  }, [jobs, slug, reload])

  if (loaded && !lesson && retried?.slug === slug && retried.done) {
    return (
      <div className="min-h-dvh">
        <NotFound what={`No lesson ${slug}.`} />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-card" data-focus={focus || undefined}>
      <div className="relative z-20 shrink-0 bg-card pt-[var(--safe-top)]">
        <Fold open={!focus}>
          {lesson ? (
            <ReaderBar
              lesson={lesson}
              backHash={backHash}
              older={lessons[i + 1]}
              newer={i > 0 ? lessons[i - 1] : undefined}
              onScale={onScale}
              onFocus={() => setFocus(true)}
            />
          ) : (
            <div className="h-[3.25rem] border-b desk:h-12" />
          )}
        </Fold>
      </div>
      <div ref={boxRef} className="relative min-h-0 flex-1 bg-background">
        <div className={cn('pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden transition-opacity', ready ? 'opacity-0' : 'opacity-100')}>
          <div className="h-full w-1/3 animate-[tl-load_1.1s_ease-in-out_infinite] bg-primary/60" />
        </div>
        <iframe
          ref={frameRef}
          title={lesson?.title || 'Lesson'}
          allow="clipboard-write"
          className="absolute inset-0 size-full border-0"
          onLoad={() => {
            const d = doc()
            if (!d || d.URL === 'about:blank') return
            try {
              dressPage(d, pageHooks)
              borrowPageTokens(d) // the bars around the lesson take its theme
              stackTables(d)
              setTimeout(() => stackTables(d), 600) // report.js wraps tables after load
            } catch {
              /* not a lesson page */
            }
            setReady(true)
          }}
        />
        <div
          aria-live="polite"
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center transition-[opacity,translate] duration-200',
            hint ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
          )}
        >
          {hint ? (
            <span className="rounded-full bg-zinc-900/85 px-3.5 py-1.5 text-[12.5px] font-medium text-white shadow-pop backdrop-blur">
              {desk ? 'Click the text or press Esc to show controls' : 'Tap the text to show controls'}
            </span>
          ) : null}
        </div>
      </div>
      <div className="relative z-20 shrink-0 bg-card pb-[var(--safe-bottom)]">
        <Fold open={!focus}>
          <ReviewBar key={slug} slug={slug} frame={win} shown={shown} />
        </Fold>
      </div>
    </div>
  )
}
