// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { EpisodeContext, parentSeries } from '../tv-app/episode-context'
import { TVLibrary } from '../tv-app/library'
import { mediaUrl } from '../tv-app/xtream'
import { nextEpisode } from '../tv-app/playback-queue'
import type { Channel, Source } from '../tv-app/catalog'
const source: Source = { kind: 'xtream', url: 'https://provider.example', username: 'u', password: 'p' }
const episode: Channel = { name: 'S1 E1', url: mediaUrl(source, 'series', '100', 'mp4'), group: 'Season 1', mediaKind: 'episode', providerId: '100', seriesId: '42', seriesName: 'Example series' }
const response = () => new Response(JSON.stringify({ episodes: { 1: [{ id: 100, episode_num: 1, title: 'First' }, { id: 101, episode_num: 2, title: 'Next' }] } }))
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })
it('restores next-episode context from an opted-in bookmark after a cold start', async () => {
  const library = new TVLibrary(localStorage, source); library.record(episode, 70, 1200)
  const restored = new TVLibrary(localStorage, source).bookmarkedChannels()[0]
  expect(restored).toMatchObject({ seriesId: '42', seriesName: 'Example series' })
  vi.stubGlobal('fetch', vi.fn(async (address: string) => { expect(new URL(address).searchParams.get('series_id')).toBe('42'); return response() }))
  const queue = new EpisodeContext(); await queue.load(source, restored)
  expect(nextEpisode(queue.items, restored)?.providerId).toBe('101')
  await queue.load(source, restored); expect(fetch).toHaveBeenCalledOnce()
})
it('discards late context after cancellation or a source switch', async () => {
  let finish!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve })))
  const queue = new EpisodeContext(), pending = queue.load(source, episode).catch(() => {})
  queue.clear(); finish(response()); await pending; expect(queue.items).toEqual([])
  await queue.load(source, episode, [episode]); expect(queue.items).toHaveLength(1)
  await queue.load({ ...source, kind: 'playlist' }, episode); expect(queue.items).toEqual([])
  expect(parentSeries({ ...episode, seriesId: '../bad' })).toBeUndefined()
})
