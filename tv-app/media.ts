/** Provider metadata stays in memory. Never include URLs, keys or header values in diagnostics. */
import { licenseFormat, type LicenseFormat } from './license-format'
export type DRM = { system: string; licenseUrl?: string; headers?: Record<string, string>; clearKeys?: Record<string, string>; format?: LicenseFormat }
export type PlaybackOptions = { headers?: Record<string, string>; drm?: DRM; manifestType?: string; problem?: string }
export type Media = { url: string; mediaKind?: 'live' | 'movie' | 'series' | 'episode'; playback?: PlaybackOptions }
export function webAddress(value: string, base?: string): string {
  const url = new URL(value, base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid media address.')
  return url.href
}
function headers(value: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null)
  for (const [key, val] of new URLSearchParams(value)) {
    if (!/^[!#$%&'*+.^_`|~\w-]{1,100}$/.test(key) || /[\r\n\0]/.test(val) || val.length > 8192) throw new Error('Invalid header')
    result[key.toLowerCase()] = val
  }
  return result
}
export function providerMedia(entry: { url: string; userAgent?: string | null; referer?: string | null; drmScheme?: string | null; licenseKey?: string | null; manifestType?: string | null }, base: string): Media {
  const [address, ...pipe] = entry.url.split('|')
  const media: Media = { url: webAddress(address, base) }, options: PlaybackOptions = {}
  try {
    if (pipe.length > 1) throw new Error('Invalid header format')
    const streamHeaders = headers(pipe[0] || '')
    if (entry.userAgent) streamHeaders['user-agent'] = entry.userAgent
    if (entry.referer) streamHeaders.referer = entry.referer
    if (Object.values(streamHeaders).some(value => /[\r\n\0]/.test(value))) throw new Error('Invalid header value')
    if (Object.keys(streamHeaders).length) options.headers = streamHeaders
    if (entry.manifestType) options.manifestType = entry.manifestType.toLowerCase()
    if (entry.drmScheme || entry.licenseKey) {
      const raw = (entry.drmScheme || '').toLowerCase()
      const system = /widevine/.test(raw) ? 'com.widevine.alpha' : /playready/.test(raw) ? 'com.microsoft.playready' : /clearkey/.test(raw) ? 'org.w3.clearkey' : raw || 'unknown'
      const drm: DRM = { system }; options.drm = drm
      if (entry.licenseKey && system === 'org.w3.clearkey' && /^[a-f\d]{32}:[a-f\d]{32}(?:,[a-f\d]{32}:[a-f\d]{32}){0,63}$/i.test(entry.licenseKey)) {
        const pairs = entry.licenseKey.split(',').map(pair => pair.toLowerCase().split(':'))
        if (new Set(pairs.map(([id]) => id)).size !== pairs.length) throw new Error('Duplicate key identifiers')
        drm.clearKeys = Object.fromEntries(pairs)
      } else if (entry.licenseKey) {
        const [url, header, body, response, ...rest] = entry.licenseKey.split('|')
        if (/\{|%7b/i.test(url)) throw new Error('License URL placeholders require provider integration')
        drm.licenseUrl = webAddress(url, base)
        if (header) drm.headers = headers(header)
        try { if (rest.length) throw new Error(); const format = licenseFormat(body, response); if (format.request || format.response) drm.format = format }
        catch { options.problem = 'This provider uses a custom license format outside the supported raw, base64 or single-field JSON formats. Formats requiring session IDs, key IDs or HDCP policy extraction need a provider-specific integration.' }
      }
    }
  } catch { options.problem = 'This entry has an invalid or unsupported header or license configuration.' }
  if (Object.keys(options).length) media.playback = options
  return media
}
export function browserHeaderProblem(values: Record<string, string> = {}): string | undefined {
  const restricted = Object.keys(values).filter(key => /^(user-agent|referer|referrer|cookie2?|origin|host|content-length|connection|accept-encoding|accept-charset|date|dnt|expect|keep-alive|permissions-policy|set-cookie|te|trailer|transfer-encoding|upgrade|via|access-control-request-.*|sec-.*|proxy-.*)$/i.test(key))
  return restricted.length ? `This stream requires ${restricted.join(', ')} overrides. This playback engine cannot apply them; use a provider-compatible URL or a native player that supports these headers.` : undefined
}
export function needsAdaptivePlayer(media: Media): boolean {
  return !!media.playback || /\.(?:m3u8|mpd)(?:\?|$)/i.test(media.url)
}
