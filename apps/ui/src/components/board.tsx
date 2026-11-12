/* The library home: one month as a calendar.
   Desktop: a 7-column month grid (Mon first); each day lists its lessons as one-line chips, "+N more" opens the rest.
   Phone: the same month compact (day numbers with coloured dots) and the month's lessons by day below it;
   tapping a day scrolls the list to it.
   A chip's dot is the project's colour; its shape is the status: ring = learning, filled = understood. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon, XIcon } from 'lucide-react'
import type { Lesson } from '@/lib/api'
import { addMonths, ago, dayLabel, dkey, longDay, MONTHS, monthWeeks, NO_PROJECT_COLOR, pdate, plural, projectColor, todayKey, WEEK_MON, ymKey } from '@/lib/format'
import { lessonHash } from '@/lib/router'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { IconTip, Kbd, ProjectDot, STATUS_LABEL, StatusBadge, StatusMark } from './bits'

/** The colour a lesson is drawn in: the filtered project if it has it, else its first project. */
export function lessonColor(l: Lesson, prefer?: string): string {
  if (prefer && l.projects.includes(prefer)) return projectColor(prefer)
  return l.projects.length ? projectColor(l.projects[0]) : NO_PROJECT_COLOR
}

export function groupByDay(lessons: Lesson[]): Map<string, Lesson[]> {
  const m = new Map<string, Lesson[]>()
  for (const l of lessons) {
    const k = (l.created || '').slice(0, 10)
    const a = m.get(k)
    if (a) a.push(l)
    else m.set(k, [l])
  }
  return m
}

/** The month a board opens on: the newest lesson's (lessons come newest first), else this month. */
export function defaultMonth(lessons: Lesson[]): string {
  return (lessons[0]?.created || '').slice(0, 7) || ymKey(new Date())
}

/* ---------- header: month, ‹ ›, Today, search ---------- */

export function MonthTitle({ ym, className }: { ym: string; className?: string }) {
  const d = pdate(ym + '-01')
  return (
    <h1 className={cn('font-semibold tracking-[-0.02em] whitespace-nowrap tabular-nums', className)}>
      {MONTHS[d.getMonth()]} <span className="font-normal text-muted-foreground">{d.getFullYear()}</span>
    </h1>
  )
}

export function MonthNav({ ym, setYm, compact }: { ym: string; setYm: (m: string) => void; compact?: boolean }) {
  const now = ymKey(new Date())
  return (
    <div className="flex items-center gap-1">
      <IconTip label={<>Previous month <Kbd className="ml-1 border-white/20 bg-white/10 text-white/80">←</Kbd></>}>
        <Button variant="ghost" size="icon-sm" onClick={() => setYm(addMonths(ym, -1))} aria-label="Previous month">
          <ChevronLeftIcon className="size-4" />
        </Button>
      </IconTip>
      <IconTip label={<>Next month <Kbd className="ml-1 border-white/20 bg-white/10 text-white/80">→</Kbd></>}>
        <Button variant="ghost" size="icon-sm" onClick={() => setYm(addMonths(ym, 1))} aria-label="Next month">
          <ChevronRightIcon className="size-4" />
        </Button>
      </IconTip>
      <Button variant="outline" size="sm" className={cn('ml-1', compact && 'h-7')} disabled={ym === now} onClick={() => setYm(now)}>
        Today
      </Button>
    </div>
  )
}

export function SearchField({ className, compact }: { className?: string; compact?: boolean }) {
  const q = useStore((s) => s.q)
  const setQ = useStore((s) => s.setQ)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = document.activeElement as HTMLElement | null
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !(t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable))) {
        e.preventDefault()
        ref.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className={cn('relative', className)}>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-[15px] -translate-y-1/2 text-faint" />
      <input
        ref={ref}
        type="search"
        data-slot="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setQ('')
            e.currentTarget.blur()
          }
        }}
        placeholder="Search lessons"
        aria-label="Search lessons"
        className={cn(
          'w-full min-w-0 rounded-md border border-transparent bg-foreground/[0.04] pr-8 pl-8 text-[13px] transition-[border-color,background-color,box-shadow] duration-150 outline-none placeholder:text-faint hover:bg-foreground/[0.06] focus:border-ring/60 focus:bg-card focus:ring-3 focus:ring-ring/15 [&::-webkit-search-cancel-button]:hidden',
          compact ? 'h-9 text-base' : 'h-8',
        )}
      />
      {q ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setQ('')}
          className="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      ) : compact ? null : (
        <Kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
      )}
    </div>
  )
}

/* ---------- a lesson: chip, preview, row ---------- */

