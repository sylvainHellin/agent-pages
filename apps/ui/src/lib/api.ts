/* The same build is served at <root>/ (library) and <root>/app/ (phone Web Clip), and the root itself
   may sit behind `tailscale serve --set-path /tutor`. Every server URL is therefore resolved against
   the app root computed from the page location, never written as an absolute path. */

/** open: to read or answer; sent: handed to an agent (set by Send to agent, open again once the page changes);
    done; archived. */
export type Status = 'open' | 'sent' | 'done' | 'archived'
export const STATUSES: Status[] = ['open', 'sent', 'done', 'archived']
/** What the reader can pick; sent is set by Send to agent only. */
export const SETTABLE: Status[] = ['open', 'done', 'archived']
export const LESSON_TAG = 'lesson'

/** One page of the one list (GET api/items): a page under the server's roots or a tutor lesson. */
export interface Item {
  id: string // its review id: PATCH api/items/<id>
  key: string // what its status and tags are stored under: data-doc-id, else the URL; tutor:<slug> for a tutor lesson
  url: string // server path: /documents/loc/x.html, /lessons/<slug>/ for a tutor lesson
  title: string
  path: string // ~/Documents/loc/x.html
  mtime: number
  changed: number // the newer of the file's change and the last edit of its status, tags or details
  root: string
  area: string
  status: Status
  tags: string[] // "lesson" for tutor lessons and pages with the lesson marker
  projects: string[]
  unknown_projects?: string[]
  topic: string
  summary: string
  sessions: string[]
  origin: 'report' | 'tutor'
  /** a lesson's slug (#/l/<slug> goes on to its page): the tutor's folder name, or page-<hash> for a marked page; null for a report */
  slug: string | null
  doc_id?: string | null
  created: string // YYYY-MM-DD: the date in the file or folder name, else the file's date
  counts?: { sections: number; questions: number; figures: number }
  sent_at?: number
  shared?: string[] // other pages with the same data-doc-id (their status cannot be set)
}

export interface Project {
  id: string
  status?: string | null
  type?: string | null
  path?: string | null
  notes?: string
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

/** Where a page is served: its own server path (a tutor lesson's is /lessons/<slug>/). */
export const pageUrl = (i: Pick<Item, 'url'>) => rootUrl(i.url.replace(/^\//, ''))

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
