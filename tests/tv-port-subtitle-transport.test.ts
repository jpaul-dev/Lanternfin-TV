import { afterEach, expect, it, vi } from 'vitest'
import { loadSubtitles } from '../tv-app/external-subtitles'
import { openMp4Subtitles } from '../tv-app/mp4-subtitles'
import { parseMp4Text } from '../tv-app/mp4-text'
import { buildMp4, tx3gCluster } from './helpers/mp4-fixtures'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
const mp4 = buildMp4({ tracks: [{ trackId: 1, mediaType: 'text', language: 'eng', sampleClusters: [tx3gCluster(['Hello'])] }], moovPosition: 'after-mdat' }).bytes
const srt = new TextEncoder().encode('1\n00:00:00,000 --> 00:00:03,000\n' + 'Hello '.repeat(200))
const cases = [
  { name: 'external file', bytes: srt, status: 200, timeout: 30000, load: (signal: AbortSignal) => loadSubtitles('https://example.test/captions.srt?private=value', signal) },
  { name: 'MP4 range', bytes: mp4, status: 206, timeout: 15000, load: (signal: AbortSignal) => openMp4Subtitles({ url: 'https://example.test/movie.mp4?private=value' }, signal, async bytes => parseMp4Text(bytes)) },
]

for (const test of cases) {
  it(`${test.name}: processes single-byte chunks without retaining their backing buffers`, async () => {
    let offset = 0
    // A stream producer may reuse a backing buffer after its previous chunk was read.
    // Copying each chunk on arrival also prevents retaining large buffers for tiny views.
    const reused = new Uint8Array(1024 * 1024)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      pull(controller) {
        if (offset === test.bytes.length) { controller.close(); return }
        reused[0] = test.bytes[offset++]; controller.enqueue(reused.subarray(0, 1))
      },
    }, { highWaterMark: 0 }), { status: test.status })))
    const result = await test.load(new AbortController().signal)
    if ('tracks' in result) expect(result.tracks).toHaveLength(1)
    else expect(result.at(1)).toBe('Hello '.repeat(200).trim())
  })

  it(`${test.name}: gives queued remote cancellation a turn during immediately available tiny chunks`, async () => {
    const controller = new AbortController(); let reads = 0
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      pull(stream) {
        if (++reads === 1) setTimeout(() => controller.abort(), 0)
        if (reads > test.bytes.length) { stream.close(); return }
        stream.enqueue(test.bytes.slice(reads - 1, reads))
      },
    }, { highWaterMark: 0 }), { status: test.status })))
    await expect(test.load(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(reads).toBeLessThan(test.bytes.length)
  })

  it(`${test.name}: times out a stalled body even when it ignores the fetch signal`, async () => {
    vi.useFakeTimers(); const cancel = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel }), { status: test.status })))
    const pending = test.load(new AbortController().signal), result = expect(pending).rejects.toThrow('took too long')
    await vi.advanceTimersByTimeAsync(test.timeout); await result
    expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
  }, 1000)

  it(`${test.name}: empty chunks cannot starve queued cancellation`, async () => {
    const controller = new AbortController(), cancel = vi.fn(); let reads = 0
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      pull(stream) {
        if (++reads === 1) setTimeout(() => controller.abort(), 0)
        if (reads <= 1024) stream.enqueue(new Uint8Array(0))
        else { stream.enqueue(test.bytes); stream.close() }
      }, cancel,
    }, { highWaterMark: 0 }), { status: test.status })))
    await expect(test.load(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(reads).toBeLessThan(1024); expect(cancel).toHaveBeenCalledOnce()
  })

  it(`${test.name}: times out a fetch that never observes its signal`, async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const result = expect(test.load(new AbortController().signal)).rejects.toThrow('took too long')
    await vi.advanceTimersByTimeAsync(test.timeout); await result
    expect(vi.getTimerCount()).toBe(0)
  }, 1000)

  it(`${test.name}: cancels pending fetch independently and closes a late response`, async () => {
    const controller = new AbortController(), cancel = vi.fn()
    let resolve!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done })))
    const pending = test.load(controller.signal), result = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(); await result
    resolve(new Response(new ReadableStream({ cancel }), { status: test.status }))
    await new Promise(done => setTimeout(done, 0)); expect(cancel).toHaveBeenCalledOnce()
  }, 1000)

  it(`${test.name}: cancels a body rejected from its response headers`, async () => {
    const cancel = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel }), {
      status: test.status, headers: { 'content-length': String(100 * 1024 * 1024) },
    })))
    await expect(test.load(new AbortController().signal)).rejects.toThrow()
    expect(cancel).toHaveBeenCalledOnce()
  })
}

it('MP4 window failure cancels sibling range reads and does not cache partial captions', async () => {
  const cancelled = [vi.fn(), vi.fn()], requests: number[] = []; let fail = true
  const tracks = [{ id: 1, language: 'eng', samples: [100000, 200000, 300000].map((offset, index) => ({ offset, size: 3, start: index, end: index + 1 })) }]
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const start = Number(/^bytes=(\d+)-/.exec(new Headers(init.headers).get('range')!)![1]); requests.push(start)
    if (start === 0) return new Response(new Uint8Array([0, 0, 0, 8, 109, 111, 111, 118]), { status: 206 })
    if (fail) return new Response(new ReadableStream({ cancel: cancelled[start === 200000 ? 0 : 1] }), { status: start === 100000 ? 200 : 206 })
    return new Response(new Uint8Array([0, 1, 65 + tracks[0].samples.findIndex(sample => sample.offset === start)]), { status: 206 })
  }))
  const session = await openMp4Subtitles({ url: 'https://example.test/movie.mp4' }, new AbortController().signal, async () => tracks)
  await expect(session.read(1, 0, new AbortController().signal)).rejects.toThrow('byte-range')
  await new Promise(done => setTimeout(done, 0))
  expect(cancelled[0]).toHaveBeenCalledOnce(); expect(cancelled[1]).toHaveBeenCalledTimes(2)
  fail = false; requests.length = 0
  const result = await session.read(1, 0, new AbortController().signal)
  expect(requests).toEqual([100000, 200000, 300000]); expect(result.timeline.at(1)).toBe('B')
})
