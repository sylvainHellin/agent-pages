export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const WDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** "2026-11-05" -> local Date (no timezone shift) */
export function pdate(s?: string): Date {
  const p = (s || '').split('-')
  return new Date(+p[0] || 1970, (+p[1] || 1) - 1, +p[2] || 1)
}

export function monthLabel(ym: string): string {
  const d = pdate(ym + '-01')
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** "Thu 5 Nov" or "Thu 5 Nov 2026" */
export function dayLabel(s: string, year = false): string {
  const d = pdate(s)
  return `${WDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}${year ? ' ' + d.getFullYear() : ''}`
}

export function ago(ts?: number | null): string {
  if (!ts) return ''
  const s = Math.max(0, Date.now() / 1000 - ts)
  const d = Math.floor(s / 86400)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (d < 1) return `${Math.round(s / 3600)} h ago`
  if (d === 1) return 'yesterday'
  if (d < 45) return `${d} days ago`
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

export function host(u: string): string {
  try {
    return new URL(u).host.replace(/^www\./, '')
  } catch {
    return u
  }
}

/* 12 soft hues, evenly spread; FNV-1a picks one per project id */
const HUES = [25, 55, 85, 125, 160, 190, 215, 245, 275, 305, 335, 5]

function hash(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/* Registry order (append-mostly) keeps neighbours apart and colours stable; unknown ids fall back to a hash. */
let ORDER = new Map<string, number>()
export function setProjectOrder(ids: string[]) {
  ORDER = new Map(ids.map((id, i) => [id, i]))
}

/** A stable, soft colour per project id, for small dots. */
export function projectColor(id: string): string {
  const h = HUES[(ORDER.get(id) ?? hash(id)) % HUES.length]
  return `oklch(${h > 60 && h < 130 ? 0.74 : 0.68} 0.09 ${h})`
}

/** Lessons without a project. */
export const NO_PROJECT_COLOR = 'oklch(0.8 0.006 286)'

/* ---------- calendar ---------- */

const pad = (n: number) => String(n).padStart(2, '0')

/** Date -> "2026-11-05" (local) */
export const dkey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const ymKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
export const todayKey = () => dkey(new Date())

/** "2026-11" + n months */
export function addMonths(ym: string, n: number): string {
  const d = pdate(ym + '-01')
  return ymKey(new Date(d.getFullYear(), d.getMonth() + n, 1))
}

/** The weeks (Mon first) that show the month `ym`: 4 to 6 rows of 7 dates. */
export function monthWeeks(ym: string): Date[][] {
  const first = pdate(ym + '-01')
  const start = new Date(first)
  start.setDate(1 - ((first.getDay() + 6) % 7))
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
  const weeks: Date[][] = []
  const d = new Date(start)
  while (d <= last) {
    const w: Date[] = []
    for (let i = 0; i < 7; i++) {
      w.push(new Date(d))
      d.setDate(d.getDate() + 1)
    }
    weeks.push(w)
  }
  return weeks
}

export const WEEK_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const WDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "Thursday, 5 November" */
export function longDay(s: string): string {
  const d = pdate(s)
  return `${WDAYS_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`
}
