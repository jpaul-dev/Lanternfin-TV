import { SubtitleError, assText, type SubtitleCue } from './external-subtitles'
import { plainCaptionText } from './caption-text'

// Matroska EBML IDs and byte/time rules: https://www.matroska.org/technical/elements.html
export const MKV = { ebml: 0x1a45dfa3, segment: 0x18538067, info: 0x1549a966, tracks: 0x1654ae6b, cues: 0x1c53bb6b, seek: 0x114d9b74, cluster: 0x1f43b675 }
export const MKV_METADATA_BYTES = 8 * 1024 * 1024
const MAX_TIME = 7 * 24 * 3600
const bad = () => new SubtitleError('This MKV has unsupported, oversized or malformed subtitle data.')
export type EbmlElement = { id: number; data: number; end?: number; size?: number }
export function ebmlVint(bytes: Uint8Array, at = 0, id = false): { value: number; width: number; unknown: boolean } {
  const first = bytes[at]; if (!first) throw bad()
  let width = 1; while (width <= 8 && !(first & (128 >> (width - 1)))) width++
  if (width > (id ? 4 : 8) || at + width > bytes.length) throw bad()
  let value = id ? first : first & ((128 >> (width - 1)) - 1), unknown = !id && value === (128 >> (width - 1)) - 1
  for (let i = 1; i < width; i++) { value = value * 256 + bytes[at + i]; unknown = unknown && bytes[at + i] === 255 }
  if (!unknown && !Number.isSafeInteger(value)) throw bad()
  return { value, width, unknown }
}
export function ebmlHeader(bytes: Uint8Array, at = 0): EbmlElement {
  const id = ebmlVint(bytes, at, true), size = ebmlVint(bytes, at + id.width), data = at + id.width + size.width
  if (size.unknown) return { id: id.value, data }
  if (!Number.isSafeInteger(data + size.value)) throw bad()
  return { id: id.value, data, size: size.value, end: data + size.value }
}
export function* ebmlElements(bytes: Uint8Array): Generator<EbmlElement & { end: number; size: number }> {
  let count = 0
  for (let at = 0; at < bytes.length;) {
    const item = ebmlHeader(bytes, at)
    if (++count > 100000 || item.end === undefined || item.end > bytes.length) throw bad()
    yield item as EbmlElement & { end: number; size: number }; at = item.end
  }
}
const elements = ebmlElements
export function ebmlUint(bytes: Uint8Array): number {
  if (bytes.length > 8) throw bad()
  let value = 0; for (const byte of bytes) value = value * 256 + byte
  if (!Number.isSafeInteger(value)) throw bad(); return value
}
function fields(bytes: Uint8Array, repeated: number[] = []) {
  const values = new Map<number, Uint8Array[]>()
  for (const item of elements(bytes)) {
    if ([0xec, 0xbf].includes(item.id)) continue
    if (values.has(item.id) && !repeated.includes(item.id)) throw bad()
    const all = values.get(item.id) || []; all.push(bytes.subarray(item.data, item.end)); values.set(item.id, all)
  }
  return values
}
const uint = (map: Map<number, Uint8Array[]>, id: number, fallback?: number) => { const bytes = map.get(id)?.[0]; if (!bytes && fallback === undefined) throw bad(); return bytes ? ebmlUint(bytes) : fallback! }
function text(bytes?: Uint8Array, limit = 256): string {
  if (!bytes) return ''
  if (bytes.length > limit) throw bad()
  let value: string; try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw bad() }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw bad()
  return value.replace(/\r\n?/g, '\n')
}
function elementText(bytes?: Uint8Array, limit = 256): string {
  if (!bytes) return ''
  if (bytes.length > limit) throw bad()
  // EBML string elements terminate at NUL (RFC 8794, section 13).
  // Binary codec data and subtitle payloads still use the strict decoder.
  const end = bytes.indexOf(0)
  return text(end < 0 ? bytes : bytes.subarray(0, end), limit)
}
export type MkvCue = { start: number; end?: number; cluster: number; relative?: number; block: number }
export type MkvTextTrack = { id: number; language: string; name: string; codec: string; wrap: number; defaultDuration?: number; samples: MkvCue[] }
export type MkvMetadataInput = { info: Uint8Array; tracks: Uint8Array; cues: Uint8Array; segment: number; end: number }
export function parseMkvMetadata(input: MkvMetadataInput) {
  if (input.info.length > 65536 || input.tracks.length > 512 * 1024 || input.cues.length > MKV_METADATA_BYTES || !Number.isSafeInteger(input.segment) || !Number.isSafeInteger(input.end) || input.segment < 0 || input.end <= input.segment) throw bad()
  const scale = uint(fields(input.info), 0x2ad7b1, 1000000) / 1e9
  if (!(scale > 0) || scale > 1) throw bad()
  const tracks: MkvTextTrack[] = [], ids = new Set<number>()
  for (const item of elements(input.tracks)) {
    if (item.id !== 0xae) continue
    const entry = fields(input.tracks.subarray(item.data, item.end), [0x41e4, 0x6624]), id = uint(entry, 0xd7)
    if (!id || ids.has(id) || ids.size >= 256) throw bad(); ids.add(id)
    if (uint(entry, 0x83) !== 17 || !uint(entry, 0xb9, 1)) continue
    const codec = elementText(entry.get(0x86)?.[0])
    if (!['S_TEXT/UTF8', 'S_TEXT/ASS', 'S_TEXT/SSA', 'S_TEXT/WEBVTT'].includes(codec) || entry.has(0x6d80)) continue // No decompression, encryption or header stripping.
    if (uint(entry, 0x56aa, 0) || uint(entry, 0x537f, 0)) continue
    const rate = entry.get(0x23314f)?.[0]
    if (rate && (![4, 8].includes(rate.length) || (rate.length === 4 ? new DataView(rate.buffer, rate.byteOffset, rate.byteLength).getFloat32(0) : new DataView(rate.buffer, rate.byteOffset, rate.byteLength).getFloat64(0)) !== 1)) continue
    const privateText = codec === 'S_TEXT/ASS' || codec === 'S_TEXT/SSA' ? text(entry.get(0x63a2)?.[0], 65536) : ''
    const wrap = Number(/^WrapStyle\s*:\s*([0-3])\s*$/im.exec(privateText)?.[1] || 0), duration = uint(entry, 0x23e383, 0) / 1e9
    if (tracks.length >= 16 || duration > MAX_TIME) throw bad()
    tracks.push({ id, codec, wrap, language: elementText(entry.get(0x22b59d)?.[0] || entry.get(0x22b59c)?.[0], 80) || 'eng', name: elementText(entry.get(0x536e)?.[0], 240).slice(0, 120), defaultDuration: duration || undefined, samples: [] })
  }
  const byId = new Map(tracks.map(track => [track.id, track])), keys = new Set<string>(); let count = 0
  for (const item of elements(input.cues)) {
    if (item.id !== 0xbb) continue
    const cue = fields(input.cues.subarray(item.data, item.end), [0xb7]), start = uint(cue, 0xb3) * scale
    if (!Number.isFinite(start) || start > MAX_TIME) throw bad()
    for (const position of cue.get(0xb7) || []) {
      if (++count > 100000) throw bad()
      const place = fields(position), track = byId.get(uint(place, 0xf7)); if (!track) continue
      // A midstream codec change cannot safely use the initial track configuration.
      if (uint(place, 0xea, 0)) throw new SubtitleError('This MKV changes subtitle codecs during playback. Use the native player or an external subtitle file.')
      const cluster = input.segment + uint(place, 0xf1), duration = place.has(0xb2) ? uint(place, 0xb2) * scale : undefined
      const relative = place.has(0xf0) ? uint(place, 0xf0) : undefined, block = uint(place, 0x5378, 1)
      if (!Number.isSafeInteger(cluster) || cluster < input.segment || cluster >= input.end || relative !== undefined && (!Number.isSafeInteger(cluster + relative) || cluster + relative >= input.end) || !block || block > 100000 || duration !== undefined && (!Number.isFinite(duration) || duration <= 0 || start + duration > MAX_TIME) || track.samples.length >= 20000) throw bad()
      const key = `${track.id}:${cluster}:${relative ?? 'b' + block}`; if (keys.has(key)) throw bad(); keys.add(key)
      track.samples.push({ start, end: duration === undefined ? undefined : start + duration, cluster, relative, block })
    }
  }
  for (const track of tracks) track.samples.sort((a, b) => a.start - b.start)
  return { scale, tracks: tracks.filter(track => track.samples.length) }
}
export function mkvSeekEntries(bytes: Uint8Array, segment: number, end: number): { id: number; position: number }[] {
  if (bytes.length > 65536) throw bad()
  const result: { id: number; position: number }[] = []
  for (const item of elements(bytes)) {
    if (item.id !== 0x4dbb) continue
    const entry = fields(bytes.subarray(item.data, item.end)), id = ebmlUint(entry.get(0x53ab)?.[0] || new Uint8Array()), position = segment + uint(entry, 0x53ac)
    if (!Number.isSafeInteger(position) || position < segment || position >= end || result.length >= 256) throw bad()
    if ([MKV.info, MKV.tracks, MKV.cues, MKV.seek].includes(id)) result.push({ id, position })
  }
  return result
}
export function validateMkvHeader(bytes: Uint8Array) {
  if (bytes.length > 4096) throw bad()
  const header = fields(bytes), docType = elementText(header.get(0x4282)?.[0])
  if (!['matroska', 'webm'].includes(docType) || uint(header, 0x42f7, 1) !== 1 || uint(header, 0x42f2, 4) > 4 || uint(header, 0x42f3, 8) > 8 || uint(header, 0x4285, 1) > 4) throw bad()
}
/** Decode a complete indexed BlockGroup/SimpleBlock, not arbitrary bytes or attached resources. */
export function decodeMkvCue(bytes: Uint8Array, track: MkvTextTrack, cue: MkvCue, clusterTime: number, scale: number): SubtitleCue {
  if (bytes.length > 65536) throw bad()
  const header = ebmlHeader(bytes)
  if (header.end !== bytes.length || ![0xa0, 0xa3].includes(header.id)) throw bad()
  let payload = bytes.subarray(header.data), duration = track.defaultDuration
  if (header.id === 0xa0) {
    const group = fields(payload)
    if (group.has(0xa4) || !group.has(0xa1)) throw bad()
    payload = group.get(0xa1)![0]
    if (group.has(0x9b)) duration = uint(group, 0x9b) * scale
  }
  const number = ebmlVint(payload)
  if (number.unknown || number.value !== track.id || payload.length < number.width + 3 || payload.length > 16384 || payload[number.width + 2] & 6) throw bad()
  const relative = new DataView(payload.buffer, payload.byteOffset + number.width, 2).getInt16(0), start = (clusterTime + relative) * scale
  if (Math.abs(start - cue.start) > 1e-6) throw bad()
  const end = duration === undefined ? cue.end : start + duration
  if (end === undefined || end <= start || end > MAX_TIME || cue.end !== undefined && Math.abs(end - cue.end) > 1e-6) throw bad()
  let value = text(payload.subarray(number.width + 3), 16384)
  if (track.codec === 'S_TEXT/ASS' || track.codec === 'S_TEXT/SSA') {
    let at = 0; for (let i = 0; i < 8; i++) { const next = value.indexOf(',', at); if (next < 0) throw bad(); at = next + 1 }
    value = assText(value.slice(at), track.wrap)
  } else value = plainCaptionText(value)
  if (value.length > 4096) throw bad()
  return { start, end, text: value }
}
