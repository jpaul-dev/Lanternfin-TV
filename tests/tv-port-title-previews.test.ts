import { afterEach, expect, it, vi } from 'vitest'
import { TitlePreviews } from '../tv-app/title-previews'
import { loadTitleDetails, type TitleDetails } from '../tv-app/xtream'
import type { Channel, Source } from '../tv-app/catalog'

const source: Source = { kind: 'xtream', url: 'https://provider.example', username: 'demo', password: 'demo' }
const channel = (id: number, kind: 'movie' | 'series' = 'movie'): Channel => ({ name: `${kind} ${id}`, group: 'Drama', url: `https://provider.example/${id}.mp4`, mediaKind: kind, providerId: String(id), logo: 'https://images.example/poster.jpg' })
const info = { plot: 'Provider synopsis', backdrop_path: ['javascript:bad', 'https://images.example/backdrop.jpg'], movie_image: 'https://images.example/provider-poster.jpg', year: '2026', duration_secs: 5400, rating: 8, cast: 'Cast', director: 'Director' }
const signal = () => new AbortController().signal
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('reuses sanitized metadata and defensive copies without leaking between sources or media kinds', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ info }))); vi.stubGlobal('fetch', fetcher)
  const cache = new TitlePreviews(source), movie = channel(1), result = await cache.load(movie, signal())
  expect(result).toMatchObject({ description: info.plot, backdrop: 'https://images.example/backdrop.jpg', poster: info.movie_image }); expect(result?.metadata).toContain('1:30:00')
  result!.metadata[0] = 'changed'; expect(cache.read(movie)?.metadata[0]).toBe('2026')
  const replacement = { ...movie, name: 'Current catalog title' }; expect((await cache.load(replacement, signal()))?.channel).toBe(replacement); expect(fetcher).toHaveBeenCalledOnce()
  await cache.load(channel(1, 'series'), signal()); expect(fetcher).toHaveBeenCalledTimes(2)
  const other = new TitlePreviews({ ...source, username: 'other' }); await other.load(movie, signal()); expect(fetcher).toHaveBeenCalledTimes(3)
  expect(new URL(String(fetcher.mock.calls[2][0])).searchParams.get('username')).toBe('other')
})

it('loads episode backdrops through their parent series without building or retaining episode lists', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ info, episodes: { 1: [{ id: 12, season: 1, episode_num: 1, title: 'Episode' }] } }))); vi.stubGlobal('fetch', fetcher)
  const cache = new TitlePreviews(source), episode: Channel = { ...channel(12), mediaKind: 'episode', seriesId: '9', seriesName: 'Parent series' }
  const preview = await cache.load(episode, signal()); expect(preview?.channel).toBe(episode); expect(preview).not.toHaveProperty('episodes')
  expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('series_id')).toBe('9')
  await cache.load({ ...episode, providerId: '13', name: 'Another episode' }, signal()); expect(fetcher).toHaveBeenCalledOnce()
  const full = await loadTitleDetails(source, channel(9, 'series'), signal()); expect(full.episodes).toHaveLength(1)
  cache.remember(full); expect(cache.read(channel(9, 'series'))).not.toHaveProperty('episodes')
  const playlist = new TitlePreviews({ ...source, kind: 'playlist' }); expect(await playlist.load(channel(1), signal())).toBeUndefined()
})

it('cancels obsolete lookups and rejects late results after source cleanup', async () => {
  const pending: { resolve(value: Response): void; signal: AbortSignal }[] = []
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise<Response>(resolve => pending.push({ resolve, signal: options.signal as AbortSignal }))))
  const cache = new TitlePreviews(source), first = cache.load(channel(1), signal()), firstRejected = expect(first).rejects.toThrow('cancelled')
  const second = cache.load(channel(2), signal()), secondRejected = expect(second).rejects.toThrow('cancelled')
  expect(pending[0].signal.aborted).toBe(true); cache.clear(); expect(pending[1].signal.aborted).toBe(true)
  for (const item of pending) item.resolve(new Response(JSON.stringify({ info })))
  await firstRejected; await secondRejected; expect(cache.read(channel(1))).toBeUndefined(); expect(cache.read(channel(2))).toBeUndefined()
})

it('limits repeated failures, expires stale metadata and never requests invalid or cancelled titles', async () => {
  let now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now)
  const fetcher = vi.fn(async () => new Response('', { status: 503 })); vi.stubGlobal('fetch', fetcher)
  const cache = new TitlePreviews(source), movie = channel(1)
  await expect(cache.load(movie, signal())).rejects.toThrow('503'); expect(await cache.load(movie, signal())).toBeUndefined(); expect(fetcher).toHaveBeenCalledOnce()
  now += 31000; fetcher.mockImplementation(async () => new Response(JSON.stringify({ info }))); await cache.load(movie, signal()); expect(fetcher).toHaveBeenCalledTimes(2)
  now += 16 * 60000; expect(cache.read(movie)).toBeUndefined(); await cache.load(movie, signal()); expect(fetcher).toHaveBeenCalledTimes(3)
  await cache.load({ ...movie, providerId: '../bad' }, signal()); const controller = new AbortController(); controller.abort(); await expect(cache.load(channel(2), controller.signal)).rejects.toThrow('cancelled')
  expect(fetcher).toHaveBeenCalledTimes(3)
})

it('evicts old entries by both count and retained text size without preserving large series arrays', () => {
  const cache = new TitlePreviews(source)
  const details = (id: number): TitleDetails => ({ channel: channel(id), description: '', metadata: [], cast: '', director: '' })
  for (let id = 1; id <= 41; id++) cache.remember(details(id))
  expect(cache.read(channel(1))).toBeUndefined(); expect(cache.read(channel(41))).toBeDefined()
  cache.clear()
  for (let id = 1; id <= 40; id++) cache.remember({ ...details(id), description: 'd'.repeat(4000), poster: `https://images.example/${'p'.repeat(1950)}`, backdrop: `https://images.example/${'b'.repeat(1950)}`, metadata: Array(8).fill('m'.repeat(200)), cast: 'c'.repeat(200), director: 'd'.repeat(200), episodes: Array(50000).fill(channel(1)) })
  expect(cache.read(channel(1))).toBeUndefined(); expect(cache.read(channel(40))).toBeDefined(); expect(cache.read(channel(40))).not.toHaveProperty('episodes')
})
