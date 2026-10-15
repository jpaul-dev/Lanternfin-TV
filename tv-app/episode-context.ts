import type { Channel, Source } from './catalog'
import { channelId } from './library'
import { loadEpisodes } from './xtream'

export function parentSeries(channel: Channel): Channel | undefined {
  if (channel.mediaKind !== 'episode' || !channel.seriesId || !/^[A-Za-z0-9_-]{1,80}$/.test(channel.seriesId)) return
  return { name: channel.seriesName || 'Series', group: '', url: '', mediaKind: 'series', providerId: channel.seriesId }
}
/** A single series per session; late account/episode responses cannot replace a newer queue. */
export class EpisodeContext {
  items: Channel[] = []
  private pending?: AbortController
  private source?: Source
  cancel() { this.pending?.abort(); this.pending = undefined }
  clear() { this.cancel(); this.items = []; this.source = undefined }
  async load(source: Source, current: Channel, known?: Channel[]) {
    this.cancel()
    if (this.source !== source) { this.items = []; this.source = source }
    const contains = (items: Channel[]) => items.some(item => channelId(item) === channelId(current))
    if (known && contains(known)) { this.items = known; return }
    if (contains(this.items)) return
    this.items = []
    const parent = parentSeries(current)
    if (!parent || source.kind !== 'xtream') return
    const controller = new AbortController(); this.pending = controller
    try { const result = await loadEpisodes(source, parent, controller.signal); if (this.pending === controller && !controller.signal.aborted && contains(result.channels)) this.items = result.channels }
    finally { if (this.pending === controller) this.pending = undefined }
  }
}
