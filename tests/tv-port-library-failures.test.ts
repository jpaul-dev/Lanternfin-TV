// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { channelId, libraryId, TVLibrary } from '../tv-app/library'
import { MemoryStore } from '../tv-app/backup'
import { referenceChannel } from '../tv-app/provider-reference'

const source = { kind: 'xtream' as const, url: 'https://example.test', username: 'u', password: 'p' }
const movie = (id: number) => referenceChannel(source, { mediaKind: 'movie', providerId: String(id), extension: 'mp4', name: `Movie ${id}`, group: 'Movies' })
const series = referenceChannel(source, { mediaKind: 'series', providerId: '3', extension: 'mp4', name: 'Series', group: 'Series' })
function fixture() {
  const storage = new MemoryStore(), library = new TVLibrary(storage, source)
  library.toggleFavorite(movie(1)); library.record(movie(1), 600, 600, true)
  library.toggleWatchlist(movie(2)); library.record(movie(2), 100, 600); library.setSeason(series, 'Season 1')
  return { storage, library }
}
const actions: [string, (library: TVLibrary) => void][] = [
  ['add favorite', library => { library.toggleFavorite(movie(2)) }],
  ['remove favorite', library => { library.toggleFavorite(movie(1)) }],
  ['mark watched', library => library.markWatched(movie(2), true)],
  ['mark unwatched', library => library.markWatched(movie(1), false)],
  ['remove recent', library => library.removeRecent(movie(1))],
  ['clear history', library => library.clearHistory()],
  ['select season', library => library.setSeason(series, 'Season 2')],
  ['merge library', library => { const incoming = new TVLibrary(null, source); incoming.toggleFavorite(movie(4)); library.merge(incoming) }],
]
afterEach(() => vi.restoreAllMocks())

it.each(actions)('rolls back %s completely on quota failure and permits a successful retry', (_name, change) => {
  const { storage, library } = fixture(), before = library.snapshot()
  vi.spyOn(storage, 'setItem').mockImplementationOnce(() => { throw new DOMException('Full', 'QuotaExceededError') })
  expect(() => change(library)).toThrow()
  expect(library.snapshot()).toEqual(before)
  expect(new TVLibrary(storage, source).snapshot()).toEqual(before)
  change(library)
  expect(library.snapshot()).not.toEqual(before)
  expect(new TVLibrary(storage, source).snapshot()).toEqual(library.snapshot())
})

it.each([...actions, ['record progress', (library: TVLibrary) => library.record(movie(2), 200, 600)], ['reattach storage', (library: TVLibrary, storage?: Storage) => library.setStorage(storage!)] ] as [string, (library: TVLibrary, storage?: Storage) => void][])('rejects stale %s without overwriting newer activity', (_name, change) => {
  const { storage, library } = fixture(), before = library.snapshot()
  const other = new TVLibrary(storage, source); other.toggleFavorite(movie(5))
  const latest = other.snapshot()
  expect(() => change(library, storage)).toThrow('another app window')
  expect(library.snapshot()).toEqual(before)
  expect(new TVLibrary(storage, source).snapshot()).toEqual(latest)
})

it('keeps unsaved progress for this session and persists it when storage recovers', () => {
  const { storage, library } = fixture(), before = library.snapshot()
  vi.spyOn(storage, 'setItem').mockImplementationOnce(() => { throw new Error('quota') })
  expect(() => library.record(movie(2), 210, 600)).toThrow('session')
  expect(library.lastPlayed(movie(2))?.position).toBe(210)
  expect(new TVLibrary(storage, source).snapshot()).toEqual(before)
  library.record(movie(2), 220, 600)
  expect(new TVLibrary(storage, source).lastPlayed(movie(2))?.position).toBe(220)
})

