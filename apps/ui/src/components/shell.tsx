/* App frame. Desktop (>= 900 px): a narrow sidebar. Phone: a slim header + bottom tab bar. The reader uses the whole screen.
   The sidebar's lower list follows the section: lesson projects in the library, report areas (group, then its sub-areas
   once the group is picked) under Reports; on a phone the header title is the same picker. */
import { useState, type ReactNode } from 'react'
import { ArrowUpRightIcon, BookOpenIcon, CheckIcon, ChevronDownIcon, FileTextIcon, ListChecksIcon, PlusIcon, RefreshCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { VAULT } from '@/lib/api'
import { areaGroups, groupOf } from '@/lib/areas'
import type { Route } from '@/lib/router'
import { navigate, projectHash, reportsHash } from '@/lib/router'
import { activeJobCount, useStore, visibleLessons } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { IconTip, ProjectDot } from './bits'
import { ThemeButton } from './theme-toggle'

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden>
      <rect width="20" height="20" rx="5.5" fill="var(--primary)" />
      <path d="M6 6.75h8M6 10h5M6 13.25h6.5" stroke="var(--primary-foreground)" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function useRefresh() {
  const refreshAll = useStore((s) => s.refreshAll)
  const [busy, setBusy] = useState(false)
  return {
    busy,
    run: async () => {
      setBusy(true)
      try {
        await refreshAll()
        toast.success('Updated')
      } catch (e) {
        toast.error((e as Error).message)
      }
      setBusy(false)
    },
  }
}

/** Lessons per project (and without one), as the lists count them. */
function useProjectCounts() {
  const lessons = useStore((s) => s.lessons)
  const archived = useStore((s) => s.archived)
  const shown = visibleLessons(lessons, archived, '')
  const per = new Map<string, number>()
  for (const l of shown) for (const p of l.projects) per.set(p, (per.get(p) || 0) + 1)
  const ids = [...per.keys()].sort((a, b) => a.localeCompare(b))
  return { total: shown.length, per, ids, unlinked: shown.filter((l) => !l.projects.length).length }
}

/** The report areas, as groups with their sub-areas, and the area picked in the route. */
function useAreas(route: Route) {
  const pages = useStore((s) => s.pages)
  return { groups: areaGroups(pages), total: pages.length, area: route.name === 'reports' ? route.area : '' }
}

function AreaList({ route }: { route: Route }) {
  const { groups, total, area } = useAreas(route)
  const open = groupOf(area)
  const link = (key: string, a: string, text: string, n: number, sub = false) => (
    <a key={key} href={reportsHash(a)} aria-current={area === a ? 'page' : undefined} className={cn(sideItem, sub && 'pl-[1.6rem] text-[12.5px]')}>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <span className="text-[11.5px] font-normal text-faint tabular-nums">{n}</span>
    </a>
  )
  return (
    <>
      <div className="mt-6 mb-1 px-4 text-[11.5px] font-medium text-faint">Areas</div>
      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3">
        {link('all', '', 'All reports', total)}
        {groups.map((g) => (
          <div key={g.id} className="flex flex-col gap-px">
            {link(g.id, g.id, g.id, g.n)}
            {open === g.id ? g.subs.map(([a, n]) => link(a, a, a.slice(g.id.length + 1), n, true)) : null}
          </div>
        ))}
      </div>
    </>
  )
}

const section = (r: Route) => (r.name === 'new' || r.name === 'add' ? 'new' : r.name === 'jobs' ? 'jobs' : r.name === 'reports' || r.name === 'page' ? 'reports' : 'lessons')

const sideItem =
  'flex h-7 items-center gap-2 rounded-md px-2 text-[13px] text-sidebar-foreground transition-colors duration-150 hover:bg-foreground/[0.04] hover:text-foreground aria-[current=page]:bg-foreground/[0.06] aria-[current=page]:font-medium aria-[current=page]:text-foreground'

function NavItem({ href, icon, label, active, badge }: { href: string; icon: ReactNode; label: string; active: boolean; badge?: number }) {
  return (
    <a href={href} aria-current={active ? 'page' : undefined} className={cn(sideItem, '[&_svg]:size-[15px] [&_svg]:text-muted-foreground aria-[current=page]:[&_svg]:text-foreground')}>
      {icon}
      <span className="flex-1">{label}</span>
      {badge ? (
        <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-primary tabular-nums" title={`${badge} active`}>
          <span className="size-1.5 animate-tl-pulse rounded-full bg-primary" />
          {badge}
        </span>
      ) : null}
    </a>
  )
}

function Sidebar({ route }: { route: Route }) {
  const archived = useStore((s) => s.archived)
  const setArchived = useStore((s) => s.setArchived)
  const jobs = useStore((s) => s.jobs)
  const refresh = useRefresh()
  const { per, ids, unlinked } = useProjectCounts()
  const sec = section(route)
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[220px] flex-col border-r bg-sidebar desk:flex">
      <div className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-4">
        <LogoMark className="size-[18px]" />
        <a href="#/" className="flex-1 text-[13.5px] font-semibold tracking-[-0.01em]">
          Agent Pages
        </a>
        <ThemeButton size="icon-sm" iconClassName="size-3.5" />
        <IconTip label="Refresh lessons, reports and jobs">
          <Button variant="ghost" size="icon-sm" onClick={refresh.run} disabled={refresh.busy} aria-label="Refresh">
            <RefreshCwIcon className={cn('size-3.5', refresh.busy && 'animate-spin')} />
          </Button>
        </IconTip>
      </div>
      <nav className="flex flex-col gap-px px-2 pt-1">
        <NavItem href="#/" icon={<BookOpenIcon />} label="Library" active={sec === 'lessons' && route.name === 'home'} />
        <NavItem href="#/reports" icon={<FileTextIcon />} label="Reports" active={sec === 'reports'} />
        <NavItem href="#/new" icon={<PlusIcon />} label="New lesson" active={sec === 'new'} />
        <NavItem href="#/jobs" icon={<ListChecksIcon />} label="Jobs" active={sec === 'jobs'} badge={activeJobCount(jobs)} />
      </nav>
      {sec === 'reports' ? <AreaList route={route} /> : <>
      <div className="mt-6 mb-1 px-4 text-[11.5px] font-medium text-faint">Projects</div>
      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3">
        {ids.map((id) => (
          <a key={id} href={projectHash(id)} aria-current={route.name === 'project' && route.id === id ? 'page' : undefined} className={sideItem}>
            <ProjectDot id={id} className="mx-1 size-[7px]" />
            <span className="min-w-0 flex-1 truncate">{id}</span>
            <span className="text-[11.5px] font-normal text-faint tabular-nums">{per.get(id)}</span>
          </a>
        ))}
        {unlinked ? (
          <a href="#/unlinked" aria-current={route.name === 'unlinked' ? 'page' : undefined} className={cn(sideItem, 'text-muted-foreground')}>
            <span aria-hidden className="mx-1 size-[7px] shrink-0 rounded-full border-[1.5px] border-dashed border-faint" />
            <span className="min-w-0 flex-1 truncate">Not linked yet</span>
            <span className="text-[11.5px] font-normal text-faint tabular-nums">{unlinked}</span>
          </a>
        ) : null}
        {!ids.length && !unlinked ? <p className="px-2 text-xs text-faint">No projects linked yet.</p> : null}
      </div>
      </>}
      <div className="flex flex-col gap-px border-t px-2 py-2">
        {sec === 'reports' ? null : <label className="flex h-7 cursor-pointer items-center justify-between rounded-md px-2 text-[12.5px] text-muted-foreground transition-colors duration-150 select-none hover:bg-foreground/[0.04] hover:text-foreground">
          Show archived
          <Switch size="sm" checked={archived} onCheckedChange={setArchived} aria-label="Show archived lessons" />
        </label>}
        <a href={VAULT} target="_blank" rel="noopener" className="flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] text-muted-foreground transition-colors duration-150 hover:bg-foreground/[0.04] hover:text-foreground">
          Vault <ArrowUpRightIcon className="size-3" />
        </a>
      </div>
    </aside>
  )
}

