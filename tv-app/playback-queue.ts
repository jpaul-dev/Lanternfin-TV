import type { Channel } from './catalog'
import { channelId } from './library'

export class LiveQueue {
  private items: Channel[] = []
  private index = -1
  reset(pool: Channel[], current: Channel, include?: (channel: Channel) => boolean, resolve?: (channel: Channel) => Channel | undefined) {
    const seen = new Set<string>()
    this.items = []
    for (const original of pool) {
      const channel = resolve ? resolve(original) : original
      if (channel?.mediaKind === 'live' && (!include || include(channel)) && !seen.has(channelId(channel))) { seen.add(channelId(channel)); this.items.push(channel) }
    }
    this.index = this.items.findIndex(channel => channelId(channel) === channelId(current))
    if (current.mediaKind === 'live' && this.index < 0) { this.index = this.items.length; this.items.push(current) }
  }
  get length() { return this.items.length }
  get number() { return this.index + 1 }
  step(delta: number) { if (!this.items.length) return; this.index = (this.index + delta + this.items.length) % this.items.length; return this.items[this.index] }
  tune(digits: string) { if (!/^\d{1,6}$/.test(digits)) return; const index = Number(digits) - 1; if (index < 0 || index >= this.items.length) return; this.index = index; return this.items[index] }
}
export function nextEpisode(items: Channel[] | undefined, current?: Channel) {
  if (!current || current.mediaKind !== 'episode' || !items) return
  const index = items.findIndex(channel => channelId(channel) === channelId(current))
  return index >= 0 ? items[index + 1] : undefined
}
