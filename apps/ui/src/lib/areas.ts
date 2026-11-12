/* Areas of the report pages, in two levels: the group (first folder, e.g. work) and its sub-areas (work/notes), so the
   filter shows ten groups instead of twenty flat labels. An area filter matches the area and everything under it. */
import type { ReportPage } from './api'

export interface AreaGroup {
  id: string
  n: number
  /** sub-areas under the group, as [full area, count], biggest first */
  subs: [string, number][]
}

export const groupOf = (area: string) => area.split('/')[0]

export const inArea = (pageArea: string, area: string) => !area || pageArea === area || pageArea.startsWith(`${area}/`)

/** The area label shown inside a filter: the part below it (work/notes under work is notes), nothing for the area itself. */
export function areaBelow(pageArea: string, area: string): string {
  if (!area) return pageArea
  return pageArea === area ? '' : pageArea.slice(area.length + 1)
}

export function areaGroups(pages: ReportPage[]): AreaGroup[] {
  const groups = new Map<string, AreaGroup>()
  for (const p of pages) {
    const id = groupOf(p.area)
    const g = groups.get(id) || { id, n: 0, subs: [] }
    g.n++
    if (p.area !== id) {
      const s = g.subs.find(([a]) => a === p.area)
      if (s) s[1]++
      else g.subs.push([p.area, 1])
    }
    groups.set(id, g)
  }
  const order = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0])
  return [...groups.values()].map((g) => ({ ...g, subs: g.subs.sort(order) })).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id))
}