it('keeps a failed Remember attachment session-only and rejects a conflicting destination', () => {
  const storage = new MemoryStore(), library = new TVLibrary(null, source)
  library.record(movie(1), 100, 600)
  const write = vi.spyOn(storage, 'setItem').mockImplementationOnce(() => { throw new Error('quota') })
  expect(() => library.setStorage(storage)).toThrow()
  expect(library.persistent).toBe(false)
  library.record(movie(1), 120, 600); expect(write).toHaveBeenCalledOnce()
  library.setStorage(storage); expect(library.persistent).toBe(true)
  expect(new TVLibrary(storage, source).lastPlayed(movie(1))?.position).toBe(120)
  const otherStore = new MemoryStore(), other = new TVLibrary(otherStore, source)
  other.toggleFavorite(movie(9)); const before = other.snapshot()
  expect(() => library.setStorage(otherStore)).toThrow('another app window')
  expect(new TVLibrary(otherStore, source).snapshot()).toEqual(before)
  library.record(movie(1), 130, 600)
  expect(new TVLibrary(storage, source).lastPlayed(movie(1))?.position).toBe(130)
})

it('detaches immediately when storage is inaccessible and never recreates forgotten records', () => {
  const { storage, library } = fixture()
  vi.spyOn(storage, 'getItem').mockImplementation(() => { throw new Error('denied') })
  const write = vi.spyOn(storage, 'setItem')
  library.setStorage(null); storage.clear(); library.record(movie(2), 180, 600)
  expect(library.persistent).toBe(false); expect(write).not.toHaveBeenCalled(); expect(storage.length).toBe(0)
})

it('a rolled-back favorite change does not invalidate an earlier cleanup undo', () => {
  const { storage, library } = fixture(), before = library.snapshot(), undo = library.clearAreas(['favorites'])
  vi.spyOn(storage, 'setItem').mockImplementationOnce(() => { throw new Error('quota') })
  expect(() => library.toggleFavorite(movie(5))).toThrow()
  undo(); expect(library.snapshot()).toEqual(before)
})

it('keeps the original catalog references when a combined library exceeds its serialized budget', () => {
  const storage = new MemoryStore(), incomingStore = new MemoryStore()
  const key = 'lanternfin.tv.library.v1.' + libraryId(JSON.stringify(source))
  const snapshot = (offset: number, area: 'favorites' | 'watchlist') => {
    const value = new TVLibrary(null, source).snapshot()
    value.references = Array.from({ length: 2000 }, (_, index) => ({
      providerId: String(index + offset).padStart(80, 'x'), mediaKind: 'movie' as const, extension: 'mp4',
      name: 'N'.repeat(200), group: 'G'.repeat(100), year: '2026', rating: 9.5, addedAt: 1791000000000, durationSeconds: 5400,
    }))
    value[area] = value.references.map(reference => channelId(referenceChannel(source, reference)))
    return value
  }
  const current = snapshot(0, 'favorites'), incoming = snapshot(2000, 'watchlist')
  expect(JSON.stringify(current).length).toBeLessThan(2 * 1024 * 1024)
  expect(JSON.stringify(incoming).length).toBeLessThan(2 * 1024 * 1024)
  storage.setItem(key, JSON.stringify(current)); incomingStore.setItem(key, JSON.stringify(incoming))
  const library = new TVLibrary(storage, source), other = new TVLibrary(incomingStore, source), before = library.snapshot()
  expect(library.bookmarkedChannels()).toHaveLength(2000); expect(other.bookmarkedChannels()).toHaveLength(2000)
  expect(() => library.merge(other)).toThrow('previous library was kept')
  expect(library.snapshot()).toEqual(before); expect(new TVLibrary(storage, source).snapshot()).toEqual(before)
})

it('detached session activity retains its stored baseline and cannot overwrite subsequent external changes', () => {
  const { storage, library } = fixture()
  library.setStorage(null); library.record(movie(2), 180, 600); library.setStorage(storage)
  expect(new TVLibrary(storage, source).lastPlayed(movie(2))?.position).toBe(180)
  library.setStorage(null); library.record(movie(2), 220, 600)
  const other = new TVLibrary(storage, source); other.toggleFavorite(movie(7))
  expect(() => library.setStorage(storage)).toThrow('another app window')
  expect(library.persistent).toBe(false); expect(library.lastPlayed(movie(2))?.position).toBe(220)
  expect(new TVLibrary(storage, source).snapshot()).toEqual(other.snapshot())
})
