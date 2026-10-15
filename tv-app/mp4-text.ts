import { plainCaptionText } from './caption-text'
/** Bounded, non-fragmented ISO-BMFF text tables. Audio/video tables are never expanded. */
export type Mp4Sample = { offset: number; size: number; start: number; end: number; codec?: 'wvtt' }
export type Mp4TextTrack = { id: number; language: string; samples: Mp4Sample[] }
export const MP4_MOOV_BYTES = 32 * 1024 * 1024
const MAX_SAMPLES = 20000, MAX_TIME = 604800
type Box = { type: string; start: number; data: number; end: number }
const bad = () => new Error('Unsupported or malformed MP4 subtitle tables.')
const fourcc = (v: DataView, p: number) => String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3))
const safe = (value: number) => { if (!Number.isSafeInteger(value) || value < 0) throw bad(); return value }
const u64 = (v: DataView, p: number) => safe(v.getUint32(p) * 4294967296 + v.getUint32(p + 4))
const i64 = (v: DataView, p: number) => { const n = v.getInt32(p) * 4294967296 + v.getUint32(p + 4); if (!Number.isSafeInteger(n)) throw bad(); return n }

export function mp4BoxHeader(bytes: Uint8Array, at = 0) {
  if (at + 8 > bytes.length) throw bad()
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), small = v.getUint32(at)
  if (small === 1 && at + 16 > bytes.length) throw bad()
  const size = small === 1 ? u64(v, at + 8) : small, header = small === 1 ? 16 : 8
  if (size && size < header) throw bad()
  return { type: fourcc(v, at + 4), size, header }
}

