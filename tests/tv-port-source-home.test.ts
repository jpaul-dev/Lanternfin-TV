// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { TVLibrary } from '../tv-app/library'
import { createBackup, MemoryStore, restoreBackup, validateBackup } from '../tv-app/backup'
import { rememberProfile } from '../tv-app/profiles'
import { readSourceHome, findHomeCategories, type SourceHome } from '../tv-app/source-home'
import { homeLayoutUI } from '../tv-app/home-layout'
import { homeRows, cardChannel, cardVersions } from '../tv-app/presentation'
import { validateSource, type Channel } from '../tv-app/catalog'

const source = validateSource({ kind: 'playlist', url: 'https://example.com/a.m3u', username: '', password: '' })
const provider = validateSource({ ...source, kind: 'xtream', url: 'https://provider.example', username: 'private-account', password: 'private-password' })
const layout: SourceHome = { rows: ['category-0', 'movies'], categories: [{ id: 'category-0', title: 'Friday night', kind: 'movie', group: 'Drama' }] }
const movie = (id: number, group = 'Drama'): Channel => ({ name: `Movie ${id}`, url: `https://example.com/${id}.mp4`, group, mediaKind: 'movie' })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('validates source-specific category identities, slots, titles and duplicate limits', () => {
  expect(readSourceHome(layout, source)).toEqual(layout)
  expect(readSourceHome(layout, provider)).toBeUndefined()
  const valid = { rows: ['category-7'], categories: [{ id: 'category-7', kind: 'movie', categoryId: '23', title: 'Drama', url: 'private' }] }
  expect(readSourceHome(valid, provider)?.categories[0]).not.toHaveProperty('url')
  for (const bad of [
    { ...layout, rows: ['category-1'] }, { ...layout, rows: ['movies', 'movies'] },
    { ...layout, categories: [layout.categories[0], { ...layout.categories[0], id: 'category-1' }] },
    { ...layout, categories: [{ ...layout.categories[0], id: ['category-0'] }] },
    { ...layout, categories: [{ ...layout.categories[0], id: 'category-8' }] },
    { ...layout, categories: [{ ...layout.categories[0], group: 'x'.repeat(101) }] },
    { ...layout, categories: [{ ...layout.categories[0], title: ' ' }] },
    { ...layout, categories: Array(9).fill(layout.categories[0]) },
  ]) expect(readSourceHome(bad, source)).toBeUndefined()
  expect(readSourceHome({ rows: [], categories: [] }, source)).toEqual({ rows: [], categories: [] })
})

it('persists isolated layouts, copies drafts, preserves them through cleanup and rolls back failed saves', () => {
  const storage = new MemoryStore(), library = new TVLibrary(storage, source)
  library.setHomeLayout(layout)
  expect(new TVLibrary(storage, source).homeLayout).toEqual(layout)
  expect(new TVLibrary(storage, { ...source, url: 'https://example.com/b.m3u' }).homeLayout).toBeUndefined()
  const copy = library.homeLayout!; copy.categories[0].title = 'Changed'; copy.rows.length = 0
  expect(library.homeLayout).toEqual(layout)
  library.toggleFavorite(movie(1)); const undo = library.clearAreas(['favorites']); expect(library.homeLayout).toEqual(layout); undo()
  const write = vi.spyOn(storage, 'setItem').mockImplementationOnce(() => { throw new Error('quota') })
  expect(() => library.setHomeLayout({ rows: [], categories: [] })).toThrow('previous layout is unchanged')
  expect(library.homeLayout).toEqual(layout); write.mockRestore()
  new TVLibrary(storage, source).setHomeLayout({ rows: [], categories: [] })
  expect(() => library.setHomeLayout(layout)).toThrow('another app window')
})

it('transfers layouts through library import while keeping current layouts and rejecting malformed backups', () => {
  const origin = new MemoryStore(); rememberProfile(origin, source, 'Example'); new TVLibrary(origin, source).setHomeLayout(layout)
  const backup = createBackup(origin), target = new MemoryStore()
  restoreBackup(target, backup, { library: false, preferences: true }); expect(new TVLibrary(target, source).homeLayout).toBeUndefined()
  restoreBackup(target, backup, { library: true, preferences: false }); expect(new TVLibrary(target, source).homeLayout).toEqual(layout)
  new TVLibrary(target, source).setHomeLayout({ rows: ['live'], categories: [] })
  restoreBackup(target, backup, { library: true, preferences: false }); expect(new TVLibrary(target, source).homeLayout?.rows).toEqual(['live'])
  const legacy = JSON.parse(JSON.stringify(backup)); delete legacy.profiles[0].library.homeLayout
  expect(validateBackup(legacy).profiles[0].library.homeLayout).toBeUndefined()
  const damaged = JSON.parse(JSON.stringify(backup)); damaged.profiles[0].library.homeLayout.rows.push('category-5')
  expect(() => restoreBackup(target, damaged, { library: true, preferences: true })).toThrow('supported')
  expect(new TVLibrary(target, source).homeLayout?.rows).toEqual(['live'])
})

