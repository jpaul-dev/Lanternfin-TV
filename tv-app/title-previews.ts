import type { Channel, Source } from './catalog'
import { parentSeries } from './episode-context'
import { loadTitleDetails, type TitleDetails } from './xtream'

type Preview = Omit<TitleDetails, 'channel' | 'episodes'>
type Entry = { preview?: Preview; expires: number; size: number }
const MAX_ENTRIES = 40, MAX_CHARACTERS = 256 * 1024, TTL = 15 * 60000, FAILURE_TTL = 30000
/** One active provider lookup, source-scoped LRU, no episodes or persistent data. */
export class TitlePreviews {
  private entries = new Map<string, Entry>()
  private characters = 0
  private loading?: AbortController
  constructor(private source: Source) {}
  cancel() { this.loading?.abort(); this.loading = undefined }
  clear() { this.cancel(); this.entries.clear(); this.characters = 0 }
  private target(channel: Channel) { return channel.mediaKind === 'episode' ? parentSeries(channel) : channel }
  private key(channel: Channel): string | undefined {
    const target = this.target(channel)
    if (this.source.kind !== 'xtream' || !target || !['movie', 'series'].includes(target.mediaKind || '') || !/^[A-Za-z0-9_-]{1,80}$/.test(target.providerId || '')) return
    return `${target.mediaKind}:${target.providerId}`
  }
  private remove(key: string) { this.characters -= this.entries.get(key)?.size || 0; this.entries.delete(key) }
  private cached(key: string) {
    const entry = this.entries.get(key)
    if (entry && entry.expires <= Date.now()) { this.remove(key); return }
    if (entry) { this.entries.delete(key); this.entries.set(key, entry) }
    return entry
  }
  private put(key: string, preview?: Preview) {
    this.remove(key)
    const size = JSON.stringify(preview || {}).length + key.length
    if (size > MAX_CHARACTERS) return
    this.entries.set(key, { preview, size, expires: Date.now() + (preview ? TTL : FAILURE_TTL) }); this.characters += size
    while (this.entries.size > MAX_ENTRIES || this.characters > MAX_CHARACTERS) this.remove(this.entries.keys().next().value!)
  }
  private details(channel: Channel, preview?: Preview): TitleDetails | undefined {
    return preview && { ...preview, metadata: [...preview.metadata], channel }
  }
  read(channel: Channel) { const key = this.key(channel); return key ? this.details(channel, this.cached(key)?.preview) : undefined }
  remember(details: TitleDetails) {
    const key = this.key(details.channel)
    if (!key) return
    // Copy only bounded preview data. Never retain a series episode collection.
    this.put(key, { description: details.description.slice(0, 4000), poster: details.poster, backdrop: details.backdrop, metadata: details.metadata.slice(0, 8).map(text => text.slice(0, 200)), cast: details.cast.slice(0, 200), director: details.director.slice(0, 200) })
  }
  async load(channel: Channel, signal: AbortSignal): Promise<TitleDetails | undefined> {
    if (signal.aborted) throw new Error('Title preview cancelled.')
    const key = this.key(channel)
    if (!key) return
    const cached = this.cached(key)
    if (cached) return this.details(channel, cached.preview)
    this.cancel()
    const controller = new AbortController(); this.loading = controller
    const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true })
    try {
      const result = await loadTitleDetails(this.source, this.target(channel)!, controller.signal, true)
      if (controller.signal.aborted || this.loading !== controller) throw new Error('Title preview cancelled.')
      this.remember(result); return this.read(channel)
    } catch (error) {
      if (!controller.signal.aborted && this.loading === controller) this.put(key)
      throw error
    } finally { signal.removeEventListener('abort', abort); if (this.loading === controller) this.loading = undefined }
  }
}