/** Phone: the header title of the library picks the list (all, one project, not linked) and shows archived. */
function FilterMenu({ route }: { route: Route }) {
  const archived = useStore((s) => s.archived)
  const setArchived = useStore((s) => s.setArchived)
  const { total, per, ids, unlinked } = useProjectCounts()
  const label = route.name === 'project' ? route.id : route.name === 'unlinked' ? 'Not linked yet' : 'All lessons'
  const row = (key: string, href: string, icon: ReactNode, text: string, n: number, on: boolean) => (
    <DropdownMenuItem key={key} onSelect={() => navigate(href)} className="gap-2.5">
      {icon}
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <span className="text-xs text-faint tabular-nums">{n}</span>
      <CheckIcon className={cn('size-4 text-primary', !on && 'invisible')} />
    </DropdownMenuItem>
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="quiet" className="h-8 max-w-[70vw] gap-1.5 px-2 text-base font-semibold tracking-[-0.015em]">
          {route.name === 'project' ? <ProjectDot id={route.id} /> : null}
          <span className="truncate">{label}</span>
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-1rem)]">
        {row('all', '#/', <BookOpenIcon className="text-muted-foreground" />, 'All lessons', total, route.name === 'home')}
        {unlinked
          ? row('un', '#/unlinked', <span className="mx-1 size-[7px] shrink-0 rounded-full border-[1.5px] border-dashed border-faint" />, 'Not linked yet', unlinked, route.name === 'unlinked')
          : null}
        {ids.length ? <DropdownMenuLabel>Projects</DropdownMenuLabel> : null}
        {ids.map((id) => row(id, projectHash(id), <ProjectDot id={id} className="mx-1 size-[7px]" />, id, per.get(id)!, route.name === 'project' && route.id === id))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            setArchived(!archived)
          }}
          className="justify-between"
          role="menuitemcheckbox"
          aria-checked={archived}
        >
          Show archived
          <Switch size="sm" checked={archived} tabIndex={-1} aria-hidden className="pointer-events-none" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Phone: the header title of Reports picks the area, a group or one of its sub-areas. */
