/* App data: the one list of pages (tutor lessons and the pages under the roots), the registry projects, the shared
   link inbox and the jobs, and the list's filters (status, tags, search) and view (list or month).
   Lists are refreshed in place; nothing here owns form state (see draft.ts), so a refresh never
   touches what the user is typing. */
import { create } from 'zustand'
import { toast } from 'sonner'
import { api, isActive, type InboxItem, type Item, type Job, type Project, type Status } from './api'
import { useDraft } from './draft'
import { setProjectOrder } from './format'
import { lessonHash, navigate, pageHash } from './router'

const LS_VIEW = 'ap-view'

export type StatusFilter = Status | 'all'
export type ViewMode = 'list' | 'month'
export type ItemPatch = Partial<Pick<Item, 'title' | 'topic' | 'summary' | 'projects' | 'tags' | 'status'>>

function readView(): ViewMode {
  try {
    return localStorage.getItem(LS_VIEW) === 'month' ? 'month' : 'list'
  } catch {
    return 'list'
  }
}

interface State {
  pages: Item[]
  projects: Project[]
  pagesLoaded: boolean
  loadError: string | null
  items: InboxItem[]
  jobs: Job[]
  inboxLoaded: boolean
  q: string
  /** the list's filters, kept while a page is open: one status (Open by default) and tags that must all be on a page */
  status: StatusFilter
  tags: string[]
  mode: ViewMode
  /** the month the board shows, for the list it was set on (#/, #/p/<id>, #/unlinked, an area) */
  board: { key: string; ym: string } | null

  setQ(q: string): void
  setStatus(s: StatusFilter): void
  toggleTag(t: string): void
  clearTags(): void
  setMode(m: ViewMode): void
  setBoard(key: string, ym: string): void
  loadPages(): Promise<void>
  loadInbox(): Promise<void>
  refreshAll(): Promise<void>
  /** PATCH api/items/<id>; a lesson whose lesson tag is taken away goes on to the page reader when it is the one open. */
  patchItem(id: string, body: ItemPatch): Promise<Item>
  /** PATCH api/items {ids, status}: one status for several pages, all or none. */
  patchMany(ids: string[], status: Status): Promise<Item[]>
  linkProject(id: string, project: string): Promise<void>
  unlinkProject(id: string, project: string): Promise<void>
  addLinks(text: string, note: string): Promise<InboxItem[]>
  removeLink(id: string): Promise<void>
  createJob(body: { items: string[]; focus: string; project: string; search: boolean }): Promise<Job>
  cancelJob(id: string): Promise<void>
}

let pollT: ReturnType<typeof setTimeout> | undefined

