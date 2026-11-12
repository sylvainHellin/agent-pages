/* Library: #/ (all lessons), #/p/<id> (one project), #/unlinked: the same month board, filtered.
   The month shown is kept per list in the store, so it survives opening a lesson and coming back. */
import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRightIcon, CopyIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { Lesson } from '@/lib/api'
import { registryUrl } from '@/lib/api'
import { addMonths } from '@/lib/format'
import { copyText, useIsDesktop } from '@/lib/hooks'
import { hereUrl, projectHash } from '@/lib/router'
import { useStore, visibleLessons } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Empty, ProjectDot } from '@/components/bits'
import { defaultMonth, Legend, MonthGrid, MonthNav, MonthSummary, MonthTitle, PhoneMonth, SearchField } from '@/components/board'
import { LessonsEmptyHowto } from '@/components/lessons'

export type BoardFilter = { kind: 'all' } | { kind: 'project'; id: string } | { kind: 'unlinked' }

function LoadError() {
  const err = useStore((s) => s.loadError)
  const load = useStore((s) => s.loadLessons)
  return (
    <Empty title="Could not load the lessons" className="my-10">
      <p>{err}</p>
      <Button variant="outline" className="mt-4" onClick={() => load().catch(() => {})}>
        Try again
      </Button>
    </Empty>
  )
}

function ProjectHeader({ id, count }: { id: string; count: number }) {
  const projects = useStore((s) => s.projects)
  const lessons = useStore((s) => s.lessons)
  const loaded = useStore((s) => s.lessonsLoaded)
  const [more, setMore] = useState(false)
  const pr = projects.find((p) => p.id === id)
  const topics = [...new Set(lessons.filter((l) => l.projects.includes(id)).map((l) => l.topic).filter(Boolean))]
  const facts = pr ? [pr.status, pr.type, pr.path].filter(Boolean).join(' · ') : ''
  return (
    <section className="flex flex-col gap-1.5 border-b pb-3 max-desk:px-4 max-desk:pt-3 desk:mb-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="flex min-w-0 items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
          <ProjectDot id={id} className="size-2.5" />
          <span className="break-all">{id}</span>
        </h2>
        <span className="text-[12.5px] text-muted-foreground">
          {facts || (loaded && !pr ? <span className="text-attention">not an open project in the vault</span> : null)}
          {count ? null : loaded ? <span>{facts ? ' · ' : ''}no lesson linked yet</span> : null}
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
      {!count && loaded ? (
        <p className="text-[12.5px] text-muted-foreground">
          Link one with “Link to projects” in a lesson's bar{pr?.path ? <>, or start a lesson inside <code className="font-mono text-[11.5px]">{pr.path}</code></> : null}.
        </p>
      ) : null}
    </section>
  )
}

function UnlinkedHeader() {
  return (
    <section className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-3 max-desk:px-4 max-desk:pt-3 desk:mb-1">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Not linked yet</h2>
      <p className="text-[12.5px] text-muted-foreground">Lessons without a project. Open one and use “Link to projects” in its bar.</p>
    </section>
  )
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)
}

export function BoardView({ filter }: { filter: BoardFilter }) {
  const desk = useIsDesktop()
  const lessons = useStore((s) => s.lessons)
  const loaded = useStore((s) => s.lessonsLoaded)
  const err = useStore((s) => s.loadError)
  const archived = useStore((s) => s.archived)
  const q = useStore((s) => s.q)
  const board = useStore((s) => s.board)
  const setBoard = useStore((s) => s.setBoard)
  const key = filter.kind === 'project' ? `p:${filter.id}` : filter.kind
  const pid = filter.kind === 'project' ? filter.id : undefined

  const base = useMemo(
    () =>
      visibleLessons(lessons, archived, '').filter((l: Lesson) =>
        filter.kind === 'project' ? l.projects.includes(filter.id) : filter.kind === 'unlinked' ? !l.projects.length : true,
      ),
    [lessons, archived, key], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const matches = q.trim() ? visibleLessons(base, true, q) : null
  const items = matches || base
  const ym = board?.key === key ? board.ym : defaultMonth(base)
  const setYm = (m: string) => setBoard(key, m)
  const inMonth = items.filter((l) => (l.created || '').startsWith(ym))

  // ← → change the month (not while typing or with a menu / dialog open)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || typing(e.target)) return
      if (document.querySelector('[role="dialog"],[role="menu"],[data-slot="popover-content"]')) return
      e.preventDefault()
      setBoard(key, addMonths(ym, e.key === 'ArrowLeft' ? -1 : 1))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [key, ym, setBoard])

  const summary = <MonthSummary ym={ym} inMonth={inMonth} matches={matches} setYm={setYm} projects={filter.kind === 'all'} />
  const empty = loaded && !lessons.length
  const failed = loaded && err && !lessons.length

  const top = filter.kind === 'project' ? <ProjectHeader id={filter.id} count={base.length} /> : filter.kind === 'unlinked' ? <UnlinkedHeader /> : null

  if (desk)
    return (
      <div className="flex h-dvh min-h-[38rem] flex-col px-6 pt-3 pb-3">
        {top}
        <header className="flex h-12 shrink-0 items-center gap-2">
          <MonthTitle ym={ym} className="w-[10.75rem] text-xl" />
          <MonthNav ym={ym} setYm={setYm} />
          <span className="flex-1" />
          <SearchField className="w-64" />
        </header>
        {failed ? (
          <LoadError />
        ) : empty ? (
          <LessonsEmptyHowto />
        ) : (
          <>
            <MonthGrid ym={ym} lessons={items} prefer={pid} />
            <footer className="flex h-7 shrink-0 items-end justify-between gap-6 text-xs text-muted-foreground">
              {summary}
              <Legend />
            </footer>
          </>
        )}
      </div>
    )

  return (
    <div>
      {top}
      <header className="flex items-center gap-2 px-4 pt-3 pb-2.5">
        <MonthTitle ym={ym} className="flex-1 text-[19px]" />
        <MonthNav ym={ym} setYm={setYm} compact />
      </header>
      <div className="px-4 pb-3">
        <SearchField compact />
      </div>
      {failed ? (
        <LoadError />
      ) : empty ? (
        <LessonsEmptyHowto />
      ) : (
        <PhoneMonth
          ym={ym}
          lessons={items}
          prefer={pid}
          footer={<div className="flex items-center justify-between gap-3 px-4 pt-1 pb-3 text-xs text-muted-foreground">{summary}</div>}
        />
      )}
    </div>
  )
}
