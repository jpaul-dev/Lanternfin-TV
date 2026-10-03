import { request } from './xtream'
import type { Channel, Source } from './catalog'
import { maybeB64ToUtf8 } from '../src/scripts/lib/b64-utf8'
import { XMLTVGuide } from './xmltv'
import { guideOffset, channelGuideShift } from './guide-offset'

export type Programme = { start: number; stop: number; title: string; description: string; archive?: boolean; catchupId?: string; guideShiftMinutes?: number }
export type GuideWindow = { fromMs: number; toMs: number }
const cleanText = (value: unknown, max: number) => {
  if (typeof value !== 'string') return ''
  const raw = value.slice(0, max * 2), decoded = maybeB64ToUtf8(raw)
  return (/[\u0000-\u0008\u000e-\u001f\ufffd]/.test(decoded) ? raw : decoded).slice(0, max)
}
/** Uses the same timestamp and base64 conventions as the Android short-EPG client. */
export function programmes(value: unknown, now = Date.now(), window?: GuideWindow): Programme[] {
  if (!Array.isArray(value)) return []
  const result: Programme[] = [], seen = new Set<string>()
  for (const row of value.slice(0, 5000)) {
    if (!row || typeof row !== 'object') continue
    const start = Number(row.start_timestamp ?? row.start) * 1000, stop = Number(row.stop_timestamp ?? row.stop ?? row.end_timestamp ?? row.end) * 1000
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start || stop < now - 7 * 86400000 || start > now + 7 * 86400000) continue
    if (window && (stop <= window.fromMs || start >= window.toMs)) continue
    const title = cleanText(row.title ?? row.title_raw, 300) || 'Untitled programme', key = `${start}:${stop}:${title}`
    if (seen.has(key)) continue
    seen.add(key); result.push({ start, stop, title, description: cleanText(row.description ?? row.description_raw, 4000), ...(row.has_archive !== undefined ? { archive: Number(row.has_archive) === 1 } : {}) })
  }
  return boundProgrammes(result, now)
}
export function boundProgrammes<T extends { start: number; stop: number }>(items: T[], now = Date.now()): T[] {
  if (items.length > 512) items.sort((a, b) => Math.max(a.start - now, now - a.stop, 0) - Math.max(b.start - now, now - b.stop, 0))
  return items.slice(0, 512).sort((a, b) => a.start - b.start)
}
export function nowNext(items: Programme[], now = Date.now()) {
  return { current: items.find(item => item.start <= now && item.stop > now), next: items.find(item => item.start > now) }
}
export function timeRange(item: Programme, clock = 'auto') { const format = (value: number) => new Date(value + (clock === 'auto' ? 0 : Number(clock) * 60000)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(clock === 'auto' ? {} : { timeZone: 'UTC' }) }); return `${format(item.start)} – ${format(item.stop)}` }
export function guideDate(value: number, clock = 'auto') { return new Date(value + (clock === 'auto' ? 0 : Number(clock) * 60000)).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric', ...(clock === 'auto' ? {} : { timeZone: 'UTC' }) }) }

export class TVGuide {
  private cache = new Map<string, { at: number; items: Programme[] }>()
  private xml?: XMLTVGuide
  private xmlLoaded = Date.now()
  private revision = 0
  private offset: number
  constructor(private source: Source, private epgUrl?: string, offset = 0) { this.offset = guideOffset(offset); if (epgUrl) this.xml = new XMLTVGuide(epgUrl) }
  setOffset(value: number) { const next = guideOffset(value); if (next !== this.offset) { this.offset = next; this.revision++; this.cache.clear() } }
  clear() { this.revision++; this.cache.clear(); this.xml?.close() }
  async load(channel: Channel, signal: AbortSignal, refresh = false, window?: GuideWindow): Promise<Programme[]> {
    if (signal.aborted) throw new Error('Guide loading cancelled.')
    if (channel.mediaKind && channel.mediaKind !== 'live') return []
    if (this.epgUrl && (refresh || Date.now() - this.xmlLoaded > 6 * 3600000)) { this.xml?.close(); this.xml = new XMLTVGuide(this.epgUrl); this.xmlLoaded = Date.now(); this.cache.clear() }
    const revision = this.revision, minutes = this.offset + channelGuideShift(channel.tvgShift), shift = minutes * 60000, now = Date.now() - shift
    const rawWindow = window && { fromMs: window.fromMs - shift, toMs: window.toMs - shift }
    const finish = (items: Programme[]) => {
      if (signal.aborted || revision !== this.revision) throw new Error('Guide loading cancelled.')
      const corrected = minutes ? items.map(item => ({ ...item, start: item.start + shift, stop: item.stop + shift, guideShiftMinutes: minutes })) : items
      this.save(key, corrected); return corrected
    }
    const id = channel.providerId || channel.tvgId || channel.name, key = `${id}:${minutes}:${window ? `${window.fromMs}:${window.toMs}` : 'now'}`, cached = this.cache.get(key)
    if (!refresh && cached && Date.now() - cached.at < 3 * 60000) { this.cache.delete(key); this.cache.set(key, cached); return cached.items }
    if (this.xml) {
      const range = rawWindow || { fromMs: now - 86400000, toMs: now + 3 * 86400000 }
      const rows = await this.xml.load(channel.tvgId, channel.name, signal, range)
      const items = boundProgrammes(rows.filter(row => row.stop > range.fromMs && row.start < range.toMs), now).map(row => ({ start: row.start, stop: row.stop, title: row.title.slice(0, 300), description: row.desc.slice(0, 4000), ...(row.catchupId && row.catchupId.length <= 8192 ? { catchupId: row.catchupId } : {}) }))
      return finish(items)
    }
    if (this.source.kind !== 'xtream' || !channel.providerId) return []
    let items: Programme[] = [], succeeded = false
    for (const action of ['get_simple_data_table', 'get_simple_date_table', 'get_short_epg']) {
      try {
        const response = await request(this.source, action, signal, { stream_id: id, ...(action === 'get_short_epg' ? { limit: '24' } : {}) }, 2 * 1024 * 1024) as { epg_listings?: unknown }
        if (signal.aborted) throw new Error('Guide loading cancelled.')
        const rows = Array.isArray(response) ? response : response?.epg_listings
        if (!Array.isArray(rows)) continue
        succeeded = true; items = programmes(rows, now, rawWindow)
        if (items.length) break
      } catch { if (signal.aborted) throw new Error('Guide loading cancelled.') }
    }
    if (!succeeded) throw new Error('Programme guide unavailable. Check your provider or try again.')
    return finish(items)
  }
  private save(key: string, items: Programme[]) { this.cache.delete(key); this.cache.set(key, { at: Date.now(), items }); while (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!) }
}
