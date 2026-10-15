import type { Channel } from './catalog'
import { webAddress, type DRM, type PlaybackOptions } from './media'
import { licenseFormat } from './license-format'

const invalid = () => new Error('The saved playlist is unavailable. Reload it from your provider.')
function object(value: unknown, allowed: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw invalid()
  return value as Record<string, any>
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw invalid()
  return value
}
function address(value: unknown, max: number) {
  const input = text(value, max)
  try { return webAddress(input) } catch { throw invalid() }
}
function headerRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  const entries = Object.entries(value), result: Record<string, string> = Object.create(null)
  if (entries.length > 256) throw invalid()
  let length = 0
  for (const [name, input] of entries) {
    const val = text(input, 65536)
    if (!/^[!#$%&'*+.^_`|~\w-]{1,100}$/.test(name) || /[\r\n\0]/.test(val) || (length += name.length + val.length) > 131072) throw invalid()
    // Keep the exact header spelling/value. Cached data never grants permission
    // to discard a requirement the selected player cannot fulfill.
    result[name] = val
  }
  return result
}
function playbackRecord(value: unknown): PlaybackOptions {
  const raw = object(value, ['headers', 'drm', 'manifestType', 'problem']), result: PlaybackOptions = {}
  if (raw.headers !== undefined) result.headers = headerRecord(raw.headers)
  if (raw.manifestType !== undefined) result.manifestType = text(raw.manifestType, 65536)
  if (raw.problem !== undefined) { result.problem = text(raw.problem, 2048); if (!result.problem) throw invalid() }
  if (raw.drm !== undefined) {
    const input = object(raw.drm, ['system', 'licenseUrl', 'headers', 'clearKeys', 'format'])
    const drm: DRM = { system: text(input.system, 65536) }; if (!drm.system) throw invalid()
    if (input.licenseUrl !== undefined) drm.licenseUrl = address(input.licenseUrl, 196608)
    if (input.headers !== undefined) drm.headers = headerRecord(input.headers)
    if (input.clearKeys !== undefined) {
      if (!input.clearKeys || typeof input.clearKeys !== 'object' || Array.isArray(input.clearKeys)) throw invalid()
      const keys = Object.entries(input.clearKeys)
      if (drm.system !== 'org.w3.clearkey' || input.licenseUrl !== undefined || input.headers !== undefined || input.format !== undefined || !keys.length || keys.length > 64 || new Set(keys.map(([key]) => key.toLowerCase())).size !== keys.length || keys.some(([key, val]) => !/^[a-f\d]{32}$/i.test(key) || typeof val !== 'string' || !/^[a-f\d]{32}$/i.test(val))) throw invalid()
      drm.clearKeys = Object.fromEntries(keys) as Record<string, string>
    }
    if (input.format !== undefined) {
      const format = object(input.format, ['request', 'response'])
      try { drm.format = licenseFormat(format.request === undefined ? '' : text(format.request, 16384), format.response === undefined ? '' : text(format.response, 256)) } catch { throw invalid() }
    }
    result.drm = drm
  }
  return result
}
export function playlistGuide(value: unknown): string | undefined { return value === undefined ? undefined : address(value, 32768) }

/** Validate cached M3U records before saving or restoring. Unknown/invalid
 * playback metadata rejects the snapshot instead of silently losing headers,
 * license requirements, catch-up settings or the parser's blocking problem.
 * Only the compact fields emitted by the playlist parser are persisted.
 */
export function playlistChannel(value: unknown): Channel {
  const raw = object(value, ['name', 'url', 'group', 'mediaKind', 'logo', 'tvgId', 'tvgShift', 'catchup', 'catchupDays', 'catchupSource', 'catchupCorrection', 'playback'])
  const result: Channel = { name: text(raw.name, 200), url: address(raw.url, 65536), group: text(raw.group, 100) }
  if (raw.mediaKind !== undefined) { if (!['live', 'movie', 'series', 'episode'].includes(raw.mediaKind)) throw invalid(); result.mediaKind = raw.mediaKind }
  if (raw.logo !== undefined) result.logo = address(raw.logo, 8192)
  if (raw.tvgId !== undefined) result.tvgId = text(raw.tvgId, 200)
  if (raw.catchup !== undefined) result.catchup = text(raw.catchup, 40)
  if (raw.catchupSource !== undefined) result.catchupSource = text(raw.catchupSource, 8192)
  for (const key of ['tvgShift', 'catchupCorrection', 'catchupDays'] as const) if (raw[key] !== undefined) {
    const num = raw[key], min = key === 'catchupDays' ? 0 : -24, max = key === 'catchupDays' ? 30 : 24
    if (typeof num !== 'number' || !Number.isFinite(num) || num < min || num > max) throw invalid()
    result[key] = num
  }
  if (raw.playback !== undefined) result.playback = playbackRecord(raw.playback)
  return result
}
