// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { TVLibrary } from '../tv-app/library'
import { MemoryStore } from '../tv-app/backup'
import { referenceChannel } from '../tv-app/provider-reference'
import { libraryUI } from '../tv-app/library-ui'

const source = { kind: 'xtream' as const, url: 'https://example.com', username: 'test', password: 'test' }
const movie = referenceChannel(source, { mediaKind: 'movie', providerId: '1', extension: 'mp4', name: 'Test movie', group: 'Test' })
const series = referenceChannel(source, { mediaKind: 'series', providerId: '2', extension: 'mp4', name: 'Test series', group: 'Test' })
function fixture() {
  const storage = new MemoryStore(), library = new TVLibrary(storage, source)
  library.toggleFavorite(movie); library.record(movie, 100, 500); library.markWatched(movie, true); library.setSeason(series, 'Season 2')
  return { storage, library }
}
afterEach(() => vi.restoreAllMocks())
it('clears selected data with one write, preserves other areas and restores a complete snapshot on undo', () => {
  const { storage, library } = fixture(), before = library.snapshot(), write = vi.spyOn(storage, 'setItem')
  const undo = library.clearAreas(['favorites', 'history'])
  expect(write).toHaveBeenCalledOnce(); expect(library.counts()).toEqual({ favorites: 0, history: 0, watched: 1, seasons: 1 })
  expect(library.bookmarkedChannels()).toHaveLength(0); expect(new TVLibrary(storage, source).counts()).toEqual(library.counts())
  undo(); expect(library.snapshot()).toEqual(before); expect(new TVLibrary(storage, source).snapshot()).toEqual(before)
  expect(() => undo()).toThrow('changed after clearing')
})
it('clearing watched marks removes legacy completed flags and survives reload without losing history', () => {
  const { storage, library } = fixture(); library.record(movie, 500, 500, true)
  library.clearAreas(['watched']); expect(library.lastPlayed(movie)?.completed).toBeUndefined()
  const restored = new TVLibrary(storage, source); expect(restored.isWatched(movie)).toBe(false); expect(restored.recent.size).toBe(1)
})
it('preserves the original in-memory and stored library on a failed clear and supports retrying a failed undo', () => {
  const { storage, library } = fixture(), before = library.snapshot(), write = vi.spyOn(storage, 'setItem')
  write.mockImplementationOnce(() => { throw new Error('quota') })
  expect(() => library.clearAreas(['favorites', 'history', 'watched', 'seasons'])).toThrow('library was kept')
  expect(library.snapshot()).toEqual(before); expect(new TVLibrary(storage, source).snapshot()).toEqual(before)
  const undo = library.clearAreas(['favorites']), cleared = library.snapshot()
  write.mockImplementationOnce(() => { throw new Error('unavailable') }); expect(() => undo()).toThrow('could not undo')
  expect(library.snapshot()).toEqual(cleared); undo(); expect(library.snapshot()).toEqual(before)
})
it('never overwrites newer session or other-window activity during clear or undo', () => {
  const { storage, library } = fixture(), undo = library.clearAreas(['history'])
  library.record(movie, 200, 500); expect(() => undo()).toThrow('changed after clearing'); expect(library.lastPlayed(movie)?.position).toBe(200)
  const second = new TVLibrary(storage, source); second.toggleFavorite(series)
  expect(() => library.clearAreas(['favorites'])).toThrow('another app window'); expect(new TVLibrary(storage, source).isFavorite(series)).toBe(true)
  const latest = new TVLibrary(storage, source), undoLatest = latest.clearAreas(['favorites'])
  new TVLibrary(storage, source).record(movie, 250, 500); expect(() => undoLatest()).toThrow('another app window')
})
it('requires UI review, keeps cancellation inert, and discards undo when leaving the screen', () => {
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  const { library } = fixture(), changed = vi.fn(), root = document.getElementById('manage')!, ui = libraryUI(root, changed)
  const click = (id: string) => (root.querySelector(`#manage-${id}`) as HTMLButtonElement).click()
  ui.open(library, 'Test source'); expect(root.textContent).toContain('Test source')
  click('favorites'); click('apply'); expect(library.favorites.size).toBe(1)
  click('review'); expect(root.querySelector('#manage-summary')?.textContent).toContain('1 favorite marks')
  expect(document.activeElement?.id).toBe('manage-cancel'); click('cancel'); expect(changed).not.toHaveBeenCalled()
  click('review'); click('apply'); expect(library.favorites.size).toBe(0); expect(changed).toHaveBeenCalledOnce()
  click('undo'); expect(library.favorites.size).toBe(1)
  click('favorites'); click('review'); click('apply'); ui.close(); click('undo'); expect(library.favorites.size).toBe(0)
})