export const useStore = create<State>()((set, get) => {
  /** 5 s while a job is active, 20 s otherwise; nothing while the page is hidden (it refreshes on return). */
  function schedulePoll() {
    clearTimeout(pollT)
    const active = get().jobs.some(isActive)
    pollT = setTimeout(() => {
      if (document.hidden) return schedulePoll()
      get().loadInbox().catch(() => schedulePoll())
    }, active ? 5000 : 20000)
  }

  function withUnknown(i: Item): Item {
    const known = new Set(get().projects.map((p) => p.id))
    return { ...i, unknown_projects: get().projects.length ? i.projects.filter((p) => !known.has(p)) : i.unknown_projects || [] }
  }

  return {
    pages: [],
    projects: [],
    pagesLoaded: false,
    loadError: null,
    items: [],
    jobs: [],
    inboxLoaded: false,
    q: '',
    status: 'open',
    tags: [],
    mode: readView(),
    board: null,

    setQ: (q) => set({ q }),
    setStatus: (status) => set({ status }),
    toggleTag: (t) => set({ tags: get().tags.includes(t) ? get().tags.filter((x) => x !== t) : [...get().tags, t] }),
    clearTags: () => set({ tags: [] }),
    setMode: (mode) => {
      try {
        localStorage.setItem(LS_VIEW, mode)
      } catch {
        /* private mode */
      }
      set({ mode })
    },
    setBoard: (key, ym) => set({ board: { key, ym } }),

    async loadPages() {
      try {
        const [l, p] = await Promise.all([api<{ items: Item[] }>('items'), api<{ projects: Project[] }>('projects')])
        setProjectOrder(p.projects.map((x) => x.id))
        set({ pages: l.items, projects: p.projects, pagesLoaded: true, loadError: null })
      } catch (e) {
        set({ pagesLoaded: true, loadError: (e as Error).message })
        throw e
      }
    },

    async loadInbox() {
      try {
        const r = await api<{ items: InboxItem[]; jobs: Job[] }>('inbox')
        const prev = new Map(get().jobs.map((j) => [j.id, j.status]))
        const hadList = get().inboxLoaded
        set({ items: r.items || [], jobs: r.jobs || [], inboxLoaded: true })
        useDraft.getState().prune((r.items || []).map((i) => i.id))
        if (hadList) {
          let pagesChanged = false
          for (const j of r.jobs || []) {
            const was = prev.get(j.id)
            if (!was || was === j.status || !['queued', 'running', 'attention'].includes(was)) continue
            if (j.status === 'done') {
              pagesChanged = true
              if (j.kind === 'lesson' && j.slug) {
                const slug = j.slug
                toast.success('A lesson is ready', { duration: 12000, action: { label: 'Read', onClick: () => navigate(lessonHash(slug)) } })
              }
            } else if (j.status === 'failed') {
              toast.error(j.kind === 'revise' ? 'Revision failed' : 'The lesson job failed', { description: j.error || undefined })
            } else if (j.status === 'attention') {
              toast.warning('The tutor is waiting for you', { description: 'Look at tuios session “tutor”.' })
            }
          }
          if (pagesChanged) get().loadPages().catch(() => {})
        }
      } finally {
        schedulePoll()
      }
    },

    async refreshAll() {
      await Promise.all([get().loadPages(), get().loadInbox()])
    },

    async patchItem(id, body) {
      const old = get().pages.find((i) => i.id === id)
      try {
        const m = await api<Item>(`items/${encodeURIComponent(id)}`, { method: 'PATCH', body })
        const next = withUnknown(m)
        set({ pages: get().pages.map((i) => (i.id === id ? next : i)) })
        if (old?.slug && !next.slug && location.hash === lessonHash(old.slug)) {
          // the lesson tag is gone: the page reader shows it, once the open dialog has closed (PageView does the other way)
          setTimeout(() => navigate(pageHash(next.url), { replace: true }), 250)
        }
        return next
      } catch (e) {
        toast.error((e as Error).message)
        throw e
      }
    },

    async patchMany(ids, status) {
      try {
        const r = await api<{ items: Item[] }>('items', { method: 'PATCH', body: { ids, status } })
        const next = new Map(r.items.map((m) => [m.id, withUnknown(m)]))
        set({ pages: get().pages.map((i) => next.get(i.id) || i) })
        return r.items
      } catch (e) {
        toast.error((e as Error).message)
        throw e
      }
    },

    async linkProject(id, project) {
      const l = get().pages.find((x) => x.id === id)
      if (!l) return
      if (l.projects.includes(project)) {
        toast(`Already linked to ${project}`)
        return
      }
      await get().patchItem(id, { projects: [...l.projects, project] })
      toast.success(`Linked to ${project}`)
    },

    async unlinkProject(id, project) {
      const l = get().pages.find((x) => x.id === id)
      if (!l) return
      await get().patchItem(id, { projects: l.projects.filter((p) => p !== project) })
    },

    async addLinks(text, note) {
      const r = await api<{ added: InboxItem[] }>('inbox', { method: 'POST', body: { text, note } })
      await get().loadInbox()
      // titles are fetched by the server a moment later
      setTimeout(() => get().loadInbox().catch(() => {}), 3000)
      return r.added || []
    },

    async removeLink(id) {
      await api(`inbox/${encodeURIComponent(id)}`, { method: 'DELETE' })
      useDraft.getState().unselect(id)
      await get().loadInbox()
    },

    async createJob(body) {
      const j = await api<Job>('jobs', { method: 'POST', body })
      set({ jobs: [j, ...get().jobs.filter((x) => x.id !== j.id)] })
      get().loadInbox().catch(() => {})
      return j
    },

    async cancelJob(id) {
      await api(`jobs/${id}/cancel`, { method: 'POST' })
      await get().loadInbox()
    },
  }
})

/** Whether a page matches every word of a search in its title, topic, summary, path, projects or tags. */
export function matchesSearch(i: Item, q: string): boolean {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const text = [i.title, i.topic, i.summary, i.path, i.slug || '', i.projects.join(' '), i.tags.join(' ')].join(' ').toLowerCase()
  return words.every((w) => text.includes(w))
}

/** The pages a list shows for a status filter and tags (every picked tag must be on the page). */
export function filterItems(items: Item[], status: StatusFilter, tags: string[]): Item[] {
  return items.filter((i) => (status === 'all' || i.status === status) && tags.every((t) => i.tags.includes(t)))
}

export const activeJobCount = (jobs: Job[]) => jobs.filter(isActive).length
