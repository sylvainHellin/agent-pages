// apps/ui/src/lib/tags.ts under node (type stripping): the tags the list's tag menu offers, and in what order.
//     node --test tests/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankTags } from '../apps/ui/src/lib/tags.ts'

const items = [{ tags: ['lesson', 'llm'] }, { tags: ['lesson', 'rope'] }, { tags: ['lesson', 'llm', 'attention'] }, { tags: [] }]

test('most used first, then by name, each with its count', () => {
  assert.deepEqual(rankTags(items, []), [
    { tag: 'lesson', count: 3 },
    { tag: 'llm', count: 2 },
    { tag: 'attention', count: 1 },
    { tag: 'rope', count: 1 },
  ])
})

test('picked tags come first, kept even when no page in view carries them', () => {
  assert.deepEqual(rankTags(items, ['rope', 'to-read']), [
    { tag: 'rope', count: 1 },
    { tag: 'to-read', count: 0 },
    { tag: 'lesson', count: 3 },
    { tag: 'llm', count: 2 },
    { tag: 'attention', count: 1 },
  ])
})
