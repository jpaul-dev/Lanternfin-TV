// Adds our own clear WebVTT track to the locally generated H.264 test video.
// Run create-tv-mp4-fixture.mjs first. No media or software is downloaded.
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../artifacts')
const source = await readFile(resolve(out, 'tv-mp4-text-demo.mp4'))
if (source.length > 16 * 1024 * 1024) throw new Error('Use the small generated TV MP4 fixture.')
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b }
const text = value => Buffer.from(value, 'utf8'), zero = n => Buffer.alloc(n)
const box = (name, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32(body.length + 8), text(name), body]) }
const full = (name, ...parts) => box(name, zero(4), ...parts)
const children = (bytes, start = 0) => {
  const result = []
  for (let at = start; at < bytes.length;) {
    if (at + 8 > bytes.length) throw new Error('Truncated generated MP4.')
    const size = bytes.readUInt32BE(at)
    if (size < 8 || at + size > bytes.length) throw new Error('Unexpected generated MP4 layout.')
    result.push({ name: bytes.toString('ascii', at + 4, at + 8), at, bytes: bytes.subarray(at, at + size) }); at += size
  }
  return result
}
const containers = children(source), moovs = containers.filter(item => item.name === 'moov')
if (moovs.length !== 1) throw new Error('Expected one generated movie header.')
const movie = children(moovs[0].bytes, 8), header = movie.find(item => item.name === 'mvhd')?.bytes
if (!header || header[8] !== 0 || header.readUInt32BE(24) / header.readUInt32BE(20) < 70) throw new Error('Use the 70-second generated TV MP4 fixture.')
const ids = movie.filter(item => item.name === 'trak').map(item => {
  const tkhd = children(item.bytes, 8).find(item => item.name === 'tkhd')?.bytes
  if (!tkhd || tkhd[8] !== 0) throw new Error('Unexpected generated track header.')
  return tkhd.readUInt32BE(20)
})
const id = Math.max(...ids) + 1, movieHeader = Buffer.from(header); movieHeader.writeUInt32BE(id + 1, movieHeader.length - 4)
const cue = value => box('vttc', box('sttg', text('align:center')), box('payl', text(value)))
const samples = [Buffer.concat([cue('<b>Embedded WebVTT in MP4</b>'), cue('Two simultaneous cues &amp; plain text')]), cue('WebVTT captions after the opening'), cue('Seekable WebVTT captions'), box('vtte'), cue('WebVTT closing captions')]
const durations = [12000, 23000, 20000, 5000, 10000], offsets = []; let at = source.length + 8
for (const sample of samples) { offsets.push(at); at += sample.length }
const identity = Buffer.concat([u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000)])
const track = box('trak', box('tkhd', u32(3), zero(8), u32(id), zero(4), u32(header.readUInt32BE(20) * 70), zero(8), zero(8), identity, zero(8)),
  box('mdia', full('mdhd', zero(8), u32(1000), u32(70000), u16((5 << 10) | (14 << 5) | 7), zero(2)),
    full('hdlr', zero(4), text('text'), zero(12), text('Generated WebVTT\0')),
    box('minf', full('nmhd'), box('dinf', full('dref', u32(1), box('url ', u32(1)))),
      box('stbl', full('stsd', u32(1), box('wvtt', zero(6), u16(1), box('vttC', text('WEBVTT\n')))),
        full('stts', u32(samples.length), ...durations.flatMap(duration => [u32(1), u32(duration)])),
        full('stsc', u32(1), u32(1), u32(1), u32(1)), full('stsz', u32(0), u32(samples.length), ...samples.map(sample => u32(sample.length))),
        full('stco', u32(samples.length), ...offsets.map(u32))))))
// Preserve all existing chunk offsets by replacing the old moov with equal-sized free space.
const original = Buffer.from(source), old = moovs[0]; original.fill(0, old.at + 8, old.at + old.bytes.length); original.write('free', old.at + 4, 4, 'ascii')
const updated = box('moov', ...movie.map(item => item.name === 'mvhd' ? movieHeader : item.bytes), track)
await writeFile(resolve(out, 'tv-mp4-webvtt-demo.mp4'), Buffer.concat([original, box('mdat', ...samples), updated]))
console.log(`Generated artifacts/tv-mp4-webvtt-demo.mp4 with English WebVTT track ${id}; preview at /_test/webvtt.mp4.`)
