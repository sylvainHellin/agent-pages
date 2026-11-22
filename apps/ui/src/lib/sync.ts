/* Review sync between devices. The implementation is lessons/_assets/review-sync.js (window.TutorSync),
   loaded once from the server so lesson pages, tests and this app share one copy. It mirrors the page's
   localStorage keys anno:<key>* to GET/POST api/lessons/<slug>/review. The key is the slug for a tutor
   lesson and the page's own storage key for an in-place lesson (setKey, from lessonDocKey).
   For the lesson the reader's iframe shows, pull and push go through that page's own sync: the app never
   writes its storage, since report.js there would write its older copy back. */
import { rootUrl } from './api'

interface TutorSyncApi {
  pull(api: string, slug: string, key?: string): Promise<boolean>
  push(api: string, slug: string, keepalive?: boolean, key?: string): Promise<boolean>
}

const keys = new Map<string, string>()

/** The storage key of a lesson whose page does not key its review by the slug. */
export function setKey(slug: string, key: string): void {
  if (key && key !== slug) keys.set(slug, key)
  else keys.delete(slug)
}

declare global {
  interface Window {
    TutorSync?: TutorSyncApi
  }
}

let loading: Promise<TutorSyncApi | null> | null = null

function load(): Promise<TutorSyncApi | null> {
  if (window.TutorSync) return Promise.resolve(window.TutorSync)
  if (!loading) {
    loading = new Promise((resolve) => {
      const s = document.createElement('script')
      s.src = rootUrl('lessons/_assets/review-sync.js')
      s.onload = () => resolve(window.TutorSync || null)
      s.onerror = () => {
        loading = null
        resolve(null)
      }
      document.head.append(s)
    })
  }
  return loading
}

const API = () => rootUrl('api/')

/** Before a lesson page loads: true when it changed what this device has stored.
 *  For the lesson the iframe shows: false, and the page catches up and reloads itself once the reader is not typing. */
export async function pull(slug: string | null | undefined): Promise<boolean> {
  if (!slug) return false
  const t = await load()
  if (!t) return false
  // a TutorSync of another version (an older copy in a cache) must not make the reader throw
  try {
    return await t.pull(API(), slug, keys.get(slug))
  } catch {
    return false
  }
}

export function push(slug: string | null | undefined, keepalive = false): void {
  if (!slug) return
  const key = keys.get(slug)
  if (window.TutorSync) void window.TutorSync.push(API(), slug, keepalive, key)
  else void load().then((t) => t?.push(API(), slug, keepalive, key))
}

load()
