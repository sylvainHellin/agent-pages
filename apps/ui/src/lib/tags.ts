/* The tags the list's tag menu offers: the picked ones first (even when no page in view carries them),
   then the others, most used first and by name. Pure, so tests/tags.test.mjs runs it under node. */

export interface TagCount {
  tag: string
  count: number
}

export function rankTags(items: { tags: string[] }[], picked: string[]): TagCount[] {
  const counts = new Map<string, number>()
  for (const i of items) for (const t of i.tags) counts.set(t, (counts.get(t) || 0) + 1)
  const rest = [...counts.entries()]
    .filter(([t]) => !picked.includes(t))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }))
  return [...picked.map((tag) => ({ tag, count: counts.get(tag) || 0 })), ...rest]
}
