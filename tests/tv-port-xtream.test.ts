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
  expect(details.backdrop).toBe('https://images.example/wide.jpg'); expect(details.metadata).toEqual(['2024', 'Drama', '1:30:00', '8.4 / 10'])
  expect(details.channel).toBe(channel)
})
it('recovers valid movie_data metadata when primary fields are absent or malformed', async () => {
  respond({ info: { plot: {}, movie_image: 'javascript:bad', releasedate: 'invalid', rating: 'unknown', duration: '99:99:99' }, movie_data: { description: '<img src=x onerror=bad()>', cover: 'https://images.example/poster.jpg', backdrop_path: ['javascript:bad', 'https://images.example/wide.jpg'], releaseDate: '2025-05-10', rating_5based: '4.5', duration_secs: 5401, genre: 'Drama', actors: 'Cast', director: 'Director' } })
  const details = await loadTitleDetails(source, { name: 'Movie', url: mediaUrl(source, 'movie', '1', 'mp4'), mediaKind: 'movie', providerId: '1', group: 'Movies' }, signal())
  expect(details).toMatchObject({ description: '<img src=x onerror=bad()>', poster: 'https://images.example/poster.jpg', backdrop: 'https://images.example/wide.jpg', cast: 'Cast', director: 'Director' })
  expect(details.metadata).toEqual(['2025', 'Drama', '1:30:01', '9.0 / 10'])
})
it('loads bounded episode runtime, synopsis and safe stills without inventing missing durations', async () => {
  const series = { name: 'Show', url: '', mediaKind: 'series' as const, providerId: '5', group: 'Shows', logo: 'https://images.example/show.jpg' }
  respond({ episodes: { 0: [{ id: 1, season: 0, episode_num: 1, title: 'Special', info: { duration_secs: 2510, plot: '<script>inert</script>', movie_image: 'https://images.example/special.jpg' } }], 1: [{ id: 2, episode_num: 1, title: 'Opening', duration: '43:10', plot: 'A'.repeat(1000), info: { movie_image: 'data:bad' } }, { id: 3, episode_num: 2, title: 'Missing', info: { duration_secs: -5, duration: '99:99:99', movie_image: 'javascript:bad' } }] } })
  const result = await loadEpisodes(source, series, signal())
  expect(result.channels[0]).toMatchObject({ name: 'S0 E1 · Special', durationSeconds: 2510, description: '<script>inert</script>', logo: 'https://images.example/special.jpg' })
  expect(result.channels[1]).toMatchObject({ durationSeconds: 2590, logo: series.logo }); expect(result.channels[1].description).toHaveLength(600)
  expect(result.channels[2].durationSeconds).toBeUndefined(); expect(result.channels[2].logo).toBe(series.logo)
})
