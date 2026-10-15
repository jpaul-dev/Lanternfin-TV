// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { categoryVisibility, readCategoryRules, MAX_CATEGORY_RULES } from '../tv-app/category-rules'
import { TVLibrary } from '../tv-app/library'
import { MemoryStore, createBackup, restoreBackup, validateBackup } from '../tv-app/backup'
import { rememberProfile } from '../tv-app/profiles'
import { homeRows } from '../tv-app/presentation'
import { playlistCategories } from '../tv-app/category-browser'
import { LiveQueue } from '../tv-app/playback-queue'
import type { Channel, Source } from '../tv-app/catalog'

const source: Source = { kind: 'playlist', url: 'https://example.test/list.m3u', username: '', password: '' }
const provider: Source = { ...source, kind: 'xtream', username: 'user', password: 'secret' }
const channel: Channel = { name: 'Channel', url: 'https://example.test/live.m3u8', group: 'Sports', mediaKind: 'live', categoryId: '1' }
beforeEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })

it('scopes rules by kind and source, resolves provider IDs, and treats empty selections as all', () => {
  const library = new TVLibrary(null, source)
  library.setCategoryRules({ live: { mode: 'hide', ids: ['Sports'] }, movie: { mode: 'select', ids: ['Films'] } })
  expect(library.isVisible(channel)).toBe(false)
  expect(library.isVisible({ ...channel, mediaKind: 'series' })).toBe(true)
  expect(library.isVisible({ ...channel, mediaKind: 'movie' })).toBe(false)
  expect(library.isVisible({ ...channel, mediaKind: 'movie', group: 'Films' })).toBe(true)
  expect(categoryVisibility(provider, { live: { mode: 'hide', ids: ['1'] } }).channel(channel)).toBe(false)
  expect(categoryVisibility(provider, { live: { mode: 'select', ids: [] } }).channel(channel)).toBe(true)
  expect(categoryVisibility(provider, { series: { mode: 'hide', ids: ['1'] } }).channel({ ...channel, mediaKind: 'episode' })).toBe(false)
  expect(new TVLibrary(null, source).isVisible(channel)).toBe(true)
  const hidden = categoryVisibility(provider, { live: { mode: 'hide', ids: ['1'] } })
  expect(hidden.channel({ ...channel, categoryId: undefined })).toBe(false)
  expect(hidden.channel(channel, new Set(['1','2']))).toBe(true)
  expect(hidden.channel(channel, new Set(['1']))).toBe(false)
})

it('validates bounded rules without accepting duplicate IDs, unknown sections or unsafe provider IDs', () => {
  for (const value of [null, [], { all: { mode: 'hide', ids: [] } }, { live: { mode: 'invalid', ids: [] } }, { live: { mode: 'hide', ids: ['1','1'] } }, { live: { mode: 'hide', ids: [''] } }, { live: { mode: 'hide', ids: ['a\n'] } }]) expect(readCategoryRules(value, source)).toBeUndefined()
  expect(readCategoryRules({ live: { mode: 'hide', ids: ['../secret'] } }, provider)).toBeUndefined()
  const ids = Array.from({ length: MAX_CATEGORY_RULES }, (_, n) => String(n))
  expect(readCategoryRules({ live: { mode: 'select', ids } }, provider)?.live?.ids).toHaveLength(MAX_CATEGORY_RULES)
  expect(readCategoryRules({ live: { mode: 'select', ids }, movie: { mode: 'hide', ids: ['1'] } }, provider)).toBeUndefined()
})

it('saves rules transactionally, isolates copies, and rejects stale writers', () => {
  const store = new MemoryStore(), library = new TVLibrary(store, source), stale = new TVLibrary(store, source)
  library.toggleFavorite(channel); library.record(channel, 80, 600)
  const rules = { live: { mode: 'hide' as const, ids: ['Sports'] } }; library.setCategoryRules(rules); rules.live.ids.length = 0
  const read = library.categoryRules; read.live!.ids.length = 0
  const loaded = new TVLibrary(store, source)
  expect(loaded.isVisible(channel)).toBe(false); expect(loaded.isFavorite(channel)).toBe(true); expect(loaded.lastPlayed(channel)).toBeDefined()
  expect(() => stale.setCategoryRules({})).toThrow('another app window')
  const raw = store.getItem(store.key(0)!)
  vi.spyOn(store, 'setItem').mockImplementation(() => { throw new Error('full') })
  expect(() => library.setCategoryRules({ live: { mode: 'hide', ids: [] } })).toThrow('storage')
  expect(library.isVisible(channel)).toBe(false); expect(store.getItem(store.key(0)!)).toBe(raw)
})

it('restores backup rules, keeps explicit newer show-all choices, and rejects invalid backup data', () => {
  const store = new MemoryStore(); rememberProfile(store, source, 'Example')
  const library = new TVLibrary(store, source); library.setCategoryRules({ live: { mode: 'hide', ids: ['Sports'] } })
  const backup = createBackup(store), target = new MemoryStore()
  restoreBackup(target, backup, { library: true, preferences: false })
  expect(new TVLibrary(target, source).isVisible(channel)).toBe(false)
  const newer = new TVLibrary(target, source); newer.setCategoryRules({ live: { mode: 'hide', ids: [] } })
  restoreBackup(target, backup, { library: true, preferences: false })
  expect(new TVLibrary(target, source).isVisible(channel)).toBe(true)
  backup.profiles[0].library.categoryRules!.live!.ids.push('Sports')
  expect(() => validateBackup(backup)).toThrow('supported')
})

it('rolls back an over-limit merged library including its rules and favorites', () => {
  const a = new TVLibrary(null, source), b = new TVLibrary(null, source)
  a.setCategoryRules({ live: { mode: 'hide', ids: Array.from({ length: MAX_CATEGORY_RULES }, (_, n) => String(n)) } })
  b.setCategoryRules({ movie: { mode: 'select', ids: ['Movies'] } }); b.toggleFavorite(channel)
  const before = a.snapshot(); expect(() => a.merge(b)).toThrow('10,000'); expect(a.snapshot()).toEqual(before)
})

it('keeps hidden titles out of every Home row, group directory, and live tuning queue without deleting favorites', async () => {
  const library = new TVLibrary(null, source)
  const hiddenMovie = { ...channel, mediaKind: 'movie' as const, name: 'Hidden film', url: 'https://example.test/1.mp4' }
  const visible = { ...channel, name: 'Visible channel', group: 'News', url: 'https://example.test/2.m3u8' }
  library.toggleFavorite(channel); library.toggleWatchlist(hiddenMovie); library.record(hiddenMovie, 120, 600)
  library.setCategoryRules({ live: { mode: 'hide', ids: ['Sports'] }, movie: { mode: 'hide', ids: ['Sports'] } })
  const pool = [channel, hiddenMovie, visible], root = document.createElement('div'); document.body.append(root)
  await homeRows(root, pool, library, () => {}, 'en')
  expect(root.textContent).toContain('Visible channel'); expect(root.textContent).not.toContain('Hidden film')
  expect(root.querySelectorAll('.channel')).toHaveLength(1)
  expect(await playlistCategories(pool, new AbortController().signal, undefined, item => library.isVisible(item))).toEqual([{ id: 'News', name: 'News' }])
  const queue = new LiveQueue(); queue.reset(pool, visible, item => library.isVisible(item)); expect(queue.length).toBe(1); expect(queue.step(1)).toBe(visible)
  expect(library.isFavorite(channel)).toBe(true); expect(library.isWatchlisted(hiddenMovie)).toBe(true)
})
