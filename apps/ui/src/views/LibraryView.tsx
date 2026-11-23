/* The one list: #/ (every page), #/p/<id> (one project), #/unlinked (no project), #/reports?area=a (one area).
   Every page has one status (open, sent, done, archived) and tags; the status chips (Open by default, Sent, Done,
   Archived, All) and the tag chips filter the list, the search matches title, topic, summary, path, projects and tags.
   The list is newest change first under day and month headings; Month shows the same pages on the month board
   (components/board.tsx), whose month is kept per list in the store, so it survives opening a page and coming back.
   Select puts a checkbox on every row and a bar under the list: Select all shown, then Open, Done or Archived for the
   selection in one PATCH api/items (pages whose data-doc-id is shared cannot be picked: their status cannot be set). */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowUpRightIcon, CalendarDaysIcon, CopyIcon, ListChecksIcon, ListIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { SETTABLE, STATUSES, registryUrl, type Item, type Status } from '@/lib/api'
import { areaBelow, inArea } from '@/lib/areas'
import { addMonths, MONTHS, plural, WDAYS } from '@/lib/format'
import { copyText, useIsDesktop } from '@/lib/hooks'
import { hereUrl, itemHash, projectHash } from '@/lib/router'
import { filterItems, matchesSearch, useStore, type StatusFilter } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty, ProjectDot, STATUS_LABEL, StatusMark } from '@/components/bits'
import { defaultMonth, itemColor, Legend, MonthGrid, MonthNav, MonthSummary, MonthTitle, PhoneMonth, SearchField } from '@/components/board'
import { LessonsEmptyHowto } from '@/components/lessons'
import { SavedMark } from '@/components/offline'

export type ListScope = { kind: 'all' } | { kind: 'project'; id: string } | { kind: 'unlinked' } | { kind: 'area'; area: string }

export const scopeKey = (s: ListScope) => (s.kind === 'project' ? `p:${s.id}` : s.kind === 'area' ? `a:${s.area}` : s.kind)

export function inScope(i: Item, s: ListScope): boolean {
  if (s.kind === 'project') return i.projects.includes(s.id)
  if (s.kind === 'unlinked') return !i.projects.length
  if (s.kind === 'area') return inArea(i.area, s.area)
  return true
}

const DAY = 86400
const TAG_CHIPS = 12

function LoadError() {
  const err = useStore((s) => s.loadError)
  const load = useStore((s) => s.loadPages)
  return (
    <Empty title="Could not load the pages" className="my-10">
      <p>{err}</p>
      <Button variant="outline" className="mt-4" onClick={() => load().catch(() => {})}>
        Try again
      </Button>
    </Empty>
  )
}

