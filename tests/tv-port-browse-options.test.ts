import { expect, it, vi } from 'vitest'
import { cloneBrowseOptions, DEFAULT_BROWSE_CHOICE, readBrowseOptions, type BrowseChoice } from '../tv-app/browse-options'
import { TVLibrary } from '../tv-app/library'
import { MemoryStore, createBackup, restoreBackup } from '../tv-app/backup'
import { rememberProfile } from '../tv-app/profiles'

const source = { kind: 'playlist' as const, url: 'https://example.com/private-list', username: '', password: '' }
const choice: BrowseChoice = { sort: 'rating', watched: 'unwatched', language: 'FR', media: 'movie' }
const movie = { name: 'Movie', group: 'Movies', url: 'https://example.com/movie.mp4', mediaKind: 'movie' as const }

it('reads only bounded known options and never retains a query or other arbitrary fields', () => {
  const parsed = readBrowseOptions({ movie: { ...choice, query: 'private search', category: 'private group' } })!
  expect(parsed).toEqual({ movie: choice })
  for (const invalid of [null, [], { live: choice }, { movie: [] }, { movie: { ...choice, sort: 'anything' } }, { movie: { ...choice, watched: 'yes' } }, { movie: { ...choice, media: 'episode' } }, { movie: { ...choice, language: '__proto__' } }, { movie: { ...choice, language: 'f'.repeat(100) } }, JSON.parse('{"__proto__":{}}')]) expect(readBrowseOptions(invalid)).toBeUndefined()
  const copy = cloneBrowseOptions(parsed); copy.movie!.sort = 'provider'; expect(parsed.movie).toEqual(choice)
  expect(readBrowseOptions({ search: { ...choice, language: 'untagged' } })?.search?.language).toBe('untagged')
})
it('restores independent section choices per remembered source without storing source secrets', () => {
  const storage = new MemoryStore(), library = new TVLibrary(storage, source)
  library.setBrowseChoice('movie', choice); library.setBrowseChoice('series', { ...choice, sort: 'name-desc', language: '' })
  const restored = new TVLibrary(storage, source)
  expect(restored.browseChoice('movie')).toEqual(choice); expect(restored.browseChoice('series').sort).toBe('name-desc')
  expect(restored.browseChoice('favorites')).toEqual(DEFAULT_BROWSE_CHOICE)
  expect(new TVLibrary(storage, { ...source, url: 'https://other.example/list' }).browseChoice('movie')).toEqual(DEFAULT_BROWSE_CHOICE)
  const raw = storage.getItem(storage.key(0)!)!; expect(raw).not.toContain('private-list'); expect(raw).not.toContain('example.com')
  restored.browseChoice('movie').sort = 'provider'; restored.snapshot().browseOptions!.movie!.language = ''
  expect(restored.browseChoice('movie')).toEqual(choice)
  restored.setBrowseChoice('movie', { ...DEFAULT_BROWSE_CHOICE }); expect(new TVLibrary(storage, source).browseChoice('series').sort).toBe('name-desc')
})
it('keeps unsaved choices in memory and only persists when Remember is enabled', () => {
  const storage = new MemoryStore(), library = new TVLibrary(null, source)
  library.setBrowseChoice('search', choice); expect(storage.length).toBe(0)
  expect(new TVLibrary(null, source).browseChoice('search')).toEqual(DEFAULT_BROWSE_CHOICE)
  library.setStorage(storage); expect(new TVLibrary(storage, source).browseChoice('search')).toEqual(choice)
  library.setStorage(null); library.setBrowseChoice('search', { ...choice, sort: 'newest' })
  expect(new TVLibrary(storage, source).browseChoice('search')).toEqual(choice)
})
it('retains the previous library and choices on a failed write and rejects stale writers', () => {
  const storage = new MemoryStore(), library = new TVLibrary(storage, source)
  library.toggleFavorite(movie); library.setBrowseChoice('movie', choice)
  const before = library.snapshot(), write = vi.spyOn(storage, 'setItem')
  write.mockImplementationOnce(() => { throw new Error('quota') })
  expect(() => library.setBrowseChoice('movie', { ...choice, sort: 'newest' })).toThrow('Previous saved choices were kept')
  expect(library.snapshot()).toEqual(before); expect(new TVLibrary(storage, source).snapshot()).toEqual(before)
  new TVLibrary(storage, source).setBrowseChoice('series', choice)
  expect(() => library.setBrowseChoice('movie', { ...DEFAULT_BROWSE_CHOICE })).toThrow('another app window')
  expect(new TVLibrary(storage, source).browseChoice('series')).toEqual(choice)
})
it('preserves browsing options during library cleanup and prevents Undo overwriting a later choice', () => {
  const library = new TVLibrary(new MemoryStore(), source)
  library.toggleFavorite(movie); library.setBrowseChoice('movie', choice)
  const undo = library.clearAreas(['favorites']); expect(library.browseChoice('movie')).toEqual(choice)
  undo(); expect(library.isFavorite(movie)).toBe(true); expect(library.browseChoice('movie')).toEqual(choice)
  const staleUndo = library.clearAreas(['favorites']); library.setBrowseChoice('movie', { ...choice, sort: 'newest' })
  expect(() => staleUndo()).toThrow('changed after clearing'); expect(library.browseChoice('movie').sort).toBe('newest')
})
it('merges backup choices per section while keeping existing choices and respecting the library switch', () => {
  const original = new MemoryStore(); rememberProfile(original, source, 'Test')
  const library = new TVLibrary(original, source); library.setBrowseChoice('movie', choice); library.setBrowseChoice('series', choice)
  const backup = createBackup(original), target = new MemoryStore(); rememberProfile(target, source, 'Existing')
  new TVLibrary(target, source).setBrowseChoice('movie', { ...DEFAULT_BROWSE_CHOICE })
  restoreBackup(target, backup, { library: false, preferences: true })
  expect(new TVLibrary(target, source).browseChoice('series')).toEqual(DEFAULT_BROWSE_CHOICE)
  restoreBackup(target, backup, { library: true, preferences: false })
  const restored = new TVLibrary(target, source)
  expect(restored.browseChoice('movie')).toEqual(DEFAULT_BROWSE_CHOICE); expect(restored.browseChoice('series')).toEqual(choice)
})
it('accepts old backups and rejects malformed options before any restore writes', () => {
  const original = new MemoryStore(); rememberProfile(original, source, 'Test')
  const backup = createBackup(original), target = new MemoryStore(), write = vi.spyOn(target, 'setItem')
  backup.profiles[0].library.browseOptions = { movie: { ...choice, language: 'unknown' } }
  expect(() => restoreBackup(target, backup, { library: true, preferences: false })).toThrow('supported'); expect(write).not.toHaveBeenCalled()
  delete backup.profiles[0].library.browseOptions
  restoreBackup(target, backup, { library: true, preferences: false })
  expect(new TVLibrary(target, source).browseChoice('movie')).toEqual(DEFAULT_BROWSE_CHOICE)
})