export function parseMp4Text(bytes: Uint8Array): Mp4TextTrack[] {
  if (bytes.length > MP4_MOOV_BYTES) throw bad()
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let nodes = 0, totalSamples = 0, mappedSamples = 0
  const boxes = (start: number, end: number): Box[] => {
    const result: Box[] = []
    for (let p = start; p < end;) {
      if (++nodes > 4096) throw bad()
      const h = mp4BoxHeader(bytes, p), next = safe(h.size ? p + h.size : end)
      if (next > end || p + h.header > next) throw bad()
      result.push({ type: h.type, start: p, data: p + h.header, end: next }); p = next
    }
    return result
  }
  const one = (all: Box[], name: string, required = true): Box | undefined => {
    const found = all.filter(b => b.type === name)
    if (found.length > 1 || required && !found.length) throw bad()
    return found[0]
  }
  const child = (box: Box) => boxes(box.data, box.end)
  const need = (b: Box, length: number) => { if (b.end - b.data < length) throw bad() }
  const version = (b: Box, allowed = [0]) => { need(b, 4); const n = v.getUint8(b.data); if (!allowed.includes(n)) throw bad(); return n }
  const table = (b: Box, width: number, max = MAX_SAMPLES, versions = [0]) => {
    version(b, versions); need(b, 8); const count = v.getUint32(b.data + 4)
    if (count > max) throw bad(); need(b, 8 + count * width); return count
  }
  const root = one(boxes(0, bytes.length), 'moov')!, movie = child(root)
  if (one(movie, 'mvex', false)) throw new Error('Fragmented MP4 subtitles must be exposed by the active player.')
  const mvhd = one(movie, 'mvhd')!, mv = version(mvhd, [0, 1]); need(mvhd, mv ? 24 : 16)
  const movieScale = v.getUint32(mvhd.data + (mv ? 20 : 12)); if (!movieScale) throw bad()
  const traks = movie.filter(b => b.type === 'trak'); if (traks.length > 128) throw bad()
  const tracks: Mp4TextTrack[] = [], ids = new Set<number>()
  for (const trak of traks) {
    const track = child(trak), mdia = child(one(track, 'mdia')!), handler = one(mdia, 'hdlr')!
    need(handler, 12)
    if (!['text', 'sbtl', 'subt'].includes(fourcc(v, handler.data + 8))) continue
    const minf = child(one(mdia, 'minf')!), stbl = child(one(minf, 'stbl')!), stsd = one(stbl, 'stsd')!
    const entryCount = table(stsd, 0, 8), entries = boxes(stsd.data + 8, stsd.end)
    if (!entryCount || entries.length !== entryCount) throw bad()
    if (entries.some(e => !['tx3g', 'wvtt'].includes(e.type))) continue
    const dinf = one(minf, 'dinf', false), dref = dinf && one(child(dinf), 'dref', false)
    let refs: Box[] | undefined
    if (dref) { const count = table(dref, 0, 8); refs = boxes(dref.data + 8, dref.end); if (count !== refs.length) throw bad() }
    for (const entry of entries) {
      need(entry, entry.type === 'wvtt' ? 8 : 38)
      if (entry.type === 'wvtt') {
        const config = one(boxes(entry.data + 8, entry.end), 'vttC')!
        if (config.end - config.data > 65536) throw bad()
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(config.data, config.end))
        if (!/^WEBVTT(?:[ \t\r\n]|$)/.test(text)) throw bad()
      }
      const ref = v.getUint16(entry.data + 6)
      if (refs) { const r = refs[ref - 1]; if (!r) throw bad(); need(r, 4); if (r.type !== 'url ' || (v.getUint32(r.data) & 1) !== 1) throw new Error('MP4 subtitle tracks referencing a separate file are not supported.') }
      else if (ref !== 1) throw bad()
    }
    const tkhd = one(track, 'tkhd')!, tv = version(tkhd, [0, 1]); need(tkhd, tv ? 24 : 16)
    const id = v.getUint32(tkhd.data + (tv ? 20 : 12)); if (!id || ids.has(id)) throw bad(); ids.add(id)
    const mdhd = one(mdia, 'mdhd')!, mv = version(mdhd, [0, 1]); need(mdhd, mv ? 36 : 24)
    const scale = v.getUint32(mdhd.data + (mv ? 20 : 12)), packed = v.getUint16(mdhd.data + (mv ? 32 : 20)); if (!scale) throw bad()
    const language = [10, 5, 0].map(shift => String.fromCharCode(((packed >> shift) & 31) + 96)).join('')
    const stsz = one(stbl, 'stsz', false), stz2 = one(stbl, 'stz2', false)
    if (!!stsz === !!stz2) throw bad()
    const sizeBox = (stsz || stz2)!; version(sizeBox); need(sizeBox, 12)
    const n = v.getUint32(sizeBox.data + 8); totalSamples += n
    if (n > MAX_SAMPLES || totalSamples > 50000) throw new Error('This MP4 contains too many subtitle samples for the TV reader.')
    if (!n) continue
    const sizes = new Uint32Array(n), constant = stsz ? v.getUint32(stsz.data + 4) : 0, bits = stsz ? 32 : v.getUint8(stz2!.data + 7)
    if (![4, 8, 16, 32].includes(bits) || !stsz && bits === 32) throw bad()
    need(sizeBox, 12 + (constant ? 0 : Math.ceil(n * bits / 8)))
    for (let i = 0; i < n; i++) {
      const p = sizeBox.data + 12 + Math.floor(i * bits / 8)
      sizes[i] = constant || (bits === 32 ? v.getUint32(p) : bits === 16 ? v.getUint16(p) : bits === 8 ? v.getUint8(p) : (v.getUint8(p) >> (i % 2 ? 0 : 4)) & 15)
      if (sizes[i] > 128 * 1024) throw bad()
    }
    const expand = (b: Box, signed = false) => {
      const count = table(b, 8, MAX_SAMPLES, signed ? [0, 1] : [0]), result = new Float64Array(n); let index = 0
      for (let i = 0; i < count; i++) {
        const p = b.data + 8 + i * 8, run = v.getUint32(p), value = signed && v.getUint8(b.data) === 1 ? v.getInt32(p + 4) : v.getUint32(p + 4)
        if (!run || index + run > n) throw bad(); result.fill(value, index, index + run); index += run
      }
      if (index !== n) throw bad(); return result
    }
    const durations = expand(one(stbl, 'stts')!), ctts = one(stbl, 'ctts', false), composition = ctts ? expand(ctts, true) : undefined
    const stco = one(stbl, 'stco', false), co64 = one(stbl, 'co64', false)
    if (!!stco === !!co64) throw bad()
    const chunks = (stco || co64)!, width = stco ? 4 : 8, chunkCount = table(chunks, width), stsc = one(stbl, 'stsc')!, runCount = table(stsc, 12)
    if (!chunkCount || !runCount) throw bad()
    const runs: { first: number; count: number; webvtt: boolean }[] = []
    for (let i = 0; i < runCount; i++) {
      const p = stsc.data + 8 + i * 12, first = v.getUint32(p), count = v.getUint32(p + 4), description = v.getUint32(p + 8)
      if (first > chunkCount || (i ? first <= runs[i - 1].first : first !== 1) || !count || count > n || description < 1 || description > entries.length) throw bad()
      runs.push({ first, count, webvtt: entries[description - 1].type === 'wvtt' })
    }
    const offsets = new Float64Array(n), webvtt = new Uint8Array(n); let sample = 0, run = 0
    for (let i = 1; i <= chunkCount; i++) {
      if (run + 1 < runs.length && i === runs[run + 1].first) run++
      const p = chunks.data + 8 + (i - 1) * width; let offset = stco ? v.getUint32(p) : u64(v, p)
      if (sample + runs[run].count > n) throw bad()
      for (let j = 0; j < runs[run].count; j++) { if (offset < 8) throw bad(); offsets[sample] = offset; webvtt[sample] = Number(runs[run].webvtt); offset = safe(offset + sizes[sample++]) }
    }
    if (sample !== n) throw bad()
    const edits: { start: number; duration: number; media: number }[] = [], edts = one(track, 'edts', false), elst = edts && one(child(edts), 'elst', false)
    if (elst) {
      const ver = version(elst, [0, 1]), width = ver ? 20 : 12, count = table(elst, width, 128, [0, 1]); let cursor = 0
      for (let i = 0; i < count; i++) {
        const p = elst.data + 8 + i * width, duration = (ver ? u64(v, p) : v.getUint32(p)) / movieScale, media = ver ? i64(v, p + 8) : v.getInt32(p + 4)
        if (v.getInt16(p + width - 4) !== 1 || v.getInt16(p + width - 2) !== 0 || media < -1 || cursor + duration > MAX_TIME) throw bad()
        if (media !== -1 && duration) edits.push({ start: cursor, duration, media: media / scale })
        cursor += duration
      }
      if (!count) edits.push({ start: 0, duration: MAX_TIME, media: 0 })
    } else edits.push({ start: 0, duration: MAX_TIME, media: 0 })
    const samples: Mp4Sample[] = []; let time = 0
    for (let i = 0; i < n; i++) {
      const start = (time + (composition?.[i] || 0)) / scale, end = start + durations[i] / scale; time = safe(time + durations[i])
      if (!Number.isFinite(start) || end > MAX_TIME || start < -MAX_TIME) throw bad()
      for (const edit of edits) {
        const from = Math.max(start, edit.media), to = Math.min(end, edit.media + edit.duration)
        if (sizes[i] >= 2 && to > from) samples.push({ offset: offsets[i], size: sizes[i], start: edit.start + from - edit.media, end: edit.start + to - edit.media, ...(webvtt[i] ? { codec: 'wvtt' as const } : {}) })
        if (samples.length > MAX_SAMPLES) throw bad()
      }
    }
    samples.sort((a, b) => a.start - b.start)
    mappedSamples += samples.length; if (mappedSamples > 50000) throw bad()
    if (samples.length) tracks.push({ id, language: /^[a-z]{3}$/.test(language) ? language : 'und', samples })
    if (tracks.length > 16) throw bad()
  }
  return tracks
}

