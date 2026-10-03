import { createM3UParser, isHlsStreamManifest } from '../src/scripts/lib/m3u-parser'
import { providerMedia, type PlaybackOptions } from './media'

export type Source = { kind: 'playlist' | 'xtream' | 'direct'; url: string; username: string; password: string }
export type Channel = { name: string; url: string; group: string; mediaKind?: 'live' | 'movie' | 'series' | 'episode'; providerId?: string; logo?: string; description?: string; playback?: PlaybackOptions }
export type Catalog = { channels: Channel[]; skipped: number }
// Resource guards, not preview restrictions. Only compact playable entries are
// retained; raw downloads and the parser's rich intermediate entries are not.
export const MAX_BYTES = 256 * 1024 * 1024
export const MAX_CHANNELS = 500000
export const MAX_LINE_LENGTH = 64 * 1024
const MAX_RETAINED_CHARACTERS = 64 * 1024 * 1024
export const DOWNLOAD_IDLE_MS = 45000
export type LoadProgress = { bytes: number; total: number | null; channels: number; skipped: number }
class CatalogError extends Error {}

export function httpUrl(value: string, base?: string): string {
  const input = value.trim()
  if (!input) throw new Error('Enter a source address.')
  let url: URL
  try { url = new URL(base ? input : /^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`, base) }
  catch { throw new Error('Enter a valid HTTP or HTTPS address.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Use HTTP or HTTPS without a username or password before the hostname.')
  url.hash = ''
  return url.href
}

export function validateSource(value: unknown): Source {
  if (!value || typeof value !== 'object') throw new Error('Choose a source.')
  const s = value as Source
  if (!['playlist', 'xtream', 'direct'].includes(s.kind) || typeof s.url !== 'string' ||
    s.url.length > 8192 || typeof s.username !== 'string' || typeof s.password !== 'string' ||
    s.username.length > 1024 || s.password.length > 1024) throw new Error('Invalid source settings.')
  const url = httpUrl(s.url)
  if (s.kind === 'xtream' && (!s.username || !s.password)) throw new Error('Enter your provider username and password.')
  return { kind: s.kind, url, username: s.kind === 'xtream' ? s.username : '', password: s.kind === 'xtream' ? s.password : '' }
}

export function playlistUrl(source: Source): string {
  if (source.kind !== 'xtream') return source.url
  const url = new URL(source.url)
  url.pathname = url.pathname.replace(/\/(?:player_api|get)\.php\/?$/i, '').replace(/\/$/, '') + '/get.php'
  url.search = ''
  url.searchParams.set('username', source.username)
  url.searchParams.set('password', source.password)
  url.searchParams.set('type', 'm3u_plus')
  url.searchParams.set('output', 'm3u8')
  return url.href
}

function catalogParser(base: string) {
  const channels: Channel[] = []
  let skipped = 0, header = false, hls = false, retained = 0, entries = 0
  const groups = new Map<string, string>()
  const parser = createM3UParser(entry => {
    if (++entries > MAX_CHANNELS) throw new CatalogError('This catalog exceeds the 500,000-entry TV memory budget. Request a category-specific playlist from your provider.')
    if (entry.url.length > 16384) { skipped++; return }
    let media: ReturnType<typeof providerMedia>
    try { media = providerMedia(entry, base) } catch { skipped++; return }
    const { url } = media
    let logo: string | undefined
    try { if (entry.logo && entry.logo.length <= 2048) logo = httpUrl(entry.logo, base) } catch { /* Artwork is optional. */ }
    const kind = (entry.tvgType || '').toLowerCase()
    const mediaKind = /^(movie|vod)$/.test(kind) || /\/movie\//i.test(url) ? 'movie' : /^(series|episode)$/.test(kind) || /\/series\//i.test(url) ? 'episode' : 'live'
    const name = entry.name.slice(0, 200) || 'Untitled stream', group = (entry.category || 'Ungrouped').slice(0, 100)
    // Share group strings instead of retaining a fresh copy for every entry.
    if (!groups.has(group)) { groups.set(group, group); retained += group.length }
    retained += name.length + url.length + (logo?.length || 0) + (media.playback ? JSON.stringify(media.playback).length : 0)
    if (retained > MAX_RETAINED_CHARACTERS) throw new CatalogError('The catalog needs more memory than this TV budget allows. Request a category-specific playlist from your provider.')
    channels.push({ name, url, group: groups.get(group)!, mediaKind, ...(logo ? { logo } : {}), ...(media.playback ? { playback: media.playback } : {}) })
  })
  return {
    writeLine(raw: string) {
      if (raw.length > MAX_LINE_LENGTH) throw new CatalogError('The playlist contains an unusually long line. Check its format with your provider.')
      const line = raw.trim()
      if (!line) return
      if (!header) {
        if (!/^#EXTM3U(?:\s|:|$)/i.test(line)) throw new CatalogError('The provider did not return an M3U playlist. Check your address and login.')
        header = true
      }
      if (isHlsStreamManifest(line)) { hls = true; channels.length = 0 }
      if (!hls) parser.writeLine(line)
    },
    get hls() { return hls },
    progress: () => ({ channels: channels.length, skipped }),
    finish(): Catalog {
      if (hls) return { channels: [{ name: 'Direct stream', url: httpUrl(base), group: 'Streams' }], skipped: 0 }
      if (!header) throw new CatalogError('The provider did not return an M3U playlist. Check your address and login.')
      if (!channels.length) throw new CatalogError('No valid HTTP or HTTPS stream addresses were found in this playlist.')
      return { channels, skipped }
    },
  }
}

export function parseCatalog(text: string, base: string): Catalog {
  const parser = catalogParser(base)
  for (const line of text.split(/\r?\n/)) parser.writeLine(line)
  return parser.finish()
}

export async function loadCatalog(input: Source, signal: AbortSignal, onProgress: (progress: LoadProgress) => void = () => {}): Promise<Catalog> {
  const source = validateSource(input)
  if (signal.aborted) throw new CatalogError('Loading cancelled.')
  if (source.kind === 'direct') return { channels: [{ name: 'Direct stream', url: source.url, group: 'Streams' }], skipped: 0 }
  const url = playlistUrl(source)
  const request = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout>, timedOut = false, received = false
  const abort = () => { request.abort(); void reader?.cancel().catch(() => {}) }
  const active = () => {
    clearTimeout(timer)
    timer = setTimeout(() => { timedOut = true; abort() }, DOWNLOAD_IDLE_MS)
  }
  const check = () => {
    if (timedOut) throw new CatalogError('The provider stopped responding for 45 seconds. Check your network and try again.')
    if (signal.aborted) throw new CatalogError('Loading cancelled.')
  }
  signal.addEventListener('abort', abort, { once: true }); active()
  try {
    const response = await fetch(url, { signal: request.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
    received = true; clearTimeout(timer!); check()
    if (!response.body) throw new CatalogError('The TV could not read this playlist response.')
    reader = response.body.getReader()
    if (!response.ok) throw new CatalogError(`Provider returned HTTP ${response.status}. Check your address and login.`)
    const declared = Number(response.headers.get('content-length'))
    if (declared > MAX_BYTES) throw new CatalogError('Playlist exceeds the 256 MB download budget. Request a category-specific playlist from your provider.')
    // Content-Length can describe compressed bytes, so do not show an inaccurate percentage.
    const total = response.headers.get('content-encoding') || declared <= 0 ? null : declared
    const parser = catalogParser(response.url || url), decoder = new TextDecoder()
    let bytes = 0, pending = '', lastYield = performance.now(), lastProgress = -Infinity
    const progress = (force = false) => {
      if (force || performance.now() - lastProgress >= 150) { onProgress({ bytes, total, ...parser.progress() }); lastProgress = performance.now() }
    }
    progress(true)
    while (true) {
      active()
      const part = await reader.read(); clearTimeout(timer!); check()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > MAX_BYTES) throw new CatalogError('Playlist exceeds the 256 MB download budget. Request a category-specific playlist from your provider.')
      // A response can arrive in a single huge chunk. Decode only small slices,
      // and yield between work batches so Back/Cancel and rendering keep working.
      for (let offset = 0; offset < part.value.length; offset += 16384) {
        pending += decoder.decode(part.value.subarray(offset, offset + 16384), { stream: true })
        let start = 0, end: number
        while ((end = pending.indexOf('\n', start)) >= 0) {
          parser.writeLine(pending.slice(start, end)); start = end + 1
          if (parser.hls) return parser.finish()
        }
        pending = pending.slice(start)
        if (pending.length > MAX_LINE_LENGTH) throw new CatalogError('The playlist contains an unusually long line. Check its format with your provider.')
        if (performance.now() - lastYield >= 12) {
          progress(); await new Promise<void>(resolve => setTimeout(resolve, 0)); check(); lastYield = performance.now()
        }
      }
      progress()
    }
    parser.writeLine(pending + decoder.decode()); progress(true)
    return parser.finish()
  } catch (error) {
    check()
    if (error instanceof CatalogError) throw error
    throw new CatalogError(received ? 'Playlist download failed. Your previous catalog is unchanged. Try again.' : 'Cannot reach the playlist. Check the address, TV network, and provider access. The provider may need to allow cross-origin requests.')
  } finally {
    clearTimeout(timer!); signal.removeEventListener('abort', abort)
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock() }
    request.abort()
  }
}
