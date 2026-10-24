import type { Source } from './catalog'
import { sourceKey } from '../shared/home-protocol.mjs'
import { homeEnabled, homeHasRow, homePublish } from '../src/scripts/lib/home-client'

export function homeSource(source: Source, title = 'Shared library') {
  if (source.kind === 'direct') return undefined
  return source.kind === 'xtream' ? { type: 'xtream', serverUrl: source.url.replace(/\/+$/, ''), username: source.username, password: source.password, title, liveContainer: 'm3u8' } : { type: 'm3u', url: source.url, title }
}
export function shareTVSource(source: Source, title?: string, remove = false): void {
  if (!homeEnabled()) return
  const entry = homeSource(source, title)
  if (entry) homePublish(`source/${sourceKey(entry)}`, remove ? null : entry)
}
export function shareTVProgress(source: Source, id: string, kind: string, value: unknown): void {
  if (!homeEnabled() || source.kind !== 'xtream' || !['movie', 'episode'].includes(kind)) return
  const entry = homeSource(source)!, key = sourceKey(entry)
  if (!homeHasRow(`source/${key}`)) homePublish(`source/${key}`, entry)
  homePublish(`progress/${key}/${kind === 'movie' ? 'vod' : 'episode'}/${id}`, value)
}
