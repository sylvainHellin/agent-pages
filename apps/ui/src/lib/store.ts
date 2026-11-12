/* App data: lessons + registry projects, the report pages, the shared link inbox and the jobs.
   Lists are refreshed in place; nothing here owns form state (see draft.ts), so a refresh never
   touches what the user is typing. */
import { create } from 'zustand'
import { toast } from 'sonner'
import { api, isActive, type InboxItem, type Job, type Lesson, type Project, type ReportPage } from './api'
import { useDraft } from './draft'
import { setProjectOrder } from './format'
import { lessonHash, navigate } from './router'

const LS_ARCHIVED = 'tl-archived'

function readBool(key: string, d: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v == null ? d : JSON.parse(v) === true
  } catch {
    return d
  }
}

interface State {
  lessons: Lesson[]
  projects: Project[]
  lessonsLoaded: boolean
  loadError: string | null
  items: InboxItem[]
  jobs: Job[]
  inboxLoaded: boolean
  pages: ReportPage[]
  pagesLoaded: boolean
  pagesError: string | null
  archived: boolean
  q: string
  /** the month the board shows, for the list it was set on (#/, #/p/<id>, #/unlinked) */
  board: { key: string; ym: string } | null

  setQ(q: string): void
  setArchived(on: boolean): void
  setBoard(key: string, ym: string): void
  loadLessons(): Promise<void>
  loadInbox(): Promise<void>
  loadPages(): Promise<void>
  refreshAll(): Promise<void>
  patchLesson(slug: string, body: Partial<Pick<Lesson, 'title' | 'topic' | 'summary' | 'projects' | 'tags' | 'status'>>): Promise<Lesson>
  linkProject(slug: string, id: string): Promise<void>
  unlinkProject(slug: string, id: string): Promise<void>
  addLinks(text: string, note: string): Promise<InboxItem[]>
  removeLink(id: string): Promise<void>
  createJob(body: { items: string[]; focus: string; project: string; search: boolean }): Promise<Job>
  cancelJob(id: string): Promise<void>
  sendFeedback(slug: string, markdown: string): Promise<Job>
  /** Add or remove the lesson marker in a page under a root, then reload both lists. */
  setPageKind(url: string, kind: 'lesson' | 'report'): Promise<{ url: string; kind: string; slug?: string }>
}

const byDateDesc = (a: Lesson, b: Lesson) => (b.created || '').localeCompare(a.created || '') || b.slug.localeCompare(a.slug)

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

  function withUnknown(l: Lesson): Lesson {
    const known = new Set(get().projects.map((p) => p.id))
    return { ...l, unknown_projects: get().projects.length ? l.projects.filter((p) => !known.has(p)) : l.unknown_projects || [] }
  }

  return {
    lessons: [],
    projects: [],
    lessonsLoaded: false,
    loadError: null,
    items: [],
    jobs: [],
    inboxLoaded: false,
    pages: [],
    pagesLoaded: false,
    pagesError: null,
    archived: readBool(LS_ARCHIVED, false),
    q: '',
    board: null,

    setQ: (q) => set({ q }),
    setArchived: (on) => {
      try {
        localStorage.setItem(LS_ARCHIVED, JSON.stringify(on))
      } catch {
        /* private mode */
      }
      set({ archived: on })
    },
    setBoard: (key, ym) => set({ board: { key, ym } }),

    async loadLessons() {
      try {
        const [l, p] = await Promise.all([api<{ lessons: Lesson[] }>('lessons'), api<{ projects: Project[] }>('projects')])
        setProjectOrder(p.projects.map((x) => x.id))
        set({ lessons: l.lessons.sort(byDateDesc), projects: p.projects, lessonsLoaded: true, loadError: null })
      } catch (e) {
        set({ lessonsLoaded: true, loadError: (e as Error).message })
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
          let lessonsChanged = false
          for (const j of r.jobs || []) {
            const was = prev.get(j.id)
            if (!was || was === j.status || !['queued', 'running', 'attention'].includes(was)) continue
            if (j.status === 'done') {
              lessonsChanged = true
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
          if (lessonsChanged) get().loadLessons().catch(() => {})
        }
      } finally {
        schedulePoll()
      }
    },

    async loadPages() {
      try {
        const r = await api<{ pages: ReportPage[] }>('pages')
        set({ pages: r.pages || [], pagesLoaded: true, pagesError: null })
      } catch (e) {
        set({ pagesLoaded: true, pagesError: (e as Error).message })
        throw e
      }
    },

    async refreshAll() {
      await Promise.all([get().loadLessons(), get().loadInbox(), get().loadPages()])
    },

    async patchLesson(slug, body) {
      try {
        const m = await api<Lesson>(`lessons/${encodeURIComponent(slug)}`, { method: 'PATCH', body })
        const old = get().lessons.find((l) => l.slug === slug)
        const next = withUnknown({ ...old, ...m, opened: old?.opened })
        set({ lessons: get().lessons.map((l) => (l.slug === slug ? next : l)) })
        return next
      } catch (e) {
        toast.error((e as Error).message)
        throw e
      }
    },

    async linkProject(slug, id) {
      const l = get().lessons.find((x) => x.slug === slug)
      if (!l) return
      if (l.projects.includes(id)) {
        toast(`Already linked to ${id}`)
        return
      }
      await get().patchLesson(slug, { projects: [...l.projects, id] })
      toast.success(`Linked to ${id}`)
    },

    async unlinkProject(slug, id) {
      const l = get().lessons.find((x) => x.slug === slug)
      if (!l) return
      await get().patchLesson(slug, { projects: l.projects.filter((p) => p !== id) })
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

    async sendFeedback(slug, markdown) {
      const j = await api<Job>(`lessons/${encodeURIComponent(slug)}/feedback`, { method: 'POST', body: { markdown } })
      set({ jobs: [j, ...get().jobs.filter((x) => x.id !== j.id)] })
      schedulePoll()
      return j
    },

    async setPageKind(url, kind) {
      const r = await api<{ url: string; kind: string; slug?: string }>('pages/kind', { method: 'POST', body: { url, kind } })
      await Promise.all([get().loadLessons(), get().loadPages()])
      return r
    },
  }
})

/** Lessons shown in lists: archived only when asked for, and the search applied. */
export function visibleLessons(lessons: Lesson[], archived: boolean, q: string): Lesson[] {
  const s = q.trim().toLowerCase()
  return lessons.filter((l) => {
    if (!archived && l.status === 'archived') return false
    if (!s) return true
    return [l.title, l.topic, l.summary, l.slug, l.projects.join(' '), (l.tags || []).join(' '), l.path || ''].join(' ').toLowerCase().includes(s)
  })
}

export const activeJobCount = (jobs: Job[]) => jobs.filter(isActive).length
