import { httpUrl, playlistUrl, validateSource, type Catalog, type Channel, type Source } from './catalog'
import { providerTimestamp } from './provider-date'
import { titleRating, titleYear } from './title-metadata'
import { providerRuntime, runtimeLabel } from './provider-runtime'

export type MediaKind = 'live' | 'movie' | 'series'
export type Category = { id: string; name: string }
export type TitleDetails = { channel: Channel; description: string; poster?: string; backdrop?: string; metadata: string[]; cast: string; director: string; episodes?: Channel[] }
const CATEGORY_ACTION = { live: 'get_live_categories', movie: 'get_vod_categories', series: 'get_series_categories' }
const STREAM_ACTION = { live: 'get_live_streams', movie: 'get_vod_streams', series: 'get_series' }
const ID = /^[A-Za-z0-9_-]{1,80}$/
class ProviderError extends Error {}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value.slice(0, 200) : fallback
function artwork(value: unknown): string | undefined { try { return typeof value === 'string' && value.length <= 2048 && value ? httpUrl(value) : undefined } catch { return undefined } }
function detailText(max: number, ...values: unknown[]) { return values.find(value => typeof value === 'string' && value.trim())?.toString().slice(0, max) || '' }
function detailArtwork(...values: unknown[]) { for (const value of values) { for (const item of Array.isArray(value) ? value.slice(0, 8) : [value]) { const safe = artwork(item); if (safe) return safe } } }
function identifier(value: unknown): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new ProviderError('The provider returned an invalid item identifier.')
  const id = typeof value === 'number' || typeof value === 'string' ? String(value) : ''
  if (!ID.test(id)) throw new ProviderError('The provider returned an invalid item identifier.')
  return id
}
export function apiUrl(input: Source, action: string, params: Record<string, string> = {}): string {
  const source = validateSource(input)
  if (source.kind !== 'xtream') throw new ProviderError('Choose an Xtream account first.')
  const url = new URL(playlistUrl(source)); url.pathname = url.pathname.replace(/get\.php$/, 'player_api.php')
  url.search = ''; url.searchParams.set('username', source.username); url.searchParams.set('password', source.password)
  if (action) url.searchParams.set('action', action)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.href
}
export function mediaUrl(source: Source, kind: 'live' | 'movie' | 'series', id: string, extension: unknown): string {
  const url = new URL(playlistUrl(validateSource(source)))
  const ext = typeof extension === 'string' && /^[a-zA-Z0-9]{1,8}$/.test(extension) ? extension : kind === 'live' ? 'm3u8' : 'mp4'
  url.pathname = url.pathname.replace(/get\.php$/, '') + `${kind}/${encodeURIComponent(source.username)}/${encodeURIComponent(source.password)}/${identifier(id)}.${ext}`
  url.search = ''; return httpUrl(url.href)
}

