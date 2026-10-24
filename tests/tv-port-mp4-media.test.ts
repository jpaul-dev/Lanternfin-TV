import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { openMp4Media } from '../tv-app/mp4-media-session'
import { mp4MediaReader } from '../tv-app/mp4-media-range'
import { guardMp4Moov } from '../tv-app/mp4-media-guard'
import { mp4BoxHeader } from '../tv-app/mp4-text'
import { createFile, MP4BoxBuffer } from 'mp4box'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const fixture = new Uint8Array(readFileSync(new URL('./fixtures/tv-authenticated-mp4.mp4', import.meta.url)))
const media = { url: 'https://provider.invalid/movie.mp4?private=value', playback: { headers: { Authorization: 'test-only' } } }
function server(data = fixture) {
  const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec((init.headers as Record<string, string>).Range)!, start = Number(match[1]), end = Math.min(Number(match[2]), data.length - 1)
    return new Response(data.slice(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${data.length}`, ETag: '"fixture"' } })
  }); vi.stubGlobal('fetch', fetch); return fetch
}
it('reads a real tail-index MP4 with headers, remuxes both languages and seeks in both directions', async () => {
  const fetch = server(), session = await openMp4Media(media, new AbortController().signal)
  expect(session.info.duration).toBeCloseTo(70, 0)
  expect(session.info.tracks.map(t => t.language)).toEqual(['und', 'eng', 'fra'])
  const init = session.initialize([session.info.tracks[0].id, session.info.tracks[2].id])
  const first = await session.segment(0, true), middle = await session.segment(40, true), back = await session.segment(2, true)
  expect(first.next).toBeGreaterThanOrEqual(5.9); expect(middle.next).toBeGreaterThanOrEqual(45.9); expect(back.next).toBeGreaterThanOrEqual(7.9)
  for (const piece of first.segments) {
    const file = createFile(), header = init[0].buffer
    file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(header.slice(0), 0))
    expect(file.getInfo().tracks.map(t => t.id)).toEqual([1, 3])
    file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(piece.buffer.slice(0), header.byteLength))
    expect(file.getTrackSamplesInfo(piece.id).length).toBeGreaterThan(100)
  }
  const last = await session.segment(68, true); expect(last.done).toBe(true); expect(last.next).toBe(70)
  expect(fetch.mock.calls.every(([, init]) => (init.headers as any).Authorization === 'test-only' && init.redirect === 'error' && init.credentials === 'omit')).toBe(true)
  expect(fetch.mock.calls.slice(1).some(([, init]) => (init.headers as any)['If-Range'] === '"fixture"')).toBe(true)
})
it('fails closed on full-file responses, absent or lying ranges, and changing entities', async () => {
  for (const response of [new Response('whole movie'), new Response('abc', { status: 206 }), new Response('abc', { status: 206, headers: { 'Content-Range': 'bytes 1-3/10' } })]) {
    vi.stubGlobal('fetch', vi.fn(async () => response))
    await expect(mp4MediaReader(media)(0, 3, new AbortController().signal)).rejects.toThrow('Cannot read this MP4')
  }
  server(); const read = mp4MediaReader(media), signal = new AbortController().signal; await read(0, 16, signal)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(fixture.slice(16, 32), { status: 206, headers: { 'Content-Range': `bytes 16-31/${fixture.length}`, ETag: '"changed"' } })))
  await expect(read(16, 16, signal)).rejects.toThrow('Cannot read this MP4')
})
it('bounds stalled and oversized range bodies and cancels pending fetches', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', () => new Promise(() => {}))
  const read = mp4MediaReader(media), controller = new AbortController()
  const request = read(0, 16, controller.signal); const outcome = expect(request).rejects.toThrow('Cancelled'); controller.abort(); await outcome
  const stalled = read(0, 16, new AbortController().signal), deadline = expect(stalled).rejects.toThrow('Cannot read this MP4')
  await vi.advanceTimersByTimeAsync(15000); await deadline
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(17), { status: 206, headers: { 'Content-Range': 'bytes 0-15/100' } })))
  await expect(read(0, 16, new AbortController().signal)).rejects.toThrow('Cannot read this MP4')
})
it('rejects impossible table counts before handing metadata to MP4Box', () => {
  let at = 0
  while (mp4BoxHeader(fixture, at).type !== 'moov') at += mp4BoxHeader(fixture, at).size
  const moov = fixture.slice(at, at + mp4BoxHeader(fixture, at).size)
  expect(guardMp4Moov(moov).length).toBeLessThan(moov.length)
  const tag = new TextEncoder().encode('stsz'); let found = -1
  for (let n = 0; n < moov.length - 4; n++) if (tag.every((b, i) => moov[n + i] === b)) { found = n; break }
  expect(found).toBeGreaterThan(0); new DataView(moov.buffer).setUint32(found + 12, 0xffffffff)
  expect(() => guardMp4Moov(moov)).toThrow('malformed')
})
