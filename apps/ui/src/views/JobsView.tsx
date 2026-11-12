/* #/jobs: every lesson and revision job the server keeps (newest 30). */
import { PlusIcon } from 'lucide-react'
import { isActive } from '@/lib/api'
import { useStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty, PageHeader, SectionLabel } from '@/components/bits'
import { JobList } from '@/components/jobs'

export function JobsView() {
  const jobs = useStore((s) => s.jobs)
  const loaded = useStore((s) => s.inboxLoaded)
  const active = jobs.filter(isActive)
  const rest = jobs.filter((j) => !isActive(j))
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4 pb-12 desk:px-8 desk:pt-12">
      <PageHeader
        className="max-desk:mb-4 max-desk:[&_h1]:hidden"
        title="Jobs"
        description={
          <>
            Each job is an agent in tuios session “tutor” on the Spark (<code className="font-mono text-[12px]">tuios attach tutor</code> to watch). One runs at a time; the
            others wait their turn.
          </>
        }
      >
        <Button variant="outline" asChild className="hidden shrink-0 desk:inline-flex">
          <a href="#/new">
            <PlusIcon /> New lesson
          </a>
        </Button>
      </PageHeader>
      {!loaded ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full rounded-[10px]" />
          <Skeleton className="h-14 w-full rounded-[10px]" />
        </div>
      ) : !jobs.length ? (
        <Empty title="No jobs yet">
          Start one under <a href="#/new" className="text-primary hover:underline">New lesson</a>, or send your answers from a lesson with “Send to tutor”.
        </Empty>
      ) : (
        <>
          {active.length ? (
            <>
              <SectionLabel className="mt-0">Active · {active.length}</SectionLabel>
              <JobList jobs={active} />
            </>
          ) : null}
          {rest.length ? (
            <>
              <SectionLabel className={active.length ? undefined : 'mt-0'}>Recent</SectionLabel>
              <JobList jobs={rest} />
            </>
          ) : null}
        </>
      )}
    </div>
  )
}
