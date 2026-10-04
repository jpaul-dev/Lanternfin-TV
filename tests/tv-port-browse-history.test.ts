// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { BrowseHistory, browseFocus, resolveBrowseVisit, type BrowseVisit } from '../tv-app/browse-history'
import { channelId } from '../tv-app/library'
const source = 'a'.repeat(16), other = 'b'.repeat(16)
const visit: BrowseVisit = { query: 'Film', group: 'Drama', category: { id: '2', name: 'Drama' }, categories: { query: 'Dra', page: 2 }, page: 3, focus: { kind: 'title', id: '1'.repeat(16) }, scroll: 900, gridScroll: 300, categoryScroll: 100, signature: 'options' }
const items = (length: number) => Array.from({ length }, (_, i) => ({ name: `Film ${i}`, url: `https://example.com/${i}.mp4`, group: 'Drama' }))

it('keeps source/section positions independent, copies fields and forgets without writing storage', () => {
  const history = new BrowseHistory(), before = localStorage.length
  history.remember(source, 'movie', visit); history.remember(source, 'series', { ...visit, query: 'Saga' }); history.remember(other, 'movie', { ...visit, page: 1 })
  const copy = history.recall(source, 'movie')!; copy.category!.id = '3'; copy.focus!.id = '2'.repeat(16); copy.query = 'Changed'; copy.categories!.page = 5
  expect(history.recall(source, 'movie')).toEqual(visit); expect(history.recall(source, 'series')?.query).toBe('Saga'); expect(history.recall(other, 'movie')?.page).toBe(1)
  history.forget(source); expect(history.recall(source, 'movie')).toBeUndefined(); expect(history.recall(other, 'movie')).toBeDefined()
  history.forget(); expect(history.recall(other, 'movie')).toBeUndefined(); expect(localStorage.length).toBe(before)
})
it('bounds retained sources and rejects malformed or oversized positions without replacing the prior visit', () => {
  const history = new BrowseHistory(); history.remember(source, 'movie', visit)
  for (const changed of [{ query: 'x'.repeat(513) }, { group: 'x'.repeat(201) }, { signature: 'x'.repeat(257) }, { page: -1 }, { page: 1.5 }, { scroll: Infinity }, { gridScroll: -1 }, { category: { id: '../2', name: 'Bad' } }, { focus: { kind: 'title', id: 'unsafe' } }, { focus: { kind: 'control', id: 'source-url' } }]) history.remember(source, 'movie', { ...visit, ...changed } as BrowseVisit)
  expect(history.recall(source, 'movie')).toEqual(visit)
  for (let i = 0; i < 19; i++) history.remember(i.toString(16).padStart(16, '0'), 'movie', visit)
  history.recall(source, 'movie'); history.remember(other, 'movie', visit)
  expect(history.recall(source, 'movie')).toBeDefined(); expect(history.recall('0'.repeat(16), 'movie')).toBeUndefined()
})
it('captures only known browse controls and bounded category/title identifiers', () => {
  const button = document.createElement('button'); button.dataset.channel = 'f'.repeat(16)
  expect(browseFocus(button)).toEqual({ kind: 'title', id: 'f'.repeat(16) })
  delete button.dataset.channel; button.dataset.category = 'Drama'; expect(browseFocus(button)).toEqual({ kind: 'category', id: 'Drama' })
  delete button.dataset.category; button.id = 'search'; expect(browseFocus(button)).toEqual({ kind: 'control', id: 'search' })
  button.id = 'source-url'; expect(browseFocus(button)).toBeUndefined()
})
it('follows the focused title to its new page and clamps a removed title after loading completes', async () => {
  const pool = items(80), anchor = { ...visit, page: 3, focus: { kind: 'title' as const, id: channelId(pool[30]) } }, signal = new AbortController().signal
  expect(await resolveBrowseVisit(pool, anchor, 24, true, signal)).toEqual({ page: 1, pending: false, missing: false, moved: true })
  expect(await resolveBrowseVisit(pool.slice(0, 10), anchor, 24, false, signal)).toMatchObject({ page: 0, pending: true, missing: true })
  expect(await resolveBrowseVisit(pool.slice(0, 10), anchor, 24, true, signal)).toMatchObject({ page: 0, pending: false, missing: true })
  expect(await resolveBrowseVisit(pool, { ...visit, page: 9, focus: undefined }, 24, true, signal)).toMatchObject({ page: 3, pending: false })
})
it('lets navigation cancel a large anchor lookup before it can restore an obsolete screen', async () => {
  const controller = new AbortController(), pending = resolveBrowseVisit(items(100000), visit, 24, true, controller.signal)
  controller.abort(); await expect(pending).rejects.toThrow('cancelled')
})
