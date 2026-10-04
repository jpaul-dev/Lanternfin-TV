import type { Channel } from './catalog'
import { channelId } from './library'

/** Top twelve in provider order for ties; bounded memory even for huge libraries. */
export class NewestTitles {
  private entries: { channel: Channel; at: number; id: string }[] = []
  add(channel: Channel, at = channel.addedAt) {
    if (!at || !Number.isFinite(at) || at <= 0) return
    if (this.entries.length === 12 && at <= this.entries[11].at) return
    const id = channelId(channel), previous = this.entries.findIndex(entry => entry.id === id)
    if (previous >= 0) { if (this.entries[previous].at >= at) return; this.entries.splice(previous, 1) }
    let index = this.entries.length
    while (index && this.entries[index - 1].at < at) index--
    this.entries.splice(index, 0, { channel, at, id })
    if (this.entries.length > 12) this.entries.pop()
  }
  get channels() { return this.entries.map(entry => entry.channel) }
}