function ProjectHeader({ id, count }: { id: string; count: number }) {
  const projects = useStore((s) => s.projects)
  const pages = useStore((s) => s.pages)
  const loaded = useStore((s) => s.pagesLoaded)
  const [more, setMore] = useState(false)
  const pr = projects.find((p) => p.id === id)
  const topics = [...new Set(pages.filter((l) => l.projects.includes(id)).map((l) => l.topic).filter(Boolean))]
  const facts = pr ? [pr.status, pr.type, pr.path].filter(Boolean).join(' · ') : ''
  return (
    <section className="flex flex-col gap-1.5 border-b pb-3 desk:mb-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="flex min-w-0 items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
          <ProjectDot id={id} className="size-2.5" />
          <span className="break-all">{id}</span>
        </h2>
        <span className="text-[12.5px] text-muted-foreground">
          {facts || (loaded && !pr ? <span className="text-attention">not an open project in the vault</span> : null)}
          {count ? null : loaded ? <span>{facts ? ' · ' : ''}no page linked yet</span> : null}
        </span>
        <span className="flex-1" />
        <span className="flex items-center gap-1 max-desk:-ml-2 max-desk:w-full">
          {pr ? (
            <Button variant="ghost" size="sm" asChild>
              <a href={registryUrl(id)} target="_blank" rel="noopener">
                <ArrowUpRightIcon /> Open in Obsidian
              </a>
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            title="For the project README"
            onClick={async () => ((await copyText(hereUrl(projectHash(id)))) ? toast.success('Link copied') : toast.error('Could not copy'))}
          >
            <CopyIcon /> Copy link to this page
          </Button>
        </span>
      </div>
      {pr?.notes ? (
        <p
          onClick={() => setMore(!more)}
          className={cn('max-w-4xl cursor-pointer text-[12.5px] leading-relaxed text-muted-foreground break-keep', !more && 'line-clamp-2 desk:line-clamp-1')}
          title={more ? undefined : 'Show all'}
        >
          {pr.notes}
        </p>
      ) : null}
      {topics.length ? <p className="truncate text-xs text-faint">Topics: {topics.join(' · ')}</p> : null}
      {!count && loaded ? <p className="text-[12.5px] text-muted-foreground">Link a page with “Link to projects” in its bar{pr?.path ? <>, or start a lesson inside <code className="font-mono text-[11.5px]">{pr.path}</code></> : null}.</p> : null}
    </section>
  )
}

function ScopeHeader({ scope, count }: { scope: ListScope; count: number }) {
  if (scope.kind === 'project') return <ProjectHeader id={scope.id} count={count} />
  const [title, text] =
    scope.kind === 'unlinked'
      ? ['Not linked yet', 'Pages without a project. Open one and use “Link to projects” in its bar.']
      : scope.kind === 'area'
        ? [scope.area, 'The pages under this folder.']
        : [null, null]
  if (!title) return null
  return (
    <section className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-3 desk:mb-1">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em] break-all">{title}</h2>
      <p className="text-[12.5px] text-muted-foreground">{text}</p>
    </section>
  )
}

const chip =
  'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/30'
const chipOn = 'border-foreground/25 bg-foreground/[0.07] text-foreground'
const chipOff = 'border-border text-muted-foreground hover:border-input hover:text-foreground'

/** Open, Sent, Done, Archived, All, each with its count in the list as filtered by tags and search. */
function StatusChips({ items }: { items: Item[] }) {
  const status = useStore((s) => s.status)
  const setStatus = useStore((s) => s.setStatus)
  const n = (s: StatusFilter) => (s === 'all' ? items.length : items.filter((i) => i.status === s).length)
  return (
    <div role="radiogroup" aria-label="Status" className="flex flex-wrap items-center gap-1.5">
      {([...STATUSES, 'all'] as StatusFilter[]).map((s) => (
        <button key={s} type="button" role="radio" aria-checked={status === s} onClick={() => setStatus(s)} className={cn(chip, status === s ? chipOn : chipOff)}>
          {s === 'all' ? null : <StatusMark status={s} />}
          {s === 'all' ? 'All' : STATUS_LABEL[s]}
          <span className="text-[11.5px] font-normal text-faint tabular-nums">{n(s)}</span>
        </button>
      ))}
    </div>
  )
}

/** The most used tags of the pages in view, and the picked ones; every picked tag must be on a page. */
function TagChips({ items }: { items: Item[] }) {
  const tags = useStore((s) => s.tags)
  const toggle = useStore((s) => s.toggleTag)
  const clear = useStore((s) => s.clearTags)
  const [all, setAll] = useState(false)
  const counts = new Map<string, number>()
  for (const i of items) for (const t of i.tags) counts.set(t, (counts.get(t) || 0) + 1)
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t)
  const shown = [...tags, ...ranked.filter((t) => !tags.includes(t)).slice(0, all ? undefined : TAG_CHIPS)]
  if (!shown.length) return null
  return (
    <div aria-label="Tags" className="flex flex-wrap items-center gap-1.5">
      {shown.map((t) => {
        const on = tags.includes(t)
        return (
          <button key={t} type="button" aria-pressed={on} onClick={() => toggle(t)} className={cn(chip, 'h-6 px-2 text-xs', on ? chipOn : chipOff)}>
            #{t}
            {on ? <XIcon className="size-3" /> : <span className="text-[11px] font-normal text-faint tabular-nums">{counts.get(t) || 0}</span>}
          </button>
        )
      })}
      {ranked.length > TAG_CHIPS && !all ? (
        <button type="button" onClick={() => setAll(true)} className="px-1 text-xs text-muted-foreground hover:text-foreground">
          +{ranked.length - TAG_CHIPS} more
        </button>
      ) : null}
      {tags.length ? (
        <button type="button" onClick={clear} className="px-1 text-xs text-muted-foreground underline decoration-border underline-offset-[3px] hover:text-foreground">
          Clear tags
        </button>
      ) : null}
    </div>
  )
}

function ModeToggle() {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const b = (m: 'list' | 'month', icon: ReactNode, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === m}
      onClick={() => setMode(m)}
      className={cn('inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-[12.5px] font-medium transition-colors duration-150 [&_svg]:size-3.5', mode === m ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}
    >
      {icon}
      {label}
    </button>
  )
  return (
    <div role="radiogroup" aria-label="View" className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-foreground/[0.05] p-0.5">
      {b('list', <ListIcon />, 'List')}
      {b('month', <CalendarDaysIcon />, 'Month')}
    </div>
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

/** The rows' checkboxes while the list is in select mode. */
interface Picking {
  has(id: string): boolean
  toggle(id: string): void
}

/** Whether a page can join a selection: a page whose data-doc-id other pages share has no status of its own. */
const pickable = (i: Item) => !i.shared?.length

function Row({ item: i, area, when, prefer, picking }: { item: Item; area: string; when: string; prefer?: string; picking?: Picking }) {
  const sub = areaBelow(i.area, area)
  const t = new Date(i.changed * 1000)
  const facts = [sub, i.topic].filter(Boolean).join(' · ')
  const rowClass = 'group flex items-baseline gap-3 rounded-lg px-3 py-2 transition-colors duration-150 hover:bg-foreground/[0.035] active:bg-foreground/[0.05]'
  const content = (
    <>
      <StatusMark status={i.status} color={itemColor(i, prefer)} className="-translate-y-px" />
      <span className="min-w-0 flex-1">
          <span className={cn('block text-[14px] leading-snug font-medium group-hover:text-primary', i.status === 'open' ? 'text-foreground' : 'text-foreground/70')}>{i.title}</span>
          {facts || i.projects.length || i.tags.length ? (
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] leading-snug text-muted-foreground">
              {facts ? <span className="min-w-0 truncate">{facts}</span> : null}
              {i.projects.map((p) => (
                <span key={p} className="inline-flex items-center gap-1">
                  <ProjectDot id={p} className="size-1.5" />
                  {p}
                </span>
              ))}
              {i.tags.map((t) => (
                <span key={t} className="text-faint">
                  #{t}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      <SavedMark url={i.url} />
      <span className="shrink-0 text-xs whitespace-nowrap text-faint tabular-nums" title={`${STATUS_LABEL[i.status]} · changed ${t.toLocaleString()}`}>
        {when}
      </span>
    </>
  )
  if (picking) {
    const can = pickable(i)
    const on = can && picking.has(i.id)
    return (
      <li>
        <label
          title={can ? i.path : 'Other pages share its data-doc-id: open it to see which'}
          className={cn(rowClass, 'cursor-pointer select-none', on && 'bg-primary/[0.06] hover:bg-primary/[0.08]', !can && 'cursor-not-allowed opacity-55')}
        >
          <Checkbox checked={on} disabled={!can} onCheckedChange={() => picking.toggle(i.id)} aria-label={`Select ${i.title}`} className="translate-y-[3px]" />
          {content}
        </label>
      </li>
    )
  }
  return (
    <li>
      <a href={itemHash(i)} title={i.path} className={rowClass}>
        {content}
      </a>
    </li>
  )
}

function Rows({ items, area, prefer, picking }: { items: Item[]; area: string; prefer?: string; picking?: Picking }) {
  /* consecutive runs of the same heading: the list comes newest change first */
  const now = new Date()
  const buckets: { label: string; rows: { item: Item; when: string }[] }[] = []
  for (const i of items) {
    const d = new Date(i.changed * 1000)
    const label = bucketOf(d, now)
    let b = buckets[buckets.length - 1]
    if (!b || b.label !== label) buckets.push((b = { label, rows: [] }))
    b.rows.push({ item: i, when: whenOf(d, label) })
  }
  return (
    <>
      {buckets.map((b, n) => (
        <section key={`${n}-${b.label}`}>
          <h2 className="sticky top-[calc(var(--header-h)+var(--safe-top))] z-10 -mx-1 mt-4 bg-background/90 px-1 py-1.5 text-[11.5px] font-medium tracking-[0.04em] text-faint uppercase backdrop-blur desk:top-0">
            {b.label}
          </h2>
          <ul className="-mx-3 flex flex-col">
            {b.rows.map(({ item, when }) => (
              <Row key={item.url} item={item} area={area} when={when} prefer={prefer} picking={picking} />
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)
}

/** The month board of the pages in view (the list's filters applied). */
function MonthBoard({ items, boardKey, prefer, withProjects }: { items: Item[]; boardKey: string; prefer?: string; withProjects: boolean }) {
  const desk = useIsDesktop()
  const board = useStore((s) => s.board)
  const setBoard = useStore((s) => s.setBoard)
  const q = useStore((s) => s.q)
  const ym = board?.key === boardKey ? board.ym : defaultMonth(items)
  const setYm = (m: string) => setBoard(boardKey, m)
  const inMonth = items.filter((l) => (l.created || '').startsWith(ym))

  // ← → change the month (not while typing or with a menu / dialog open)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || typing(e.target)) return
      if (document.querySelector('[role="dialog"],[role="menu"],[data-slot="popover-content"]')) return
      e.preventDefault()
      setBoard(boardKey, addMonths(ym, e.key === 'ArrowLeft' ? -1 : 1))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [boardKey, ym, setBoard])

  const summary = <MonthSummary ym={ym} inMonth={inMonth} matches={q.trim() ? items : null} setYm={setYm} projects={withProjects} />
  if (desk)
    return (
      <>
        <header className="flex h-11 shrink-0 items-center gap-2">
          <MonthTitle ym={ym} className="w-[10.75rem] text-lg" />
          <MonthNav ym={ym} setYm={setYm} />
        </header>
        <MonthGrid ym={ym} items={items} prefer={prefer} />
        <footer className="flex h-7 shrink-0 items-end justify-between gap-6 text-xs text-muted-foreground">
          {summary}
          <Legend />
        </footer>
      </>
    )
  return (
    <div className="-mx-4">
      <header className="flex items-center gap-2 px-4 pt-1 pb-2.5">
        <MonthTitle ym={ym} className="flex-1 text-[19px]" />
        <MonthNav ym={ym} setYm={setYm} compact />
      </header>
      <PhoneMonth ym={ym} items={items} prefer={prefer} footer={<div className="flex items-center justify-between gap-3 px-4 pt-1 pb-3 text-xs text-muted-foreground">{summary}</div>} />
    </div>
  )
}

/** Under the list in select mode: how many are picked, Select all shown, and the status for the selection. */
function SelectBar({ items, sel, setSel, onClose }: { items: Item[]; sel: string[]; setSel: (ids: string[]) => void; onClose: () => void }) {
  const patchMany = useStore((s) => s.patchMany)
  const [busy, setBusy] = useState(false)
  const can = items.filter(pickable)
  const picked = can.filter((i) => sel.includes(i.id))
  const all = can.length > 0 && picked.length === can.length
  const apply = async (s: Status) => {
    if (!picked.length || busy) return
    setBusy(true)
    try {
      await patchMany(picked.map((i) => i.id), s)
      toast.success(`${plural(picked.length, 'page')} marked ${STATUS_LABEL[s]}`)
      setSel([])
    } catch {
      /* toast shown by the store */
    }
    setBusy(false)
  }
  return (
    <div className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)+var(--safe-bottom))] z-20 px-3 pb-2 desk:bottom-0 desk:left-[220px] desk:px-6 desk:pb-4">
      <div role="toolbar" aria-label="Selection" className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
        <span className="text-[12.5px] font-medium tabular-nums">{picked.length} selected</span>
        <button
          type="button"
          disabled={!can.length}
          onClick={() => setSel(all ? [] : can.map((i) => i.id))}
          className="text-[12.5px] text-muted-foreground underline decoration-border underline-offset-[3px] hover:text-foreground disabled:opacity-50"
        >
          {all ? 'Select none' : `Select all shown (${can.length})`}
        </button>
        <span className="flex-1" />
        <Button variant="ghost" size="icon" className="size-7 desk:hidden" onClick={onClose} aria-label="Leave select mode">
          <XIcon />
        </Button>
        <div className="grid grid-cols-3 gap-1.5 max-desk:w-full">
          {SETTABLE.map((s) => (
            <Button key={s} variant="outline" size="sm" disabled={!picked.length || busy} onClick={() => apply(s)}>
              <StatusMark status={s} />
              {STATUS_LABEL[s]}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ListView({ scope }: { scope: ListScope }) {
  const desk = useIsDesktop()
  const pages = useStore((s) => s.pages)
  const loaded = useStore((s) => s.pagesLoaded)
  const err = useStore((s) => s.loadError)
  const status = useStore((s) => s.status)
  const tags = useStore((s) => s.tags)
  const q = useStore((s) => s.q)
  const mode = useStore((s) => s.mode)
  const key = scopeKey(scope)
  const pid = scope.kind === 'project' ? scope.id : undefined
  const area = scope.kind === 'area' ? scope.area : ''

  const base = useMemo(() => pages.filter((i) => inScope(i, scope)), [pages, key]) // eslint-disable-line react-hooks/exhaustive-deps
  const searched = useMemo(() => base.filter((i) => matchesSearch(i, q)), [base, q])
  const tagged = filterItems(searched, 'all', tags)
  const shown = filterItems(tagged, status, [])
  const week = base.filter((i) => Date.now() / 1000 - i.changed < 7 * DAY).length
  const month = mode === 'month'
  const [selecting, setSelecting] = useState(false)
  const [sel, setSel] = useState<string[]>([])
  const picking = selecting && !month
  const stopPicking = () => {
    setSelecting(false)
    setSel([])
  }

  // Escape leaves select mode (not while typing or with a dialog or menu open)
  useEffect(() => {
    if (!picking) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || typing(e.target) || document.querySelector('[role="dialog"],[role="menu"]')) return
      setSelecting(false)
      setSel([])
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [picking])

  const body = !loaded ? (
    <div className="mt-4 flex flex-col gap-2">
      <Skeleton className="h-14 w-full rounded-[10px]" />
      <Skeleton className="h-14 w-full rounded-[10px]" />
      <Skeleton className="h-14 w-full rounded-[10px]" />
    </div>
  ) : err && !pages.length ? (
    <LoadError />
  ) : !pages.length ? (
    <LessonsEmptyHowto />
  ) : month ? (
    <MonthBoard items={shown} boardKey={key} prefer={pid} withProjects={scope.kind === 'all'} />
  ) : !shown.length ? (
    <Empty title={status === 'all' ? 'No page matches' : `Nothing ${STATUS_LABEL[status].toLowerCase()} here`} className="mt-4">
      {q.trim() || tags.length ? 'Try other words or tags, or another status.' : status === 'all' ? 'No page in this list yet.' : 'Pick another status above, or All.'}
    </Empty>
  ) : (
    <Rows
      items={shown}
      area={area}
      prefer={pid}
      picking={picking ? { has: (id) => sel.includes(id), toggle: (id) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]) } : undefined}
    />
  )

  return (
    <div className={cn('mx-auto flex w-full flex-col px-4 pt-3 pb-12 desk:px-6', month && desk ? 'h-dvh min-h-[38rem] max-w-none pb-3' : 'max-w-3xl desk:pt-6', picking && 'pb-36 desk:pb-24')}>
      <ScopeHeader scope={scope} count={base.length} />
      <div className="flex shrink-0 flex-col gap-2.5 pt-2 pb-1">
        <div className="flex items-center gap-2">
          <SearchField className="min-w-0 flex-1 desk:max-w-sm" compact={!desk} />
          <span className="flex-1 max-desk:hidden" />
          <span className="text-xs text-faint tabular-nums max-desk:hidden">
            {plural(base.length, 'page')}, {week} changed this week
          </span>
          {month ? null : (
            <Button
              variant={picking ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={picking}
              title={picking ? 'Leave select mode' : 'Pick pages and set their status at once'}
              onClick={() => (picking ? stopPicking() : setSelecting(true))}
              className="max-desk:px-2"
            >
              {picking ? <XIcon /> : <ListChecksIcon />}
              <span className="max-desk:sr-only">{picking ? 'Cancel' : 'Select'}</span>
            </Button>
          )}
          <ModeToggle />
        </div>
        <StatusChips items={tagged} />
        <TagChips items={filterItems(searched, status, [])} />
      </div>
      {body}
      {picking && loaded && pages.length ? <SelectBar items={shown} sel={sel} setSel={setSel} onClose={stopPicking} /> : null}
    </div>
  )
}
