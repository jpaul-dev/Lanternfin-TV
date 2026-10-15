// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { TVLibrary, channelId } from '../tv-app/library'
import { MemoryStore, createBackup, restoreBackup, validateBackup } from '../tv-app/backup'
import { rememberProfile } from '../tv-app/profiles'
import { referenceChannel } from '../tv-app/provider-reference'
import { validateSource } from '../tv-app/catalog'
import { homeRows } from '../tv-app/presentation'

const source = validateSource({ kind: 'xtream', url: 'https://provider.example', username: 'private-account', password: 'private-password' })
const movie = (id: number) => referenceChannel(source, { mediaKind: 'movie', providerId: String(id), name: `Movie ${id}`, group: 'Test', extension: 'mp4' })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('persists independent watchlist references without stream addresses and survives clearing other areas', () => {
  const storage = new MemoryStore(), library = new TVLibrary(storage, source), channel = movie(1)
  expect(library.toggleWatchlist(channel)).toBe(true)
  expect(library.isFavorite(channel)).toBe(false); expect(library.lastPlayed(channel)).toBeUndefined()
  const raw = storage.getItem(storage.key(0)!)!
  for (const secret of [source.url, source.username, source.password, channel.url]) expect(raw).not.toContain(secret)
  const reopened = new TVLibrary(storage, source)
  expect(reopened.isWatchlisted(channel)).toBe(true); expect(reopened.bookmarkedChannels()[0].url).toBe(channel.url)
  reopened.toggleFavorite(channel); reopened.record(channel, 0, 0, true)
  reopened.clearAreas(['favorites', 'history', 'watched'])
  expect(reopened.isWatchlisted(channel)).toBe(true); expect(reopened.bookmarkedChannels()).toHaveLength(1)
  const undo = reopened.clearAreas(['watchlist']); expect(reopened.bookmarkedChannels()).toHaveLength(0)
  undo(); expect(new TVLibrary(storage, source).isWatchlisted(channel)).toBe(true)
  expect(new TVLibrary(storage, { ...source, username: 'other-account' }).watchlist.size).toBe(0)
})

it('bounds the watchlist, rejects live entries and rolls back failed storage changes', () => {
  const storage = new MemoryStore(), library = new TVLibrary(storage, source)
  expect(() => library.toggleWatchlist({ ...movie(1), mediaKind: 'live' })).toThrow('movies and series')
  const write = vi.spyOn(storage, 'setItem').mockImplementationOnce(() => { throw new Error('quota') })
  expect(() => library.toggleWatchlist(movie(1))).toThrow('previous list was kept')
  expect(library.watchlist.size).toBe(0); expect(library.bookmarkedChannels()).toHaveLength(0)
  write.mockRestore()
  for (let i = 0; i < 2000; i++) library.watchlist.add(channelId(movie(i)))
  expect(() => library.toggleWatchlist(movie(2001))).toThrow('full')
  expect(library.toggleWatchlist(movie(1))).toBe(false)
  expect(library.toggleWatchlist(movie(2001))).toBe(true)
})

it('orders the home watchlist newest first without duplicate cards or changing saved choices', async () => {
  const library = new TVLibrary(null, source), first = movie(1), second = movie(2)
  library.toggleWatchlist(first); library.toggleWatchlist(second)
  const root = document.createElement('div'); document.body.replaceChildren(root)
  await homeRows(root, [first, first, second], library, () => {})
  const cards = root.querySelectorAll('[data-row="Watchlist"] button')
  expect(cards).toHaveLength(2); expect(cards[0].textContent).toContain('Movie 2')
  expect(library.watchlist.size).toBe(2)
})

it('merges watchlists in backups, accepts older snapshots, and rejects malformed watchlist data before writing', () => {
  const storage = new MemoryStore(); rememberProfile(storage, source, 'Test')
  new TVLibrary(storage, source).toggleWatchlist(movie(1))
  const backup = createBackup(storage), target = new MemoryStore()
  rememberProfile(target, source, 'Existing'); new TVLibrary(target, source).toggleWatchlist(movie(2))
  restoreBackup(target, backup, { library: true, preferences: false })
  expect(new TVLibrary(target, source).watchlist.size).toBe(2)
  const original = backup.profiles[0].library.watchlist
  backup.profiles[0].library.watchlist = [original[0], original[0]]
  expect(() => restoreBackup(target, backup, { library: true, preferences: false })).toThrow('supported')
  expect(new TVLibrary(target, source).watchlist.size).toBe(2)
  backup.profiles[0].library.watchlist = ['not-an-id']; expect(() => validateBackup(backup)).toThrow('supported')
  backup.profiles[0].library.watchlist = original
  const legacy = JSON.parse(JSON.stringify(backup)); delete legacy.profiles[0].library.watchlist; legacy.profiles[0].library.references = []
  expect(validateBackup(legacy).profiles[0].library.watchlist).toEqual([])
  const withoutLibrary = new MemoryStore(); restoreBackup(withoutLibrary, backup, { library: false, preferences: false })
  expect(new TVLibrary(withoutLibrary, source).watchlist.size).toBe(0)
})

it('adds from details, renders a home rail, and removes from the remote menu with an actionable empty state', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser')
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('#EXTM3U\n#EXTINF:-1 tvg-type="movie",Watchlist movie\nhttps://example.com/movie.mp4\n')))
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(0) }
  el<HTMLInputElement>('source-url').value = 'https://example.com/list.m3u'; el<HTMLInputElement>('remember').checked = true
  await click('connect'); await click('hero-play'); await click('detail-watchlist')
  expect(el('detail-watchlist').getAttribute('aria-pressed')).toBe('true'); expect(el('detail-favorite').getAttribute('aria-pressed')).toBe('false')
  await click('detail-back'); expect(el('home-rows').querySelector('[data-row="Watchlist"]')?.textContent).toContain('Watchlist movie')
  await click('view-watchlist'); expect(el('channels').querySelectorAll('button')).toHaveLength(1)
  expect(el('section-title').textContent).toBe('Watchlist')
  const card = el('channels').querySelector<HTMLButtonElement>('button')!
  card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  expect(el('card-menu-watchlist').textContent).toBe('Remove from watchlist')
  await click('card-menu-watchlist'); expect(el('channels').querySelectorAll('button')).toHaveLength(0)
  expect(el('empty-title').textContent).toBe('Your next watch starts here')
  await click('nav-settings'); await click('settings-manage'); expect(el('manage-watchlist-count').textContent).toBe('0')
  vi.clearAllTimers()
})
