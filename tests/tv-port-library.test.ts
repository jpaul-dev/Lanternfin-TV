// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest'
import { channelId, durationLabel, forgetLibraries, TVLibrary } from '../tv-app/library'
import type { Source } from '../tv-app/catalog'
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
