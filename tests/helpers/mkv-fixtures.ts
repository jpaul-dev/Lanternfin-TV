export const join = (...parts: Uint8Array[]) => { const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of parts) { bytes.set(part, at); at += part.length }; return bytes }
export function uint(value: number, width = Math.max(1, Math.ceil(Math.log2(value + 1) / 8))) { const bytes = new Uint8Array(width); let n = BigInt(value); for (let i = width - 1; i >= 0; i--) { bytes[i] = Number(n & 255n); n >>= 8n }; return bytes }
export function vint(value: number) { let width = 1; while (BigInt(value) >= (1n << BigInt(7 * width)) - 1n) width++; const data = uint(value, width); data[0] |= 128 >> (width - 1); return data }
export const text = (value: string) => new TextEncoder().encode(value)
export const element = (id: number, ...body: Uint8Array[]) => { const data = join(...body); return join(uint(id), vint(data.length), data) }
export const integer = (id: number, value: number) => element(id, uint(value))
export type Sample = { track: number; start: number; end: number; text: string }
export function mkvFixture(options: { gap?: number; relative?: boolean; cueDuration?: boolean; unknownSegment?: boolean; codec?: string; simple?: boolean; defaultDuration?: number; samples?: Sample[]; docType?: string } = {}) {
  const samples = options.samples || [{ track: 1, start: 0, end: 70, text: 'Long English caption' }, { track: 2, start: 0, end: 70, text: 'Longue légende française' }, { track: 1, start: 105, end: 110, text: 'Later caption' }]
  const ebml = element(0x1a45dfa3, integer(0x42f7, 1), element(0x4282, text(options.docType || 'matroska')))
  const info = integer(0x2ad7b1, 1000000)
  const codec = options.codec || 'S_TEXT/UTF8'
  const tracks = join(...[1, 2].map(id => element(0xae, integer(0xd7, id), integer(0x83, 17), element(0x86, text(codec)), element(0x22b59c, text(id === 1 ? 'eng' : 'fra')), element(0x536e, text(id === 1 ? 'English' : 'French')), ...(options.defaultDuration ? [integer(0x23e383, options.defaultDuration * 1e9)] : []), ...(codec === 'S_TEXT/ASS' ? [element(0x63a2, text('[Script Info]\nWrapStyle: 0\n'))] : []))))
  const trackElement = element(0x1654ae6b, tracks), infoElement = element(0x1549a966, info)
  const seek = (cueOffset: number) => element(0x114d9b74, ...[[0x1549a966, seekSize], [0x1654ae6b, seekSize + infoElement.length], [0x1c53bb6b, cueOffset]].map(([id, offset]) => element(0x4dbb, element(0x53ab, uint(id)), element(0x53ac, uint(offset, 8)))))
  let seekSize = 0; seekSize = seek(0).length
  const gap = options.gap || 0, paddingHeader = gap ? join(uint(0xec), vint(gap)) : new Uint8Array()
  let cursor = seekSize + infoElement.length + trackElement.length + paddingHeader.length + gap
  const clusters = samples.map(sample => {
    const timestamp = integer(0xe7, Math.round(sample.start * 1000)), dummy = element(0xa3, new Uint8Array([0xe3, 0, 0, 0, 1, 2, 3])) // Dummy video Block #1; never read as text.
    const payload = join(vint(sample.track), new Uint8Array([0, 0, 0]), text(sample.text))
    const block = options.simple ? element(0xa3, payload) : element(0xa0, element(0xa1, payload), integer(0x9b, Math.round((sample.end - sample.start) * 1000)))
    const bytes = element(0x1f43b675, timestamp, dummy, block), offset = cursor, relative = timestamp.length + dummy.length
    cursor += bytes.length; return { bytes, offset, relative, sample, block }
  })
  const cues = join(...clusters.map(({ offset, relative, sample }) => element(0xbb, integer(0xb3, Math.round(sample.start * 1000)), element(0xb7, integer(0xf7, sample.track), integer(0xf1, offset), integer(0x5378, 2), ...(options.relative === false ? [] : [integer(0xf0, relative)]), ...(options.cueDuration === false ? [] : [integer(0xb2, Math.round((sample.end - sample.start) * 1000))])))))
  const cueElement = element(0x1c53bb6b, cues), contentSize = cursor + cueElement.length
  const segmentHeader = join(uint(0x18538067), options.unknownSegment ? new Uint8Array([0x01, 255, 255, 255, 255, 255, 255, 255]) : vint(contentSize))
  const segment = ebml.length + segmentHeader.length, total = segment + contentSize
  const pieces = [{ offset: 0, bytes: join(ebml, segmentHeader, seek(cursor), infoElement, trackElement, paddingHeader) }, ...clusters.map(cluster => ({ offset: segment + cluster.offset, bytes: cluster.bytes })), { offset: segment + cursor, bytes: cueElement }]
  const read = (start: number, length: number) => { const bytes = new Uint8Array(Math.min(length, Math.max(0, total - start))); for (const piece of pieces) { const from = Math.max(start, piece.offset), to = Math.min(start + bytes.length, piece.offset + piece.bytes.length); if (to > from) bytes.set(piece.bytes.subarray(from - piece.offset, to - piece.offset), from - start) }; return bytes }
  return { total, segment, info, tracks, cues, clusters, pieces, read, metadata: { info, tracks, cues, segment, end: total } }
}