function AreaMenu({ route }: { route: Route }) {
  const { groups, total, area } = useAreas(route)
  const row = (key: string, a: string, text: string, n: number, sub = false) => (
    <DropdownMenuItem key={key} onSelect={() => navigate(reportsHash(a))} className={cn('gap-2.5', sub && 'pl-6 text-[13px]')}>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <span className="text-xs text-faint tabular-nums">{n}</span>
      <CheckIcon className={cn('size-4 text-primary', area !== a && 'invisible')} />
    </DropdownMenuItem>
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="quiet" className="h-8 max-w-[70vw] gap-1.5 px-2 text-base font-semibold tracking-[-0.015em]">
          <span className="truncate">{area || 'All reports'}</span>
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto">
        {row('all', '', 'All reports', total)}
        <DropdownMenuSeparator />
        {groups.map((g) => [row(g.id, g.id, g.id, g.n), ...g.subs.map(([a, n]) => row(a, a, a.slice(g.id.length + 1), n, true))])}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MobileHeader({ route }: { route: Route }) {
  const refresh = useRefresh()
  const board = route.name === 'home' || route.name === 'project' || route.name === 'unlinked'
  const title = route.name === 'new' || route.name === 'add' ? 'New lesson' : route.name === 'jobs' ? 'Jobs' : route.name === 'reports' ? 'Reports' : 'Lessons'
  return (
    <header className="sticky top-0 z-30 border-b border-foreground/[0.06] bg-background/80 pt-[var(--safe-top)] backdrop-blur-xl backdrop-saturate-150 desk:hidden">
      <div className="flex h-[var(--header-h)] items-center gap-1 px-2">
        {board ? <FilterMenu route={route} /> : route.name === 'reports' ? <AreaMenu route={route} /> : <h1 className="min-w-0 flex-1 truncate px-2 text-base font-semibold tracking-[-0.015em]">{title}</h1>}
        <span className="flex-1" />
        <ThemeButton iconClassName="size-[17px]" />
        <Button variant="ghost" size="icon" onClick={refresh.run} disabled={refresh.busy} aria-label="Refresh">
          <RefreshCwIcon className={cn('size-[17px]', refresh.busy && 'animate-spin')} />
        </Button>
      </div>
    </header>
  )
}

function TabBar({ route }: { route: Route }) {
  const jobs = useStore((s) => s.jobs)
  const n = activeJobCount(jobs)
  const sec = section(route)
  const tab = (key: string, href: string, icon: ReactNode, label: string, badge?: number) => (
    <a
      href={href}
      aria-current={sec === key ? 'page' : undefined}
      className={cn(
        'relative flex h-[var(--tabbar-h)] flex-1 flex-col items-center justify-center gap-[3px] text-[10.5px] font-medium text-muted-foreground transition-colors duration-150',
        sec === key && 'text-primary',
      )}
    >
      <span className="relative [&_svg]:size-5 [&_svg]:stroke-[1.75]">
        {icon}
        {badge ? (
          <span className="absolute -top-1 -right-2.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums ring-2 ring-background">
            {badge}
          </span>
        ) : null}
      </span>
      {label}
    </a>
  )
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-foreground/[0.06] bg-background/75 pb-[var(--safe-bottom)] backdrop-blur-xl backdrop-saturate-150 desk:hidden">
      {tab('lessons', '#/', <BookOpenIcon />, 'Lessons')}
      {tab('reports', '#/reports', <FileTextIcon />, 'Reports')}
      {tab('new', '#/new', <PlusIcon />, 'New')}
      {tab('jobs', '#/jobs', <ListChecksIcon />, 'Jobs', n)}
    </nav>
  )
}

export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  if (route.name === 'lesson' || route.name === 'page') return <>{children}</>
  return (
    <div className="min-h-dvh">
      <Sidebar route={route} />
      <MobileHeader route={route} />
      <main className="pb-[calc(var(--tabbar-h)+var(--safe-bottom))] desk:pb-0 desk:pl-[220px]">{children}</main>
      <TabBar route={route} />
    </div>
  )
}