export function decodeMp4Text(bytes: Uint8Array, codec?: 'wvtt'): string {
  if (codec === 'wvtt') return decodeMp4WebVtt(bytes)
  if (bytes.length < 2) throw bad()
  const count = (bytes[0] << 8) | bytes[1]; if (count + 2 > bytes.length) throw bad()
  const data = bytes.subarray(2, count + 2)
  const encoding = data[0] === 0xfe && data[1] === 0xff ? 'utf-16be' : data[0] === 0xff && data[1] === 0xfe ? 'utf-16le' : 'utf-8'
  const text = new TextDecoder(encoding, { fatal: true }).decode(data).replace(/\r\n?/g, '\n').replace(/\0/g, '').trim()
  if (text.length > 4096) throw bad()
  return text
}

/** ISO-BMFF WebVTT: each sample's cue payloads share its presentation interval.
 * Settings, regions, cue IDs and additional source text are not executed/rendered.
 * See https://dev.w3.org/html5/html-sourcing-inband-tracks/ and ISO/IEC 14496-30.
 */
export function decodeMp4WebVtt(bytes: Uint8Array): string {
  if (bytes.length < 8 || bytes.length > 128 * 1024) throw bad()
  let nodes = 0, cueCount = 0, empty = false, characters = 0
  const cues: string[] = []
  const scan = (start: number, end: number, visit: (type: string, data: number, stop: number) => void) => {
    for (let at = start; at < end;) {
      if (++nodes > 128 || end - at < 8) throw bad()
      const h = mp4BoxHeader(bytes, at), stop = h.size ? at + h.size : end
      if (!Number.isSafeInteger(stop) || stop > end || at + h.header > stop) throw bad()
      visit(h.type, at + h.header, stop); at = stop
    }
  }
  scan(0, bytes.length, (type, start, end) => {
    if (type === 'vtte') { if (empty || start !== end) throw bad(); empty = true; return }
    if (type !== 'vttc') return
    if (++cueCount > 8) throw bad()
    let payload: string | undefined
    scan(start, end, (child, data, stop) => {
      if (child !== 'payl') return
      if (payload !== undefined) throw bad()
      payload = plainCaptionText(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(data, stop)).replace(/\r\n?/g, '\n').replace(/\0/g, ''))
    })
    if (payload === undefined) throw bad()
    if (payload) { characters += payload.length + (cues.length ? 1 : 0); if (characters > 4096) throw bad(); cues.push(payload) }
  })
  if (empty && cueCount || !empty && !cueCount) throw bad()
  return cues.join('\n')
}
