import { isHlsStreamManifest, parseM3U } from '../src/scripts/lib/m3u-parser'

export type Source = { kind: 'playlist' | 'xtream' | 'direct'; url: string; username: string; password: string }
export type Channel = { name: string; url: string; group: string }
export type Catalog = { channels: Channel[]; skipped: number }
export const MAX_BYTES = 8 * 1024 * 1024
const MAX_CHANNELS = 30000

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

export function parseCatalog(text: string, base: string): Catalog {
  if (isHlsStreamManifest(text)) return { channels: [{ name: 'Direct stream', url: httpUrl(base), group: 'Streams' }], skipped: 0 }
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('The provider did not return an M3U playlist. Check your address and login.')
  const entries = parseM3U(text).entries
  if (entries.length > MAX_CHANNELS) throw new Error('This playlist is too large for this preview. Use a smaller provider playlist (up to 30,000 entries).')
  const channels: Channel[] = []
  let skipped = 0
  for (const entry of entries) {
    // Header overrides and DRM need platform-specific support. Never silently ignore them.
    if (entry.drmScheme || entry.licenseKey || entry.userAgent || entry.referer || entry.url.includes('|')) { skipped++; continue }
    try { channels.push({ name: entry.name.slice(0, 200) || 'Untitled stream', url: httpUrl(entry.url, base), group: (entry.category || 'Ungrouped').slice(0, 100) }) }
    catch { skipped++ }
  }
  if (!channels.length) throw new Error('No supported streams found. This preview accepts HTTP/HTTPS streams without DRM or custom headers.')
  return { channels, skipped }
}

async function boundedText(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Playlist exceeds the 8 MB preview limit.')
  if (!response.body) throw new Error('The TV could not read this playlist response.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let length = 0, text = ''
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > MAX_BYTES) throw new Error('Playlist exceeds the 8 MB preview limit.')
      text += decoder.decode(part.value, { stream: true })
    }
    return text + decoder.decode()
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

export async function loadCatalog(input: Source, signal: AbortSignal): Promise<Catalog> {
  const source = validateSource(input)
  if (source.kind === 'direct') return { channels: [{ name: 'Direct stream', url: source.url, group: 'Streams' }], skipped: 0 }
  const url = playlistUrl(source)
  let response: Response
  try { response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' }) }
  catch { throw new Error(signal.aborted ? 'Loading was cancelled or timed out.' : 'Cannot reach the playlist. Check the address, TV network, and provider access. The provider may need to allow cross-origin requests.') }
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}. Check your address and login.`)
  let text: string
  try { text = await boundedText(response) }
  catch (error) {
    if (error instanceof Error && error.message.includes('preview limit')) throw error
    throw new Error('Playlist download failed or timed out. Try again.')
  }
  // Resolve relative entries against the final response URL after provider redirects.
  return parseCatalog(text, response.url || url)
}
