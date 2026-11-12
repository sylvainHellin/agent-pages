/* #/reports: every report page under the server's roots, newest first under day and month headings, filtered by words in
   the title or path and by area: a group (first folder, work) or one of its sub-areas (work/notes), picked in the sidebar on a
   desktop and in the header menu on a phone (src/lib/areas.ts). A page opens in the app (#/r/...) under its own bar with Back.
   Pages with the lesson marker (<meta name="agent-pages-kind" content="lesson">) are listed with the lessons instead. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { SearchIcon, XIcon } from 'lucide-react'
import { type ReportPage } from '@/lib/api'
import { areaBelow, inArea } from '@/lib/areas'
import { MONTHS, WDAYS, plural } from '@/lib/format'
import { pageHash } from '@/lib/router'
import { useStore } from '@/lib/store'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty, PageHeader } from '@/components/bits'

const DAY = 86400

function Hit({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig')
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="rounded-[2px] bg-primary/15 text-inherit">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The heading a page sorts under: Today, Yesterday, This week, then one per month. */
function bucketOf(d: Date, now: Date): string {
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / (DAY * 1000))
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'This week'
  return d.getFullYear() === now.getFullYear() ? MONTHS[d.getMonth()] : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** The time beside a row: the hour today and yesterday, day and hour this week, the date before. */
function whenOf(d: Date, bucket: string): string {
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (bucket === 'Today' || bucket === 'Yesterday') return hm
  if (bucket === 'This week') return `${WDAYS[d.getDay()]} ${hm}`
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`
}

function Row({ page, words, area, when }: { page: ReportPage; words: string[]; area: string; when: string }) {
  const sub = areaBelow(page.area, area)
  const t = new Date(page.mtime * 1000)
  return (
    <li>
      <a
        href={pageHash(page.url)}
        title={page.path}
        className="group flex items-baseline gap-3 rounded-lg px-3 py-2 transition-colors duration-150 hover:bg-foreground/[0.035] active:bg-foreground/[0.05]"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] leading-snug font-medium text-foreground group-hover:text-primary">
            <Hit text={page.title} words={words} />
          </span>
          {sub ? <span className="mt-0.5 block truncate text-[12px] leading-snug text-muted-foreground">{sub}</span> : null}
          {words.length && page.path.toLowerCase().includes(words[0]) && !page.title.toLowerCase().includes(words[0]) ? (
            <span className="mt-0.5 block font-mono text-[11px] leading-snug break-all text-faint">
              <Hit text={page.path} words={words} />
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-xs whitespace-nowrap text-faint tabular-nums" title={t.toLocaleString()}>
          {when}
        </span>
      </a>
    </li>
  )
}

export function ReportsView({ area }: { area: string }) {
  const pages = useStore((s) => s.pages)
  const loaded = useStore((s) => s.pagesLoaded)
  const error = useStore((s) => s.pagesError)
  const [q, setQ] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== input.current) {
        e.preventDefault()
        input.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const inScope = useMemo(() => pages.filter((p) => inArea(p.area, area)), [pages, area])
  const hits = inScope.filter((p) => words.every((w) => `${p.title} ${p.path}`.toLowerCase().includes(w)))
  const week = inScope.filter((p) => Date.now() / 1000 - p.mtime < 7 * DAY).length

  /* consecutive runs of the same heading: the list is sorted newest first */
  const now = new Date()
  const buckets: { label: string; rows: { page: ReportPage; when: string }[] }[] = []
  for (const p of hits) {
    const d = new Date(p.mtime * 1000)
    const label = bucketOf(d, now)
    let b = buckets[buckets.length - 1]
    if (!b || b.label !== label) buckets.push((b = { label, rows: [] }))
    b.rows.push({ page: p, when: whenOf(d, label) })
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4 pb-12 desk:px-8 desk:pt-12">
      <PageHeader
        className="max-desk:mb-4 max-desk:[&_h1]:hidden"
        title={area || 'Reports'}
        description={`${plural(inScope.length, 'page')}, ${week} changed this week`}
      />
      <label className="relative mb-2 block">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={input}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQ('')
          }}
          placeholder="Filter by title or path"
          autoComplete="off"
          spellCheck={false}
          className="h-10 w-full rounded-[10px] border border-input bg-card pr-9 pl-9 text-[15px] outline-none placeholder:text-faint focus:border-primary focus:ring-[3px] focus:ring-primary/15 desk:text-sm [&::-webkit-search-cancel-button]:hidden"
        />
        {q ? (
          <button type="button" onClick={() => setQ('')} aria-label="Clear" className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground">
            <XIcon className="size-3.5" />
          </button>
        ) : null}
      </label>
      {!loaded ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full rounded-[10px]" />
          <Skeleton className="h-14 w-full rounded-[10px]" />
          <Skeleton className="h-14 w-full rounded-[10px]" />
        </div>
      ) : error ? (
        <Empty title="Could not load the report pages">{error}</Empty>
      ) : !hits.length ? (
        <Empty title={pages.length ? 'No page matches' : 'No report pages'}>
          {pages.length ? 'Try other words or another area.' : 'The server lists the .html pages under the roots of its config.'}
        </Empty>
      ) : (
        <>
          {words.length ? <p className="mt-3 px-0.5 text-xs text-muted-foreground">{plural(hits.length, 'page')} of {inScope.length}</p> : null}
          {buckets.map((b) => (
            <section key={b.label}>
              <h2 className="sticky top-[calc(var(--header-h)+var(--safe-top))] z-10 -mx-1 mt-5 bg-background/90 px-1 py-1.5 text-[11.5px] font-medium tracking-[0.04em] text-faint uppercase backdrop-blur desk:top-0">
                {b.label}
              </h2>
              <ul className="-mx-3 flex flex-col">
                {b.rows.map(({ page, when }) => (
                  <Row key={page.url} page={page} words={words} area={area} when={when} />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