export async function request(source: Source, action: string, signal: AbortSignal, params: Record<string, string> = {}, maxBytes = 32 * 1024 * 1024): Promise<unknown> {
  if (signal.aborted) throw new ProviderError('Loading cancelled.')
  const controller = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: ReturnType<typeof setTimeout>, timedOut = false
  const abort = () => { controller.abort(); void reader?.cancel().catch(() => {}) }
  const active = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; abort() }, 45000) }
  const check = () => { if (signal.aborted) throw new ProviderError('Loading cancelled.'); if (timedOut) throw new ProviderError('The provider stopped responding. Try this category again.') }
  signal.addEventListener('abort', abort, { once: true }); active()
  try {
    const response = await fetch(apiUrl(source, action, params), { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
    clearTimeout(timer!); check()
    if (response.body) reader = response.body.getReader()
    if (!response.ok) throw new ProviderError(`Provider returned HTTP ${response.status}. Check your login or try again.`)
    if (!reader) throw new ProviderError('The TV could not read the provider response.')
    if (Number(response.headers.get('content-length')) > maxBytes) throw new ProviderError('This provider category is unusually large. Use a narrower category or its M3U playlist.')
    const decoder = new TextDecoder(); let bytes = 0, body = ''
    while (true) {
      active(); const next = await reader.read(); clearTimeout(timer!); check()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > maxBytes) throw new ProviderError('This provider category is unusually large. Use a narrower category or its M3U playlist.')
      body += decoder.decode(next.value, { stream: true })
    }
    body += decoder.decode(); check()
    try { return JSON.parse(body) } catch { throw new ProviderError('The provider did not return valid account data. Check the server address, or try the M3U compatibility option.') }
  } catch (error) {
    check()
    if (error instanceof ProviderError) throw error
    throw new ProviderError('Cannot reach this provider. Check the TV network, account, and cross-origin access. You can retry or use the M3U compatibility option.')
  } finally {
    clearTimeout(timer!); signal.removeEventListener('abort', abort)
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock() }
    controller.abort()
  }
}
function rows(value: unknown, alternatives: string[]): unknown[] {
  if (Array.isArray(value)) return value
  const object = record(value)
  for (const key of alternatives) if (Array.isArray(object[key])) return object[key] as unknown[]
  if (String(record(object.user_info).auth) === '0') throw new ProviderError('The provider did not accept this account. Check your username and password.')
  throw new ProviderError('The provider returned an unexpected catalog format. Try its M3U compatibility option.')
}
export async function loadCategories(source: Source, kind: MediaKind, signal: AbortSignal): Promise<Category[]> {
  const data = rows(await request(source, CATEGORY_ACTION[kind], signal, {}, 4 * 1024 * 1024), ['categories', 'results'])
  const result: Category[] = [], seen = new Set<string>()
  for (const value of data) {
    const row = record(value)
    try { const id = identifier(row.category_id); if (!seen.has(id)) { seen.add(id); result.push({ id, name: text(row.category_name, 'Unnamed category') }) } } catch { /* Ignore malformed categories. */ }
  }
  return result
}
export async function loadCategory(source: Source, kind: MediaKind, category: Category, signal: AbortSignal): Promise<Catalog> {
  const data = rows(await request(source, STREAM_ACTION[kind], signal, { category_id: identifier(category.id) }), ['streams', 'movies', 'series', 'results'])
  const channels: Channel[] = []; let skipped = 0
  for (let index = 0; index < data.length; index++) {
    if (signal.aborted) throw new ProviderError('Loading cancelled.')
    const row = record(data[index])
    try {
      const id = identifier(kind === 'series' ? row.series_id : row.stream_id)
      const addedAt = kind === 'live' ? undefined : providerTimestamp(row.added) ?? (kind === 'series' ? providerTimestamp(row.last_modified) : undefined)
      const rating = titleRating(row.rating, row.rating_5based), year = titleYear(row.year) || titleYear(row.releaseDate || row.releasedate)
      const facts = kind === 'live' ? {} : { categoryId: category.id, ...(rating !== undefined ? { rating } : {}), ...(year ? { year } : {}) }
      channels.push({ name: text(row.name, 'Untitled'), group: category.name, url: kind === 'series' ? '' : mediaUrl(source, kind, id, kind === 'live' ? 'm3u8' : row.container_extension), mediaKind: kind, providerId: id, logo: artwork(row.stream_icon || row.cover), description: text(row.plot), ...facts, ...(addedAt ? { addedAt } : {}), ...(kind === 'live' && Number(row.tv_archive) === 1 ? { tvArchive: 1, tvArchiveDuration: Math.max(1, Math.min(30, Number(row.tv_archive_duration) || 7)) } : {}) })
    } catch { skipped++ }
    if (index && index % 1000 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  return { channels, skipped }
}
function parseEpisodes(source: Source, series: Channel, response: Record<string, unknown>): Catalog {
  const episodes = response.episodes, seasons = Array.isArray(episodes) ? { '1': episodes } : record(episodes)
  const channels: Array<Channel & { season: number; episode: number }> = []; let skipped = 0
  for (const [seasonKey, values] of Object.entries(seasons)) {
    if (!Array.isArray(values)) continue
    for (const value of values) {
      const row = record(value)
      try {
        const id = identifier(row.id), season = Number(row.season ?? seasonKey), episode = Number(row.episode_num)
        if (!Number.isSafeInteger(season) || season < 0 || !Number.isSafeInteger(episode) || episode < 0) { skipped++; continue }
        const info = record(row.info), durationSeconds = providerRuntime(info.duration_secs, info.duration) ?? providerRuntime(row.duration_secs, row.duration)
        channels.push({ name: `S${season} E${episode} · ${detailText(200, row.title, info.name, series.name)}`, group: `Season ${season}`, url: mediaUrl(source, 'series', id, row.container_extension), mediaKind: 'episode', providerId: id, seriesId: series.providerId, seriesName: series.name, description: detailText(600, info.plot, info.description, row.plot, row.description), logo: detailArtwork(info.movie_image, info.cover, row.movie_image, series.logo), ...(durationSeconds ? { durationSeconds } : {}), season, episode })
      } catch { skipped++ }
    }
  }
  channels.sort((a, b) => a.season - b.season || a.episode - b.episode)
  return { channels, skipped }
}
export async function loadEpisodes(source: Source, series: Channel, signal: AbortSignal): Promise<Catalog> {
  return parseEpisodes(source, series, record(await request(source, 'get_series_info', signal, { series_id: identifier(series.providerId) }, 8 * 1024 * 1024)))
}
export function basicDetails(channel: Channel): TitleDetails {
  return { channel, description: channel.description || '', poster: channel.logo, metadata: [channel.year, channel.rating ? `${channel.rating.toFixed(1)} / 10` : '', channel.group].filter(Boolean) as string[], cast: '', director: '' }
}
export async function loadTitleDetails(source: Source, channel: Channel, signal: AbortSignal): Promise<TitleDetails> {
  if (source.kind !== 'xtream' || !channel.providerId || !['movie', 'series'].includes(channel.mediaKind || '')) return basicDetails(channel)
  const series = channel.mediaKind === 'series'
  const response = record(await request(source, series ? 'get_series_info' : 'get_vod_info', signal, { [series ? 'series_id' : 'vod_id']: identifier(channel.providerId) }, 8 * 1024 * 1024))
  const info = record(response.info), data = series ? {} : record(response.movie_data), details = basicDetails(channel)
  details.description = detailText(4000, info.plot, info.description, data.plot, data.description, details.description)
  details.poster = detailArtwork(info.movie_image, info.cover, data.movie_image, data.cover, channel.logo)
  details.backdrop = detailArtwork(info.backdrop_path, data.backdrop_path)
  details.cast = detailText(200, info.cast, info.actors, data.cast, data.actors); details.director = detailText(200, info.director, data.director)
  const year = [info.releasedate, info.releaseDate, info.year, data.releasedate, data.releaseDate, data.year, channel.year].map(titleYear).find(Boolean)
  const rating = titleRating(info.rating, info.rating_5based) ?? titleRating(data.rating, data.rating_5based) ?? channel.rating
  const duration = runtimeLabel(providerRuntime(info.duration_secs, info.duration) ?? providerRuntime(data.duration_secs, data.duration) ?? channel.durationSeconds) || detailText(64, info.duration, data.duration), genre = detailText(200, info.genre, data.genre)
  details.metadata = [year, genre || channel.group, duration, rating ? `${rating.toFixed(1)} / 10` : ''].filter(Boolean) as string[]
  if (series) details.episodes = parseEpisodes(source, channel, response).channels
  return details
}