it('bounds category choices, deduplicates playlist groups and searches late groups cooperatively', async () => {
  const channels = Array.from({ length: 2000 }, (_, id) => movie(id, `Category ${id}`)), signal = new AbortController().signal
  const result = await findHomeCategories(source, [...channels, ...channels], {}, 'movie', '', signal)
  expect(result.choices).toHaveLength(100); expect(result.more).toBe(true)
  expect((await findHomeCategories(source, channels, {}, 'movie', '1999', signal)).choices).toEqual([{ kind: 'movie', title: 'Category 1999', group: 'Category 1999' }])
  expect((await findHomeCategories(source, [movie(1), movie(2)], {}, 'movie', '', signal)).choices).toHaveLength(1)
  expect((await findHomeCategories(provider, [], { movie: [{ id: '1', name: 'Same' }, { id: '2', name: 'Same' }] }, 'movie', '', signal)).choices).toHaveLength(2)
  let time = 0; vi.spyOn(performance, 'now').mockImplementation(() => time += 20)
  const abort = new AbortController(), pending = findHomeCategories(source, channels, {}, 'movie', 'last', abort.signal); abort.abort()
  await expect(pending).rejects.toThrow('canceled')
})

it('edits custom rows as a draft with duplicate protection, hide/reorder/remove and cancel', async () => {
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  const root = document.getElementById('layout')!, save = vi.fn(), close = vi.fn()
  const ui = homeLayoutUI(root, save, close, async () => ({ choices: [{ kind: 'movie', title: 'Drama', group: 'Drama' }], more: false }))
  const el = <T extends HTMLElement = HTMLButtonElement>(id: string) => root.querySelector<T>(`#layout-${id}`)!
  ui.open(['movies']); await Promise.resolve()
  el<HTMLInputElement>('title').value = '<b>My movies</b>'; el('add').click()
  expect(root.querySelector('[data-row="category-0"] label')?.textContent).toBe('<b>My movies</b> · Movies')
  expect(root.querySelector('b')).toBeNull(); expect(save).not.toHaveBeenCalled()
  el('add').click(); expect(el('status').textContent).toContain('already has a row')
  root.querySelector<HTMLInputElement>('[data-row="category-0"] input')!.click()
  el('save').click(); expect(save.mock.calls[0][0]).toMatchObject({ rows: ['movies'], categories: [{ title: '<b>My movies</b>' }] })
  ui.open(save.mock.calls[0][0]); root.querySelector<HTMLButtonElement>('[data-row="category-0"] [data-action="remove"]')!.click()
  el('back').click(); expect(save).toHaveBeenCalledOnce()
  ui.open(layout); root.querySelector<HTMLButtonElement>('[data-row="category-0"] [data-action="down"]')!.click(); el('save').click()
  expect(save.mock.calls[1][0].rows).toEqual(['movies', 'category-0'])
  ui.close()
})

it('cancels stale category search results when the editor closes', async () => {
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  let complete!: (value: any) => void, signal!: AbortSignal
  const root = document.getElementById('layout')!, ui = homeLayoutUI(root, () => {}, () => {}, (_kind, _query, next) => { signal = next; return new Promise(resolve => { complete = resolve }) })
  ui.open([]); ui.close(); expect(signal.aborted).toBe(true)
  complete({ choices: [{ kind: 'movie', title: 'Late', group: 'Late' }], more: false }); await Promise.resolve()
  expect(root.querySelector('#layout-category')?.children).toHaveLength(0)
})

it('keeps category membership and language grouping local to each row, with empty rows still actionable', async () => {
  const root = document.createElement('div'); document.body.replaceChildren(root)
  const french = { ...movie(1), name: 'FR - Film (2026)' }, english = { ...movie(2, 'Other'), name: 'EN - Film (2026)' }, open = vi.fn()
  await homeRows(root, [french, french, english], undefined, () => {}, 'en', ['category-0'], [{ category: layout.categories[0], open }])
  const card = root.querySelector<HTMLButtonElement>('.channel')!
  expect(cardChannel(card)).toBe(french); expect(cardVersions(card)).toBeUndefined(); expect(root.querySelectorAll('.channel')).toHaveLength(1)
  root.querySelector<HTMLButtonElement>('[data-home-action="open"]')!.click(); expect(open).toHaveBeenCalledOnce()
  const first = { id: 'category-0' as const, kind: 'movie' as const, title: 'Same', categoryId: '1' }, second = { ...first, id: 'category-1' as const, categoryId: '2' }
  await homeRows(root, [french, english], undefined, () => {}, undefined, ['category-0', 'category-1'], [{ category: first, channels: [french], open }, { category: second, channels: [english], open }])
  expect(cardChannel(root.querySelector('[data-row="category-1"] .channel')!)).toBe(english)
  const action = root.querySelector<HTMLButtonElement>('[data-row="category-1"] [data-home-action="open"]')!; action.focus()
  await homeRows(root, [], undefined, () => {}, undefined, ['category-1'], [{ category: second, open }])
  expect(root.textContent).toContain('No titles loaded'); expect(document.activeElement).toBe(root.querySelector('[data-home-action="open"]'))
})
