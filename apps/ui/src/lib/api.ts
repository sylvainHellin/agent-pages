/* The same build is served at <root>/ (library) and <root>/app/ (phone Web Clip), and the root itself
   may sit behind `tailscale serve --set-path /tutor`. Every server URL is therefore resolved against
   the app root computed from the page location, never written as an absolute path. */

export type Status = 'learning' | 'understood' | 'archived'

export interface Lesson {
  slug: string
  title: string
  topic?: string
  summary?: string
  created: string
  projects: string[]
  tags: string[]
  status: Status
  updated?: number
  opened?: number | null
  counts?: { sections: number; questions: number; figures: number }
  unknown_projects?: string[]
  /** an in-place lesson: a page with the lesson marker under one of the server's roots, slug page-<hash> */
  inplace?: boolean
  url?: string // in-place: its server path, e.g. /documents/loc/x.html
  path?: string // in-place: ~/Documents/loc/x.html
  doc_id?: string | null // in-place: the page's data-doc-id, its storage key
}

export interface Project {
  id: string
  status?: string | null
  type?: string | null
  path?: string | null
  notes?: string
}

/** A report page under one of the server's roots (GET api/pages, newest first). */
export interface ReportPage {
  title: string
  url: string // server path, e.g. /documents/loc/x.html
  path: string // ~/Documents/loc/x.html
  mtime: number
  root: string
  area: string
  kind: 'report' // pages with the lesson marker are listed as lessons (api/lessons)
}

export interface InboxItem {
  id: string
  url: string
  title: string
  note: string
  added: number
  lessons?: string[]
}

export type JobStatus = 'queued' | 'running' | 'attention' | 'done' | 'failed' | 'cancelled'

export interface Job {
  id: string
  created: number
  status: JobStatus
  kind: 'lesson' | 'revise'
  slug: string | null
  error: string | null
  links: { id: string; url: string; title: string; note: string }[]
  focus: string
  project: string
  search?: boolean
  title?: string
  started?: number
  finished?: number
}

/** `./` normally, `../` when the page is the phone entry point `<root>/app/`. */
export const APP_ROOT = new URL(/\/app\/(index\.html)?$/.test(location.pathname) ? '../' : './', location.href)

export function rootUrl(path: string): string {
  return new URL(path, APP_ROOT).href
}

export const lessonUrl = (slug: string) => rootUrl(`lessons/${encodeURIComponent(slug)}/`)

/** Where a lesson's page is served: the lessons folder, or the in-place page's own server path. */
export const lessonPageUrl = (l: Pick<Lesson, 'slug' | 'inplace' | 'url'>) => (l.inplace && l.url ? rootUrl(l.url.replace(/^\//, '')) : lessonUrl(l.slug))

/** The key the page stores its review under (report.js docIdOf): data-doc-id, else the page's path. */
export function lessonDocKey(l: Pick<Lesson, 'slug' | 'inplace' | 'url' | 'doc_id'>): string {
  if (!l.inplace) return l.slug
  if (l.doc_id && l.doc_id !== 'report-slug') return l.doc_id
  return new URL(lessonPageUrl(l)).pathname
}

/** The folder of an in-place lesson's path, for the reader's bar. */
export const folderOf = (path: string) => path.replace(/\/[^/]*$/, '') || path

export class ApiError extends Error {}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(rootUrl(`api/${path}`), {
    method: opts.method || 'GET',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new ApiError((j && (j as { error?: string }).error) || `${r.status} ${r.statusText}`)
  return j as T
}

export const isActive = (j: Job) => j.status === 'queued' || j.status === 'running' || j.status === 'attention'

export const VAULT = 'obsidian://open?vault=notes'
export const registryUrl = (id: string) => `${VAULT}&file=${encodeURIComponent(id)}`

/** Same pattern as src/agent_pages/server/jobs.py URL_RE + _trim_url: what the server will collect from a text. */
export function findLinks(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    let u = m[0]
    while (u && '.,;:!?]>)'.includes(u[u.length - 1])) {
      if (u.endsWith(')') && (u.match(/\(/g) || []).length >= (u.match(/\)/g) || []).length) break
      u = u.slice(0, -1)
    }
    if (u && !out.includes(u)) out.push(u)
  }
  return out
}
