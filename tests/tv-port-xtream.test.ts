import { afterEach, expect, it, vi } from 'vitest'
import { apiUrl, loadCategories, loadCategory, loadEpisodes, loadTitleDetails, mediaUrl } from '../tv-app/xtream'
import type { Source } from '../tv-app/catalog'
const source: Source = { kind: 'xtream', url: 'https://provider.example/sub', username: 'a&b', password: 'secret/#' }
const signal = () => new AbortController().signal
const respond = (data: unknown) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(data))))
afterEach(() => vi.unstubAllGlobals())
it('encodes account values and retains provider subpaths', () => {
  const api = new URL(apiUrl(source, 'get_series_info', { series_id: '42' }))
  expect(api.pathname).toBe('/sub/player_api.php'); expect(api.searchParams.get('password')).toBe('secret/#')
  expect(mediaUrl(source, 'movie', '42', 'mkv')).toBe('https://provider.example/sub/movie/a%26b/secret%2F%23/42.mkv')
  expect(() => mediaUrl(source, 'live', '../42', 'm3u8')).toThrow('identifier')
})
it('validates and deduplicates categories without interpreting provider markup', async () => {
  respond([{ category_id: 1, category_name: '<script>inert</script>' }, { category_id: 1 }, { category_id: '../2' }])
  expect(await loadCategories(source, 'movie', signal())).toEqual([{ id: '1', name: '<script>inert</script>' }])
})
it('loads artwork and separates series metadata from playable episodes', async () => {
  respond([{ series_id: 99, name: 'A series', cover: 'https://images.example/poster.jpg' }])
  const series = (await loadCategory(source, 'series', { id: '2', name: 'Drama' }, signal())).channels[0]
  expect(series).toMatchObject({ mediaKind: 'series', providerId: '99', url: '', logo: 'https://images.example/poster.jpg' })
  respond({ episodes: { '2': [{ id: 4, season: 2, episode_num: 1, title: 'Later', container_extension: 'mp4' }], '1': [{ id: 3, season: 1, episode_num: 2, title: 'Earlier', container_extension: 'mkv' }, { id: '../bad', episode_num: 0 }] } })
  const episodes = await loadEpisodes(source, series, signal())
  expect(episodes.skipped).toBe(1); expect(episodes.channels.map(item => item.name)).toEqual(['S1 E2 · Earlier', 'S2 E1 · Later'])
  expect(episodes.channels[0].url).toContain('/series/a%26b/secret%2F%23/3.mkv')
})
it('redacts transport errors and reports rejected accounts', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private URL')))
  await expect(loadCategories(source, 'live', signal())).rejects.toThrow('Cannot reach this provider')
  respond({ user_info: { auth: 0 } })
  await expect(loadCategories(source, 'live', signal())).rejects.toThrow('did not accept')
})
it('enforces response bounds and cancellation', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { headers: { 'content-length': '100000000' } })))
  await expect(loadCategories(source, 'live', signal())).rejects.toThrow('unusually large')
  const abort = new AbortController(); abort.abort()
  await expect(loadCategories(source, 'live', abort.signal)).rejects.toThrow('cancelled')
})
it('normalizes title details while keeping descriptions inert and rejecting unsafe artwork', async () => {
  respond({ info: { plot: '<script>inert text</script>', movie_image: 'javascript:alert(1)', backdrop_path: ['https://images.example/wide.jpg'], releasedate: '2024-02-10', rating: '8.4', genre: 'Drama', duration: '01:30:00', cast: 'A, B', director: 'C' } })
  const channel = { name: 'A movie', url: mediaUrl(source, 'movie', '42', 'mp4'), group: 'Movies', mediaKind: 'movie' as const, providerId: '42', logo: 'https://images.example/poster.jpg' }
  const details = await loadTitleDetails(source, channel, signal())
  expect(details.description).toBe('<script>inert text</script>'); expect(details.poster).toBe(channel.logo)
  expect(details.backdrop).toBe('https://images.example/wide.jpg'); expect(details.metadata).toEqual(['2024', 'Drama', '01:30:00', '8.4 / 10'])
  expect(details.channel).toBe(channel)
})
