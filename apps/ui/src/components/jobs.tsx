/* Lesson and revision jobs (src/agent_pages/server/jobs.py): one row per job with a status dot + word, Log, Stop / Cancel, Read. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowRightIcon, SquareIcon, TerminalIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { api, isActive, type Job } from '@/lib/api'
import { ago, host } from '@/lib/format'
import { lessonHash } from '@/lib/router'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ProjectDot } from './bits'

export function jobTitle(j: Job): string {
  if (j.kind === 'revise') return `Revise: ${j.title || j.slug}`
  if ((j.links || []).length) return j.links.map((l) => l.title || host(l.url)).join(' + ')
  return `Topic: ${(j.focus || '').split('\n')[0]}`
}

/** Short state word, as the row shows it next to its dot. */
export function jobState(j: Job): string {
  switch (j.status) {
    case 'running':
      return j.kind === 'revise' ? 'Revising' : 'Writing'
    case 'done':
      return j.kind === 'revise' ? 'Revised' : 'Ready'
    case 'attention':
      return 'Needs you'
    case 'queued':
      return 'Queued'
    case 'failed':
      return 'Failed'
    default:
      return 'Cancelled'
  }
}

/** A small status dot: running pulses in the accent colour, queued is a ring. */
export function JobDot({ job, className }: { job: Job; className?: string }) {
  const s = job.status
  return (
    <span aria-hidden className={cn('relative inline-flex size-2 shrink-0', className)}>
      {s === 'running' ? <span className="absolute inset-0 animate-tl-ping rounded-full bg-primary" /> : null}
      <span
        className={cn(
          'relative size-2 rounded-full',
          s === 'running' && 'bg-primary',
          s === 'queued' && 'border-[1.5px] border-faint',
          s === 'attention' && 'bg-warning',
          s === 'done' && 'bg-success',
          s === 'failed' && 'bg-destructive',
          s === 'cancelled' && 'bg-foreground/15',
        )}
      />
    </span>
  )
}

/** Kept for other views: the state as a small dot + word. */
export function JobBadge({ job }: { job: Job }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
      <JobDot job={job} className="size-1.5" />
      {jobState(job)}
    </span>
  )
}

function meta(j: Job): string {
  switch (j.status) {
    case 'running':
      return `${j.kind === 'revise' ? 'revising the page' : 'writing the lesson'}, started ${ago(j.started)}`
    case 'attention':
      return 'waiting for you in tuios session “tutor” (tuios attach tutor)'
    case 'queued':
      return 'waits for the job before it'
    case 'done':
    case 'cancelled':
    case 'failed':
      return ago(j.finished || j.created)
    default:
      return ''
  }
}

/** What the agent's window shows now; refreshed while the job is active, kept scrolled to the end. */
function LogViewer({ job }: { job: Job }) {
  const [text, setText] = useState<string | null>(null)
  const ref = useRef<HTMLPreElement>(null)
  const stick = useRef(true)
  const active = isActive(job)
  useEffect(() => {
    let stop = false
    const load = () =>
      api<{ log: string }>(`jobs/${job.id}/log`)
        .then((r) => !stop && setText(r.log || ''))
        .catch((e) => !stop && setText(`(${(e as Error).message})`))
    load()
    const t = active ? setInterval(load, 5000) : undefined
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [job.id, active])
  useLayoutEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [text])
  return (
    <pre
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 12
      }}
      className="mt-2.5 max-h-72 overflow-auto rounded-md bg-zinc-950 px-3 py-2.5 [scrollbar-color:rgb(255_255_255/0.22)_transparent] [scrollbar-width:thin] font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-300 [overflow-wrap:anywhere]"
    >
      {text == null ? 'Loading…' : text || '(empty)'}
    </pre>
  )
}

export function JobRow({ job: j }: { job: Job }) {
  const cancel = useStore((s) => s.cancelJob)
  const [log, setLog] = useState(false)
  const [busy, setBusy] = useState(false)
  const stop = async () => {
    setBusy(true)
    try {
      await cancel(j.id)
      toast(j.status === 'queued' ? 'Cancelled' : 'Stopped')
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(false)
  }
  const canLog = j.status === 'running' || j.status === 'attention' || j.status === 'failed'
  const tone = j.status === 'attention' ? 'text-attention' : j.status === 'failed' ? 'text-destructive' : j.status === 'running' ? 'text-primary' : 'text-foreground/75'
  return (
    <div className="px-4 py-3 desk:py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 max-desk:items-start">
        <JobDot job={j} className="mt-px max-desk:mt-[6px]" />
        <div className="min-w-0 flex-1 basis-48">
          <p className="line-clamp-2 text-[13.5px] leading-snug font-medium break-keep [overflow-wrap:anywhere] desk:line-clamp-1" title={jobTitle(j)}>
            {jobTitle(j)}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            <span className={cn('font-medium', tone)}>{jobState(j)}</span>
            {meta(j) ? <> · {meta(j)}</> : null}
            {j.kind === 'lesson' && j.project ? (
              <span className="whitespace-nowrap">
                {' · '}
                <ProjectDot id={j.project} className="mr-1 size-1.5 -translate-y-px" />
                {j.project}
              </span>
            ) : null}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 max-desk:-mr-2 max-desk:-mt-1">
          {canLog ? (
            <Button variant="ghost" size="sm" onClick={() => setLog(!log)} aria-expanded={log}>
              <TerminalIcon /> Log
            </Button>
          ) : null}
          {isActive(j) ? (
            <Button variant="ghost" size="sm" onClick={stop} disabled={busy} className="hover:text-destructive">
              {j.status === 'queued' ? <XIcon /> : <SquareIcon className="size-3" />} {j.status === 'queued' ? 'Cancel' : 'Stop'}
            </Button>
          ) : null}
          {j.status === 'done' && j.slug ? (
            <Button variant="ghost" size="sm" asChild className="text-primary hover:text-primary">
              <a href={lessonHash(j.slug)}>
                Read <ArrowRightIcon />
              </a>
            </Button>
          ) : null}
        </div>
      </div>
      {(j.status === 'failed' || j.status === 'attention') && j.error ? (
        <p className={cn('mt-1.5 pl-5 text-[12.5px] break-keep', j.status === 'failed' ? 'text-destructive' : 'text-attention')}>{j.error}</p>
      ) : null}
      {log ? (
        <div className="desk:pl-5">
          <LogViewer job={j} />
        </div>
      ) : null}
    </div>
  )
}

export function JobList({ jobs, className }: { jobs: Job[]; className?: string }) {
  return (
    <div className={cn('divide-y overflow-hidden rounded-[10px] border bg-card', className)}>
      {jobs.map((j) => (
        <JobRow key={j.id} job={j} />
      ))}
    </div>
  )
}

/** Active jobs, then the ones that ended in the last `days` days. */
export function recentJobs(jobs: Job[], days = 3, max = 8): Job[] {
  const now = Date.now() / 1000
  return jobs.filter((j) => isActive(j) || now - (j.finished || j.created) < days * 86400).slice(0, max)
}
