import { buildM3uCatchupUrl, buildXtreamTimeshiftUrl, clampedDurationMinutes, isCatchupPlayable, parseXtreamStyleLiveUrl } from '../src/scripts/lib/catchup'
import { providerClockOffset } from './provider-clock'
import { httpUrl, playlistUrl, validateSource, type Channel, type Source } from './catalog'
import { request } from './xtream'
import type { Programme } from './guide'

export function canReplay(source: Source, channel: Channel, programme: Programme, now = Date.now()) {
  const raw = archiveTimes(programme)
  return channel.mediaKind === 'live' && Number.isFinite(raw.start) && Number.isFinite(raw.stop) && raw.stop > raw.start && programme.start <= now && isCatchupPlayable(programme.archive === true ? { ...channel, tvArchive: 1 } : channel, raw.start, now) && !(source.kind === 'xtream' && programme.archive === false)
}
/** Display-only guide corrections must never alter the provider's archive address. */
function archiveTimes(programme: Programme) {
  const minutes = programme.guideShiftMinutes, shift = typeof minutes === 'number' && Number.isFinite(minutes) && Math.abs(minutes) <= 2280 ? minutes * 60000 : 0
  return { ...programme, start: programme.start - shift, stop: programme.stop - shift }
}
type Options = { format: 'hls' | 'ts' | 'legacy'; offset?: number }
/** Reuses the original catch-up URL rules without the desktop bridge or URL-logging probe. */
export async function replayChannel(source: Source, channel: Channel, programme: Programme, signal: AbortSignal, options: Options = { format: 'hls' }): Promise<Channel> {
  if (signal.aborted) throw new Error('Archive loading cancelled.')
  if (!canReplay(source, channel, programme)) throw new Error('This programme is outside the provider’s available archive.')
  programme = archiveTimes(programme)
  let url: string | null = null
  if (source.kind !== 'xtream' && channel.catchup !== 'xc') {
    url = buildM3uCatchupUrl(channel, { startUtcMs: programme.start, stopUtcMs: programme.stop, nowUtcMs: Date.now(), catchupCorrectionHours: channel.catchupCorrection, catchupId: programme.catchupId })
  } else {
    let account = source, id = channel.providerId
    if (source.kind !== 'xtream') {
      const parsed = parseXtreamStyleLiveUrl(channel.url)
      if (!parsed) throw new Error('The playlist’s archive address could not be interpreted. Use this provider’s Xtream account.')
      try { account = validateSource({ kind: 'xtream', url: parsed.baseUrl, username: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password) }); id = decodeURIComponent(parsed.streamId) }
      catch { throw new Error('The playlist’s archive account is invalid.') }
    }
    if (!id || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error('The archive channel identifier is invalid.')
    let offset = options.offset
    if (offset === undefined) {
      const response = await request(account, '', signal, {}, 256 * 1024) as { server_info?: { time_now?: string; timestamp_now?: string | number; timezone?: string } }
      offset = providerClockOffset(response?.server_info, programme.start)
    }
    if (!Number.isFinite(offset) || offset < -720 || offset > 840) throw new Error('Choose a valid provider clock offset.')
    const base = new URL(playlistUrl(account)); base.pathname = base.pathname.replace(/get\.php$/, ''); base.search = ''
    url = buildXtreamTimeshiftUrl({ baseUrl: base.href, username: account.username, password: account.password, streamId: id, startUtcMs: programme.start, durationMinutes: clampedDurationMinutes(programme.start, programme.stop, Date.now()), serverOffsetMs: offset * 60000, extension: options.format === 'ts' ? 'ts' : 'm3u8', form: options.format === 'legacy' ? 'legacy' : 'rest', catchupCorrectionMs: (channel.catchupCorrection || 0) * 3600000 })
  }
  if (signal.aborted) throw new Error('Archive loading cancelled.')
  if (!url || /\{[^}]*\}/.test(url) || url.length > 16384) throw new Error('This provider’s archive format is not supported. Ask for an M3U catch-up template or an Xtream account.')
  try { url = httpUrl(url, channel.url) } catch { throw new Error('The provider returned an invalid archive address.') }
  if (Object.keys(channel.playback?.headers || {}).length && new URL(url).origin !== new URL(channel.url).origin) throw new Error('This archive changes media servers while requiring custom headers. A provider-compatible archive address is needed.')
  const playback = channel.playback && { ...channel.playback, manifestType: /\.m3u8(?:\?|$)/i.test(url) ? 'hls' : /\.mpd(?:\?|$)/i.test(url) ? 'dash' : undefined }
  return { name: `${programme.title} · ${channel.name}`.slice(0, 200), url, group: channel.group, mediaKind: 'movie', description: programme.description, logo: channel.logo, ...(playback ? { playback } : {}) }
}
