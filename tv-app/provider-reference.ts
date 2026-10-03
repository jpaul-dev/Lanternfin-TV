import type { Channel, Source } from './catalog'
import { mediaUrl } from './xtream'

/** A bookmark can rebuild its address from the separately saved account. No URL, header or license key is stored here. */
export type ProviderReference = { providerId: string; mediaKind: 'live' | 'movie' | 'series' | 'episode'; extension: string; name: string; group: string }
export function readProviderReference(value: unknown): ProviderReference | undefined {
  if (!value || typeof value !== 'object') return
  const item = value as ProviderReference
  if (typeof item.providerId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(item.providerId) ||
    !['live', 'movie', 'series', 'episode'].includes(item.mediaKind) || typeof item.extension !== 'string' || !/^[a-zA-Z0-9]{1,8}$/.test(item.extension) ||
    typeof item.name !== 'string' || item.name.length > 200 || typeof item.group !== 'string' || item.group.length > 100) return
  return { providerId: item.providerId, mediaKind: item.mediaKind, extension: item.extension, name: item.name, group: item.group }
}
export function referenceChannel(source: Source, reference: ProviderReference): Channel {
  return { name: reference.name, group: reference.group, mediaKind: reference.mediaKind, providerId: reference.providerId,
    url: reference.mediaKind === 'series' ? '' : mediaUrl(source, reference.mediaKind === 'episode' ? 'series' : reference.mediaKind, reference.providerId, reference.extension) }
}
export function channelReference(source: Source, channel: Channel): ProviderReference | undefined {
  if (source.kind !== 'xtream' || channel.playback) return
  let extension = channel.mediaKind === 'live' ? 'm3u8' : 'mp4'
  try { if (channel.url) extension = new URL(channel.url).pathname.match(/\.([a-zA-Z0-9]{1,8})$/)?.[1] || extension } catch { return }
  const reference = readProviderReference({ ...channel, name: channel.name.slice(0, 200), group: channel.group.slice(0, 100), extension })
  if (!reference) return
  // Only remember genuine account-derived addresses, never reinterpret an unrelated URL.
  return referenceChannel(source, reference).url === channel.url ? reference : undefined
}
