// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest'
import { channelId, durationLabel, forgetLibraries, TVLibrary } from '../tv-app/library'
import type { Source } from '../tv-app/catalog'
import { mediaUrl } from '../tv-app/xtream'
const source: Source = { kind: 'playlist', url: 'https://example.com/list?password=private', username: '', password: '' }
const channel = { name: 'Private channel', group: 'Movies', url: 'https://example.com/movie/user/secret/1.mp4' }
beforeEach(() => localStorage.clear())

it('keeps session libraries private until saving is explicitly enabled', () => {
  const library = new TVLibrary(null, source)
  library.toggleFavorite(channel); library.record(channel, 80, 600)
  expect(localStorage.length).toBe(0)
  library.setStorage(localStorage)
  const raw = localStorage.getItem(localStorage.key(0)!)!
  for (const secret of ['https:', 'example.com', 'password', 'private', 'secret', 'Private channel']) expect(raw).not.toContain(secret)
  const restored = new TVLibrary(localStorage, source)
  expect(restored.isFavorite(channel)).toBe(true)
  expect(restored.lastPlayed(channel)).toMatchObject({ position: 80, duration: 600 })
})
it('keeps provider libraries isolated and rejects invalid or corrupt stored state', () => {
  const library = new TVLibrary(localStorage, source); library.toggleFavorite(channel)
  expect(new TVLibrary(localStorage, { ...source, url: 'https://other.example/list' }).isFavorite(channel)).toBe(false)
  localStorage.setItem(localStorage.key(0)!, JSON.stringify({ favorites: ['bad', '__proto__'], recent: [{ id: channelId(channel), at: Date.now(), position: 800, duration: 600 }] }))
  const restored = new TVLibrary(localStorage, source)
  expect(restored.favorites.size).toBe(0); expect(restored.recent.size).toBe(0)
})
it('drops oldest history across reloads and keeps favorites independent', () => {
  const library = new TVLibrary(localStorage, source)
  library.toggleFavorite(channel)
  const item = (i: number) => ({ ...channel, url: `https://example.com/${i}` })
  for (let i = 0; i < 100; i++) library.record(item(i), 100, 200)
  const restored = new TVLibrary(localStorage, source); restored.record(item(100), 100, 200)
  expect(restored.recent.size).toBe(100)
  expect(restored.lastPlayed(item(0))).toBeUndefined()
  expect(restored.lastPlayed(item(99))).toBeDefined()
  restored.clearHistory(); expect(restored.recent.size).toBe(0); expect(restored.isFavorite(channel)).toBe(true)
})
it('never offers a resume point for live, finished or nearly finished streams', () => {
  const library = new TVLibrary(null, source)
  for (const [position, duration, ended] of [[50, Infinity, false], [595, 600, false], [200, 600, true], [NaN, 600, false]] as const) {
    library.record(channel, position, duration, ended)
    expect(library.lastPlayed(channel)?.position).toBe(0)
  }
  const live = { ...channel, mediaKind: 'live' as const }
  library.record(live, 120, 3600)
  expect(library.lastPlayed(live)?.position).toBe(0)
})
it('does not recreate deleted records after disabling persistence', () => {
  const library = new TVLibrary(localStorage, source); library.toggleFavorite(channel)
  localStorage.setItem('unrelated', 'retain')
  library.setStorage(null); forgetLibraries(localStorage); library.record(channel, 120, 600)
  expect(localStorage.length).toBe(1); expect(localStorage.getItem('unrelated')).toBe('retain')
})
it('formats a readable movie position', () => {
  expect(durationLabel(3661)).toBe('1:01:01'); expect(durationLabel(84)).toBe('1:24'); expect(durationLabel(Infinity)).toBe('0:00')
})
it('restores the last season and removes only the chosen history entry', () => {
  const library = new TVLibrary(localStorage, source), other = { ...channel, url: 'https://example.com/another.mp4' }
  library.setSeason(channel, 'Season 2'); library.record(channel, 80, 600); library.record(other, 90, 600); library.toggleFavorite(channel)
  const restored = new TVLibrary(localStorage, source)
  expect(restored.season(channel)).toBe('Season 2'); restored.removeRecent(channel)
  expect(restored.lastPlayed(channel)).toBeUndefined(); expect(restored.lastPlayed(other)?.position).toBe(90); expect(restored.isFavorite(channel)).toBe(true)
})
it('restores provider favorites and resume items without reloading their categories or storing credentials', () => {
  const account: Source = { kind: 'xtream', url: 'https://provider.example/sub', username: 'my-user', password: 'my-password' }
  const movie = { name: 'A saved movie', group: 'Drama', mediaKind: 'movie' as const, providerId: '25', url: mediaUrl(account, 'movie', '25', 'mkv') }
  const series = { name: 'A saved series', group: 'Shows', mediaKind: 'series' as const, providerId: '26', url: '' }
  const library = new TVLibrary(localStorage, account)
  library.toggleFavorite(movie); library.toggleFavorite(series); library.record(movie, 120, 1800)
  const stored = localStorage.getItem(localStorage.key(0)!)!
  for (const secret of ['https:', 'my-user', 'my-password', 'provider.example']) expect(stored).not.toContain(secret)
  const restored = new TVLibrary(localStorage, account)
  expect(restored.bookmarkedChannels()).toEqual([movie, series])
  expect(restored.lastPlayed(restored.bookmarkedChannels()[0])?.position).toBe(120)
  const longEpisode = { ...movie, mediaKind: 'episode' as const, providerId: '27', name: 'Episode '.repeat(40), group: 'Season '.repeat(20), url: mediaUrl(account, 'series', '27', 'mp4') }
  restored.record(longEpisode, 100, 1800)
  const episode = new TVLibrary(localStorage, account).bookmarkedChannels().find(item => item.providerId === '27')!
  expect(episode.name.length).toBe(200); expect(episode.group.length).toBe(100); expect(episode.url).toBe(longEpisode.url)
  restored.toggleFavorite(movie); restored.clearHistory()
  expect(new TVLibrary(localStorage, account).bookmarkedChannels()).toEqual([series])
})
it('rejects forged provider references and never rewrites arbitrary media addresses as bookmarks', () => {
  const account: Source = { kind: 'xtream', url: 'https://provider.example', username: 'u', password: 'p' }
  const library = new TVLibrary(localStorage, account)
  library.toggleFavorite({ ...channel, mediaKind: 'movie', providerId: '9' })
  expect(library.bookmarkedChannels()).toEqual([])
  const key = localStorage.key(0)!, data = JSON.parse(localStorage.getItem(key)!)
  data.references = [{ providerId: '../9', mediaKind: 'movie', extension: 'mp4', name: 'bad', group: '' }, { providerId: '9', mediaKind: 'movie', extension: 'mp4', name: 'unrelated', group: '' }]
  localStorage.setItem(key, JSON.stringify(data))
  expect(new TVLibrary(localStorage, account).bookmarkedChannels()).toEqual([])
})
