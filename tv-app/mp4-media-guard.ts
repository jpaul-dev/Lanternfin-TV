import { mp4BoxHeader } from './mp4-text'

export const MP4_METADATA_ERROR = 'This MP4 has unsupported, encrypted, oversized or malformed movie tables. Try the provider’s HLS or DASH version.'
export const MP4_METADATA_BYTES = 16 * 1024 * 1024
const bad = () => new Error(MP4_METADATA_ERROR)
const join = (parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0)); let at = 0; for (const b of parts) { out.set(b, at); at += b.length }; return out }
const box = (type: string, payload: Uint8Array) => { const out = new Uint8Array(payload.length + 8); new DataView(out.buffer).setUint32(0, out.length); for (let i = 0; i < 4; i++) out[i + 4] = type.charCodeAt(i); out.set(payload, 8); return out }

/** Strip irrelevant metadata before the general parser, and validate counts before expansion. */
export function guardMp4Moov(bytes: Uint8Array) {
  if (bytes.length > MP4_METADATA_BYTES) throw bad()
  let nodes = 0, samples = 0, tracks = 0
  const visit = (start: number, end: number, parent: string, depth = 0): Uint8Array => {
    if (depth > 9) throw bad()
    const out: Uint8Array[] = [], seen = new Set<string>()
    for (let at = start; at < end;) {
      if (++nodes > 2048) throw bad()
      const h = mp4BoxHeader(bytes, at), stop = at + h.size, data = at + h.header
      if (!h.size || !Number.isSafeInteger(stop) || stop > end) throw bad()
      const b = bytes.subarray(data, stop), v = new DataView(b.buffer, b.byteOffset, b.length)
      const need = (size: number) => { if (b.length < size) throw bad() }
      const table = (width: number, max = 750000) => { need(8); const n = v.getUint32(4); if (n > max) throw bad(); need(8 + n * width); return n }
      if (['mvex', 'pssh', 'senc', 'saiz', 'saio', 'sinf', 'encv', 'enca'].includes(h.type)) throw bad()
      const allowed: Record<string, string[]> = {
        root: ['moov'], moov: ['mvhd', 'trak'], trak: ['tkhd', 'edts', 'mdia'], edts: ['elst'],
        mdia: ['mdhd', 'hdlr', 'minf'], minf: ['vmhd', 'smhd', 'nmhd', 'dinf', 'stbl'], dinf: ['dref'],
        stbl: ['stsd', 'stts', 'ctts', 'stsc', 'stsz', 'stz2', 'stco', 'co64', 'stss'],
      }
      if ((allowed[parent] || []).includes(h.type)) {
        if (seen.has(h.type) && h.type !== 'trak') throw bad(); seen.add(h.type)
        if (h.type === 'trak' && ++tracks > 16) throw bad()
        if (allowed[h.type]) out.push(box(h.type, visit(data, stop, h.type, depth + 1)))
        else {
          need(4)
          if (v.getUint8(0) > (['mvhd', 'tkhd', 'mdhd', 'ctts', 'elst'].includes(h.type) ? 1 : 0)) throw bad()
          if (h.type === 'stsz' || h.type === 'stz2') {
            need(12); const n = v.getUint32(8); samples += n; if (samples > 750000) throw bad()
            if (h.type === 'stsz') { const size = v.getUint32(4); if (size > 8 * 1024 * 1024) throw bad(); need(12 + (size ? 0 : n * 4)) }
            else { const bits = v.getUint8(7); if (![4, 8, 16].includes(bits)) throw bad(); need(12 + Math.ceil(n * bits / 8)) }
          } else if (['stts', 'ctts', 'stsc', 'stco', 'co64', 'stss'].includes(h.type)) {
            const n = table(h.type === 'stsc' ? 12 : ['stts', 'ctts', 'co64'].includes(h.type) ? 8 : 4)
            if (['stts', 'ctts'].includes(h.type)) { let count = 0; for (let i = 0; i < n; i++) { count += v.getUint32(8 + i * 8); if (count > 750000) throw bad() } }
          } else if (h.type === 'elst') {
            const width = v.getUint8(0) ? 20 : 12, n = table(width, 16)
            for (let i = 0; i < n; i++) if (v.getInt16(8 + i * width + width - 4) !== 1 || v.getInt16(8 + i * width + width - 2)) throw bad()
          } else if (h.type === 'dref') {
            // Only same-file data; never follow embedded external URLs.
            const n = table(0, 1); if (n !== 1) throw bad()
            const ref = mp4BoxHeader(b, 8); if (ref.type !== 'url ' || ref.size !== 12 || b.length !== 20 || v.getUint32(16) !== 1) throw bad()
          } else if (h.type === 'stsd') {
            if (table(0, 1) !== 1) throw bad()
            const entry = mp4BoxHeader(b, 8), payload = 8 + entry.header
            if (entry.size + 8 !== b.length || !['avc1', 'avc3', 'hvc1', 'hev1', 'mp4a', 'ac-3', 'ec-3', 'tx3g', 'wvtt'].includes(entry.type)) throw bad()
            // Text tracks are retained only as bounded tables; playback renders subtitles separately.
            if (!['tx3g', 'wvtt'].includes(entry.type)) {
              const video = ['avc1', 'avc3', 'hvc1', 'hev1'].includes(entry.type), prefix = video ? 78 : 28
              need(payload + prefix)
              if (!video && v.getUint16(payload + 8) !== 0) throw bad()
              if (v.getUint16(payload + 6) !== 1) throw bad()
              const configs: Uint8Array[] = []
              for (let p = payload + prefix; p < b.length;) {
                const c = mp4BoxHeader(b, p), finish = p + c.size
                if (!c.size || finish > b.length || c.size > 256 * 1024) throw bad()
                if (['sinf', 'senc'].includes(c.type)) throw bad()
                if (['avcC', 'hvcC', 'esds', 'dac3', 'dec3', 'pasp', 'colr', 'clli', 'mdcv'].includes(c.type)) {
                  if (c.type === 'esds') guardDescriptors(b.subarray(p + c.header, finish))
                  configs.push(b.slice(p, finish))
                }
                p = finish
              }
              if (!configs.length) throw bad()
              out.push(box('stsd', join([b.slice(0, 8), box(entry.type, join([b.slice(payload, payload + prefix), ...configs]))])))
              at = stop; continue
            }
          } else if (b.length > 4096) throw bad()
          out.push(box(h.type, b))
        }
      }
      at = stop
    }
    if (parent === 'root' && !seen.has('moov') || parent === 'moov' && (!seen.has('mvhd') || !seen.has('trak')) || parent === 'stbl' && (!seen.has('stsd') || !seen.has('stts') || !seen.has('stsc') || seen.has('stsz') === seen.has('stz2') || seen.has('stco') === seen.has('co64'))) throw bad()
    return join(out)
  }
  return visit(0, bytes.length, 'root')
}

function guardDescriptors(bytes: Uint8Array) {
  const scan = (from: number, end: number, depth: number) => {
    if (depth > 4) throw bad()
    for (let p = from; p < end;) {
      const tag = bytes[p++]; let size = 0, count = 0, part = 0
      do { if (p >= end || ++count > 4) throw bad(); part = bytes[p++]; size = size * 128 + (part & 127) } while (part & 128)
      const stop = p + size; if (stop > end) throw bad()
      if (tag === 3) {
        if (size < 3) throw bad(); const flags = bytes[p + 2]; p += 3
        if (flags & 128) p += 2
        if (flags & 64) { if (p >= stop) throw bad(); p += 1 + bytes[p] }
        if (flags & 32) p += 2
        if (p > stop) throw bad(); scan(p, stop, depth + 1)
      } else if (tag === 4) { if (size < 13) throw bad(); scan(p + 13, stop, depth + 1) }
      else if (![5, 6].includes(tag)) throw bad()
      p = stop
    }
  }
  if (bytes.length < 4 || bytes.length > 4096) throw bad(); scan(4, bytes.length, 0)
}
