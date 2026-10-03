import { afterEach, expect, it, vi } from 'vitest'
import { canReplay, replayChannel } from '../tv-app/catchup'
import { parseCatalog, type Source, type Channel } from '../tv-app/catalog'
import type { Programme } from '../tv-app/guide'
const source: Source = { kind: 'xtream', url: 'https://example.com/provider', username: 'a&b', password: 'secret/#' }
const channel: Channel = { name: 'News', url: 'https://example.com/provider/live/a%26b/secret%2F%23/1.m3u8', group: 'News', mediaKind: 'live', providerId: '1', tvArchive: 1, tvArchiveDuration: 2 }
const now = Date.now(), programme: Programme = { start: now - 2 * 3600000, stop: now - 3600000, title: 'Earlier news', description: 'Example', archive: true }
afterEach(() => vi.unstubAllGlobals())
it('gates replay by provider availability, retention and programme time', () => {
  expect(canReplay(source, channel, programme, now)).toBe(true)
  expect(canReplay(source, channel, { ...programme, archive: false }, now)).toBe(false)
  expect(canReplay(source, channel, { ...programme, start: now + 1000, stop: now + 2000 }, now)).toBe(false)
  expect(canReplay(source, channel, { ...programme, start: now - 3 * 86400000 }, now)).toBe(false)
})
it('builds an encoded provider archive with a reported clock and preserves DRM/header requirements', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ server_info: { time_now: '2026-10-03 12:00:00', timestamp_now: Date.UTC(2026, 9, 3, 10) / 1000 } }))))
  const playback = { headers: { authorization: 'example' }, drm: { system: 'com.widevine.alpha', licenseUrl: 'https://license.example/' } }
  const replay = await replayChannel(source, { ...channel, playback }, programme, new AbortController().signal)
  expect(replay.url).toContain('/provider/timeshift/a%26b/secret%2F%23/60/'); expect(replay.url).toMatch(/\/1.m3u8$/)
  expect(replay.playback?.headers).toEqual(playback.headers); expect(replay.playback?.drm).toEqual(playback.drm)
})
it('does not guess a missing provider clock or reveal failed request URLs', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
  await expect(replayChannel(source, channel, programme, new AbortController().signal)).rejects.toThrow('provider did not report its clock')
  const replay = await replayChannel(source, channel, programme, new AbortController().signal, { format: 'legacy', offset: -420 })
  expect(new URL(replay.url).pathname).toBe('/provider/streaming/timeshift.php'); expect(new URL(replay.url).searchParams.get('password')).toBe('secret/#')
})
it('supports providers that report only an IANA timezone', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ server_info: { timezone: 'UTC' } }))))
  const replay = await replayChannel(source, channel, programme, new AbortController().signal)
  const date = new Date(programme.start), pad = (value: number) => String(value).padStart(2, '0')
  expect(replay.url).toContain(`${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}:${pad(date.getUTCHours())}-${pad(date.getUTCMinutes())}`)
})
it('preserves M3U catch-up metadata and expands the original template rules', async () => {
  const list = parseCatalog('#EXTM3U\n#EXTINF:-1 catchup="append" catchup-days="3" catchup-source="?utc={utc}&end={utcend}",News\nhttps://example.com/live.m3u8', 'https://example.com/list.m3u')
  const account = { ...source, kind: 'playlist' as const }
  const result = await replayChannel(account, list.channels[0], programme, new AbortController().signal)
  expect(new URL(result.url).searchParams.get('utc')).toBe(String(Math.floor(programme.start / 1000)))
  expect(list.channels[0]).toMatchObject({ catchup: 'append', catchupDays: 3 })
})
it('blocks malformed archive URLs, cross-host header disclosure and pre-cancelled work', async () => {
  const account = { ...source, kind: 'playlist' as const }
  for (const template of ['javascript:alert(1)', 'https://other.example/{unknown}']) await expect(replayChannel(account, { ...channel, catchup: 'default', catchupSource: template }, programme, new AbortController().signal)).rejects.toThrow()
  await expect(replayChannel(account, { ...channel, catchup: 'default', catchupSource: 'https://other.example/archive.m3u8', playback: { headers: { authorization: 'secret' } } }, programme, new AbortController().signal)).rejects.toThrow('changes media servers')
  const controller = new AbortController(); controller.abort(); await expect(replayChannel(source, channel, programme, controller.signal)).rejects.toThrow('cancelled')
})
