import { expect, it } from 'vitest'
import { sortCatalog } from '../tv-app/sort'
const entry = (name: string, url = name) => ({ name, url, group: 'Test' })
it('sorts naturally in either direction without mutating provider order or moving ties', async () => {
  const items = [entry('Show 10'), entry('Show 2', 'first'), entry('Show 2', 'second'), entry('A')]
  const signal = new AbortController().signal
  expect((await sortCatalog(items, 'name-asc', signal)).map(item => item.url)).toEqual(['A', 'first', 'second', 'Show 10'])
  expect((await sortCatalog(items, 'name-desc', signal)).map(item => item.url)).toEqual(['Show 10', 'first', 'second', 'A'])
  expect((await sortCatalog(items, 'provider', signal))).toBe(items); expect(items[0].name).toBe('Show 10')
})
it('allows a newer query to cancel a large sort before it publishes results', async () => {
  const controller = new AbortController(), items = Array.from({ length: 100000 }, (_, index) => entry(`Title ${100000 - index}`))
  const pending = sortCatalog(items, 'name-asc', controller.signal); controller.abort()
  await expect(pending).rejects.toThrow('cancelled')
})
it('ranks rated titles first, retains provider order for ties and unrated titles, and permits cancellation', async () => {
  const items = [entry('No rating A'), { ...entry('Seven'), rating: 7 }, { ...entry('Nine A'), rating: 9 }, entry('No rating B'), { ...entry('Nine B'), rating: 9 }]
  const original = [...items], controller = new AbortController()
  expect((await sortCatalog(items, 'rating', controller.signal)).map(item => item.name)).toEqual(['Nine A', 'Nine B', 'Seven', 'No rating A', 'No rating B'])
  expect(items).toEqual(original)
  const pending = sortCatalog(Array.from({ length: 100000 }, (_, i) => ({ ...entry(`Movie ${i}`), rating: i % 10 })), 'rating', controller.signal)
  controller.abort(); await expect(pending).rejects.toThrow('cancelled')
})
