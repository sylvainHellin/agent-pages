/* What the user is writing on the New lesson page: kept in localStorage so it survives polling,
   leaving the page and reloads. One key for both entry points (/ and /app/ share the origin).
   The old front ends kept their drafts in tl-draft (web) and tutor-draft (phone): read once. */
import { create } from 'zustand'

export interface Draft {
  focus: string
  project: string
  search: boolean
  links: string
  note: string
  sel: string[]
}

const KEY = 'tl-new-draft'

function readJson(key: string): Record<string, unknown> | null {
  try {
    const v = localStorage.getItem(key)
    return v ? JSON.parse(v) : null
  } catch {
    return null
  }
}

function initial(): Draft {
  const d: Draft = { focus: '', project: '', search: true, links: '', note: '', sel: [] }
  const cur = readJson(KEY)
  if (cur) return { ...d, ...(cur as Partial<Draft>) }
  const web = readJson('tl-draft') || {}
  const phone = readJson('tutor-draft') || {}
  const str = (...v: unknown[]) => (v.find((x) => typeof x === 'string' && x) as string) || ''
  return {
    focus: str(web.focus, phone.focus),
    project: str(web.proj, phone.project),
    search: web.search !== false && phone.search !== false,
    links: str(web.url, phone.url),
    note: str(web.note, phone.note),
    sel: [...new Set([...((web.sel as string[]) || []), ...((phone.sel as string[]) || [])])],
  }
}

interface DraftStore extends Draft {
  set(patch: Partial<Draft>): void
  toggle(id: string): void
  select(ids: string[]): void
  unselect(id: string): void
  clearSel(): void
  /** forget selections of links that are no longer in the inbox */
  prune(ids: string[]): void
}

export const useDraft = create<DraftStore>()((set, get) => ({
  ...initial(),
  set: (patch) => set(patch),
  toggle: (id) => set({ sel: get().sel.includes(id) ? get().sel.filter((x) => x !== id) : [...get().sel, id] }),
  select: (ids) => set({ sel: [...new Set([...get().sel, ...ids])] }),
  unselect: (id) => set({ sel: get().sel.filter((x) => x !== id) }),
  clearSel: () => set({ sel: [] }),
  prune: (ids) => {
    const have = new Set(ids)
    const sel = get().sel.filter((x) => have.has(x))
    if (sel.length !== get().sel.length) set({ sel })
  },
}))

useDraft.subscribe((s) => {
  const { focus, project, search, links, note, sel } = s
  try {
    localStorage.setItem(KEY, JSON.stringify({ focus, project, search, links, note, sel }))
  } catch {
    /* private mode */
  }
})