function LessonPreview({ lesson: l }: { lesson: Lesson }) {
  const c = l.counts
  const revised = l.updated && l.updated * 1000 - pdate(l.created).getTime() > 36 * 3600 * 1000 ? `revised ${ago(l.updated)}` : ''
  const facts = [c?.sections ? plural(c.sections, 'section') : '', c?.questions ? plural(c.questions, 'question') : '', revised].filter(Boolean)
  return (
    <div className="flex flex-col gap-2">
      <div className="truncate text-[11.5px] text-muted-foreground">
        {dayLabel(l.created, true)}
        {l.topic ? ` · ${l.topic}` : ''}
      </div>
      <div className="text-[13.5px] leading-snug font-semibold tracking-[-0.01em] break-keep">{l.title}</div>
      {l.summary ? <p className="line-clamp-3 text-[12.5px] leading-relaxed text-muted-foreground break-keep">{l.summary}</p> : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/75">
        {l.projects.length ? (
          l.projects.map((p) => (
            <span key={p} className={cn('inline-flex items-center gap-1.5', l.unknown_projects?.includes(p) && 'text-attention')}>
              <ProjectDot id={p} className="size-[7px]" />
              {p}
            </span>
          ))
        ) : (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <ProjectDot className="size-[7px]" /> No project
          </span>
        )}
        {(l.tags || []).map((t) => (
          <span key={t} className="text-muted-foreground">
            #{t}
          </span>
        ))}
      </div>
      <div className="mt-0.5 flex items-start justify-between gap-3 border-t pt-2 text-[11.5px] text-muted-foreground">
        <span className="min-w-0">{facts.join(' · ')}</span>
        <StatusBadge status={l.status} className="shrink-0 text-[11.5px]" />
      </div>
    </div>
  )
}

function LessonChip({ lesson: l, prefer, faded }: { lesson: Lesson; prefer?: string; faded?: boolean }) {
  return (
    <HoverCard openDelay={500} closeDelay={60}>
      <HoverCardTrigger asChild>
        <a
          href={lessonHash(l.slug)}
          data-slot="lesson-chip"
          aria-label={`${l.title} (${STATUS_LABEL[l.status]})`}
          className={cn(
            'flex h-[22px] min-w-0 shrink-0 items-center gap-1.5 rounded-[5px] px-1.5 text-[12px] leading-none transition-colors duration-150 outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring/30',
            l.status === 'learning' ? 'text-foreground' : 'text-muted-foreground',
            faded && 'opacity-45',
          )}
        >
          <StatusMark status={l.status} color={lessonColor(l, prefer)} />
          <span className="truncate">{l.title}</span>
        </a>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start">
        <LessonPreview lesson={l} />
      </HoverCardContent>
    </HoverCard>
  )
}

function DayList({ day, lessons, prefer }: { day: string; lessons: Lesson[]; prefer?: string }) {
  return (
    <>
      <div className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">{longDay(day)}</div>
      <ul className="flex flex-col">
        {lessons.map((l) => (
          <li key={l.slug}>
            <a href={lessonHash(l.slug)} className="flex items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-150 outline-none hover:bg-foreground/[0.045] focus-visible:bg-foreground/[0.045]">
              <StatusMark status={l.status} color={lessonColor(l, prefer)} className="mt-[6px]" />
              <span className="min-w-0 flex-1">
                <span className={cn('line-clamp-2 text-[13px] leading-snug break-keep', l.status !== 'learning' && 'text-muted-foreground')}>{l.title}</span>
                <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                  {[l.topic, l.projects.join(', ') || 'No project'].filter(Boolean).join(' · ')}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </>
  )
}

/* ---------- desktop: the month grid ---------- */

const VISIBLE = 3

function DayCell({ date, ym, lessons, prefer, col, lastRow }: { date: Date; ym: string; lessons: Lesson[]; prefer?: string; col: number; lastRow: boolean }) {
  const key = dkey(date)
  const inMonth = ymKey(date) === ym
  const today = key === todayKey()
  const [open, setOpen] = useState(false)
  const shown = lessons.length > VISIBLE ? lessons.slice(0, VISIBLE) : lessons
  const more = lessons.length - shown.length
  const first = date.getDate() === 1
  return (
    <div
      data-day={key}
      className={cn('flex min-h-0 min-w-0 flex-col gap-px overflow-hidden px-1 pt-1 pb-1.5', col < 6 && 'border-r', !lastRow && 'border-b', !inMonth && 'bg-foreground/[0.015]')}
    >
      <div className="flex h-6 shrink-0 items-center px-0.5">
        <span
          className={cn(
            'grid h-[22px] min-w-[22px] place-items-center rounded-full px-1 text-xs tabular-nums',
            today ? 'bg-primary font-semibold text-primary-foreground' : inMonth ? 'text-foreground/70' : 'text-faint',
            first && 'px-1.5',
          )}
          aria-current={today ? 'date' : undefined}
        >
          {first ? `${date.getDate()} ${MONTHS[date.getMonth()].slice(0, 3)}` : date.getDate()}
        </span>
      </div>
      {shown.map((l) => (
        <LessonChip key={l.slug} lesson={l} prefer={prefer} faded={!inMonth} />
      ))}
      {more > 0 ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'h-5 shrink-0 self-start rounded-[5px] px-1.5 text-[11.5px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-foreground/[0.05] hover:text-foreground aria-expanded:bg-foreground/[0.05] aria-expanded:text-foreground',
                !inMonth && 'opacity-60',
              )}
            >
              +{more} more
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="bottom" sideOffset={4} className="w-80 gap-0 p-1.5">
            <DayList day={key} lessons={lessons} prefer={prefer} />
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}

export function MonthGrid({ ym, lessons, prefer }: { ym: string; lessons: Lesson[]; prefer?: string }) {
  const weeks = useMemo(() => monthWeeks(ym), [ym])
  const byDay = useMemo(() => groupByDay(lessons), [lessons])
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] border bg-card">
      <div className="grid shrink-0 grid-cols-7 border-b">
        {WEEK_MON.map((w) => (
          <div key={w} className="px-2.5 py-1.5 text-[11.5px] font-medium text-muted-foreground">
            {w}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7" style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(7.5rem, 1fr))` }}>
        {weeks.map((w, r) =>
          w.map((d, c) => <DayCell key={dkey(d)} date={d} ym={ym} lessons={byDay.get(dkey(d)) || []} prefer={prefer} col={c} lastRow={r === weeks.length - 1} />),
        )}
      </div>
    </div>
  )
}

export function Legend() {
  return (
    <span className="inline-flex items-center gap-3 text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <StatusMark status="learning" color="var(--faint)" /> Learning
      </span>
      <span className="inline-flex items-center gap-1.5">
        <StatusMark status="understood" color="var(--faint)" /> Understood
      </span>
    </span>
  )
}

/** "6 lessons in November · 2 understood", or with a search: matches here and the months that have the others. */
export function MonthSummary({ ym, inMonth, matches, setYm, projects: withProjects = true }: { ym: string; inMonth: Lesson[]; matches: Lesson[] | null; setYm: (m: string) => void; projects?: boolean }) {
  const name = MONTHS[pdate(ym + '-01').getMonth()]
  if (matches) {
    const others = new Map<string, number>()
    for (const l of matches) {
      const k = (l.created || '').slice(0, 7)
      if (k !== ym) others.set(k, (others.get(k) || 0) + 1)
    }
    const months = [...others.entries()].slice(0, 4)
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
        <span>{inMonth.length ? `${plural(inMonth.length, 'match')} in ${name}` : `No match in ${name}`}</span>
        {months.length ? <span className="text-faint">·</span> : null}
        {months.map(([k, n], i) => (
          <span key={k} className="inline-flex items-center">
            <button type="button" onClick={() => setYm(k)} className="rounded-[4px] px-1 text-foreground/80 underline decoration-border underline-offset-[3px] transition-colors hover:text-primary hover:decoration-primary/40">
              {MONTHS[pdate(k + '-01').getMonth()].slice(0, 3)} {k.slice(0, 4)} ({n})
            </button>
            {i < months.length - 1 ? <span className="text-faint">,</span> : null}
          </span>
        ))}
      </span>
    )
  }
  const understood = inMonth.filter((l) => l.status === 'understood').length
  const projects = new Set(inMonth.flatMap((l) => l.projects)).size
  return (
    <span className="truncate">
      {inMonth.length
        ? [`${plural(inMonth.length, 'lesson')} in ${name}`, withProjects && projects ? plural(projects, 'project') : '', `${understood} understood`].filter(Boolean).join(' · ')
        : `No lessons in ${name}`}
    </span>
  )
}

/* ---------- phone: compact month + the month's lessons by day ---------- */

export function PhoneMonth({ ym, lessons, prefer, footer }: { ym: string; lessons: Lesson[]; prefer?: string; footer?: ReactNode }) {
  const weeks = useMemo(() => monthWeeks(ym), [ym])
  const byDay = useMemo(() => groupByDay(lessons), [lessons])
  const [sel, setSel] = useState<string | null>(null)
  const [spacer, setSpacer] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const today = todayKey()
  const days = [...byDay.keys()].filter((k) => k.startsWith(ym)).sort((a, b) => b.localeCompare(a))
  useEffect(() => {
    setSel(null)
    setSpacer(0)
  }, [ym])

  const tap = (key: string) => {
    setSel(key)
    const el = listRef.current?.querySelector<HTMLElement>(`[data-list-day="${key}"]`)
    if (!el) return
    // an early day sits near the end of the list: make room below it so it can scroll up under the header
    const top = el.getBoundingClientRect().top + window.scrollY - parseFloat(getComputedStyle(el).scrollMarginTop || '0')
    const short = top - (document.documentElement.scrollHeight - spacer - window.innerHeight)
    const need = Math.max(0, Math.ceil(short))
    if (need !== spacer) flushSync(() => setSpacer(need))
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    el.classList.remove('animate-tl-flash')
    void el.offsetWidth
    el.classList.add('animate-tl-flash')
  }

  return (
    <>
      <div className="grid grid-cols-7 px-2">
        {WEEK_MON.map((w) => (
          <div key={w} className="pb-1 text-center text-[11px] font-medium text-faint">
            {w.slice(0, 1)}
          </div>
        ))}
        {weeks.flat().map((d) => {
          const key = dkey(d)
          const inMonth = ymKey(d) === ym
          const ls = inMonth ? byDay.get(key) || [] : []
          const isSel = sel === key
          const isToday = key === today
          return (
            <button
              key={key}
              type="button"
              disabled={!inMonth}
              onClick={() => tap(key)}
              aria-label={`${longDay(key)}${ls.length ? `, ${plural(ls.length, 'lesson')}` : ''}`}
              aria-pressed={isSel}
              className="flex h-12 flex-col items-center gap-[3px] pt-1 outline-none disabled:pointer-events-none"
            >
              <span
                className={cn(
                  'grid size-[30px] place-items-center rounded-full text-[15px] tabular-nums transition-colors duration-150',
                  !inMonth && 'text-faint/70',
                  inMonth && !isSel && !isToday && 'text-foreground/85',
                  isToday && !isSel && 'font-semibold text-primary',
                  isSel && (isToday ? 'bg-primary font-semibold text-primary-foreground' : 'bg-foreground font-medium text-background'),
                )}
              >
                {d.getDate()}
              </span>
              <span className="flex h-[5px] items-center gap-[3px]">
                {ls.slice(0, 3).map((l) => (
                  <span key={l.slug} className="size-[5px] rounded-full" style={{ background: lessonColor(l, prefer) }} />
                ))}
              </span>
            </button>
          )
        })}
      </div>
      {footer}
      <div ref={listRef} className="mt-1 border-t pb-6">
        {days.length ? (
          days.map((k) => (
            <section key={k} data-list-day={k} className="scroll-mt-[calc(var(--safe-top)+var(--header-h)+0.25rem)] px-4 pt-4">
              <h3 className={cn('mb-1.5 px-1 text-xs font-medium', k === today ? 'text-primary' : 'text-muted-foreground')}>
                {longDay(k)}
                {k === today ? ' · Today' : ''}
              </h3>
              <ul className="divide-y overflow-hidden rounded-[10px] border bg-card">
                {byDay.get(k)!.map((l) => (
                  <li key={l.slug}>
                    <a href={lessonHash(l.slug)} className="flex items-center gap-3 px-3.5 py-3 transition-colors active:bg-foreground/[0.04]">
                      <span className="min-w-0 flex-1">
                        <span className={cn('line-clamp-2 text-[15px] leading-snug font-medium tracking-[-0.01em] break-keep', l.status !== 'learning' && 'text-foreground/70')}>{l.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
                          {l.projects.length ? (
                            l.projects.map((p) => (
                              <span key={p} className="inline-flex items-center gap-1.5">
                                <ProjectDot id={p} className="size-1.5" />
                                {p}
                              </span>
                            ))
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <ProjectDot className="size-1.5" /> No project
                            </span>
                          )}
                          <span className="text-faint">·</span>
                          <span>{STATUS_LABEL[l.status]}</span>
                        </span>
                      </span>
                      <ChevronRightIcon className="size-4 shrink-0 text-faint" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))
        ) : (
          <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">No lessons in {MONTHS[pdate(ym + '-01').getMonth()]}.</p>
        )}
        {spacer ? <div aria-hidden style={{ height: spacer }} /> : null}
      </div>
    </>
  )
}
