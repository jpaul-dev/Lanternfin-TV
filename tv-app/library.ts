import type { Channel, Source } from './catalog'

export type Recent = { id: string; at: number; position: number; duration: number }
const PREFIX = 'lanternfin.tv.library.v1.'
const MAX_FAVORITES = 2000, MAX_RECENT = 100
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{16}$/.test(value)

// Stable lookup identifiers, not encryption. Never persist provider URLs,
// usernames, passwords, or channel names in the library record.
export function libraryId(value: string): string {
  let a = 2166136261, b = 5381
  for (let index = 0; index < value.length; index++) {
    const char = value.charCodeAt(index)
    a = Math.imul(a ^ char, 16777619); b = Math.imul(b, 33) ^ char
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}
export const channelId = (channel: Channel) => libraryId(channel.url)

export class TVLibrary {
  readonly favorites = new Set<string>()
  readonly recent = new Map<string, Recent>()
  private readonly key: string
  constructor(private storage: Storage | null, source: Source) {
    this.key = PREFIX + libraryId(JSON.stringify(source))
    try {
      const raw = storage?.getItem(this.key)
      if (!raw || raw.length > 200000) return
      const data = JSON.parse(raw)
      if (Array.isArray(data.favorites)) for (const id of data.favorites.slice(0, MAX_FAVORITES)) if (validId(id)) this.favorites.add(id)
      if (Array.isArray(data.recent)) for (const item of data.recent.slice(0, MAX_RECENT).reverse()) {
        if (!item || !validId(item.id) || ![item.at, item.position, item.duration].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) continue
        if (item.position > item.duration || item.at > Date.now() + 86400000) continue
        this.recent.set(item.id, { id: item.id, at: item.at, position: item.position, duration: item.duration })
      }
    } catch { /* A broken or unavailable store still permits session use. */ }
  }
  isFavorite(channel: Channel) { return this.favorites.has(channelId(channel)) }
  lastPlayed(channel: Channel) { return this.recent.get(channelId(channel)) }
  toggleFavorite(channel: Channel): boolean {
    const id = channelId(channel)
    if (this.favorites.has(id)) this.favorites.delete(id)
    else {
      if (this.favorites.size >= MAX_FAVORITES) throw new Error('Your favorites list is full (2,000). Remove a favorite before adding another.')
      this.favorites.add(id)
    }
    this.save(); return this.favorites.has(id)
  }
  record(channel: Channel, position = 0, duration = 0, ended = false) {
    const id = channelId(channel)
    const vod = Number.isFinite(duration) && duration > 60 && Number.isFinite(position) && position >= 15 && position < duration - 15 && !ended
    this.recent.delete(id)
    this.recent.set(id, { id, at: Date.now(), position: vod ? position : 0, duration: vod ? duration : 0 })
    while (this.recent.size > MAX_RECENT) this.recent.delete(this.recent.keys().next().value!)
    this.save()
  }
  clearHistory() { this.recent.clear(); this.save() }
  setStorage(storage: Storage | null) { this.storage = storage; this.save() }
  private save() {
    this.storage?.setItem(this.key, JSON.stringify({ favorites: [...this.favorites], recent: [...this.recent.values()].reverse() }))
  }
}

export function forgetLibraries(storage: Storage) {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index++) { const key = storage.key(index); if (key?.startsWith(PREFIX)) keys.push(key) }
  for (const key of keys) storage.removeItem(key)
}

export function durationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds), hours = Math.floor(total / 3600), minutes = Math.floor(total / 60) % 60
  return `${hours ? hours + ':' + String(minutes).padStart(2, '0') : minutes}:${String(total % 60).padStart(2, '0')}`
}
