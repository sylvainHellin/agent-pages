/* Hash routes (kept from the two old front ends):
     #/                 library: project shelf + timeline of the lessons, the tutor's and the marked pages under the roots
     #/p/<id>           one registry project
     #/unlinked         lessons without a project
     #/l/<slug>         read one lesson (slug page-<hash> for a marked page read in place)
     #/new              new lesson: topic, project, shared link inbox   (#/links: old phone tab, same page)
     #/jobs             lesson and revision jobs
     #/reports[?area=a]  report pages under the server's roots, newest first (pages without the lesson marker)
     #/r/<url>          read one report page in the app (url: its server path, encoded)
     #/add?u=<url>&n=<note>   add a link (iOS Shortcut target), then #/new */
import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'project'; id: string }
  | { name: 'unlinked' }
  | { name: 'lesson'; slug: string }
  | { name: 'new' }
  | { name: 'jobs' }
  | { name: 'reports'; area: string }
  | { name: 'page'; url: string }
  | { name: 'add'; url: string; note: string }

export function parse(hash: string): Route {
  const h = hash.replace(/^#\/?/, '')
  const [path, qs] = h.split('?')
  const parts = path.split('/').filter(Boolean)
  const dec = (s: string) => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  }
  if (parts[0] === 'l' && parts[1]) return { name: 'lesson', slug: dec(parts[1]) }
  if (parts[0] === 'p' && parts[1]) return { name: 'project', id: dec(parts[1]) }
  if (parts[0] === 'r' && parts[1]) return { name: 'page', url: '/' + dec(parts[1]) }
  if (parts[0] === 'unlinked') return { name: 'unlinked' }
  if (parts[0] === 'new' || parts[0] === 'links') return { name: 'new' }
  if (parts[0] === 'jobs') return { name: 'jobs' }
  if (parts[0] === 'reports') return { name: 'reports', area: new URLSearchParams(qs || '').get('area') || '' }
  if (parts[0] === 'add') {
    const q = new URLSearchParams(qs || '')
    return { name: 'add', url: q.get('u') || q.get('url') || q.get('text') || '', note: q.get('n') || q.get('note') || '' }
  }
  return { name: 'home' }
}

const listeners = new Set<() => void>()
function emit() {
  listeners.forEach((l) => l())
}
window.addEventListener('hashchange', emit)

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => location.hash)
}

export function navigate(hash: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) {
    history.replaceState(null, '', hash)
    emit()
  } else if (location.hash !== hash) {
    location.hash = hash
  }
}

export const lessonHash = (slug: string) => `#/l/${encodeURIComponent(slug)}`
export const projectHash = (id: string) => `#/p/${encodeURIComponent(id)}`
export const pageHash = (url: string) => `#/r/${encodeURIComponent(url.replace(/^\//, ''))}`
export const reportsHash = (area = '') => (area ? `#/reports?area=${encodeURIComponent(area)}` : '#/reports')

/** Absolute link to a route of this app (for "Copy link"). */
export const hereUrl = (hash: string) => location.origin + location.pathname + hash
