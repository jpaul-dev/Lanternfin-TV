import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpUrl, loadCatalog, MAX_BYTES, MAX_LINE_LENGTH, DOWNLOAD_IDLE_MS, parseCatalog, playlistUrl, validateSource, type Source } from '../tv-app/catalog'
import { createM3UParser, parseM3U } from '../src/scripts/lib/m3u-parser'
const source: Source = { kind: 'playlist', url: 'https://provider.example/list.m3u', username: '', password: '' }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('TV source boundary', () => {
  it('defaults to TLS without downgrading explicit HTTP', () => {
    expect(httpUrl('provider.example/list')).toBe('https://provider.example/list')
    expect(httpUrl('http://192.168.1.4:8000/list')).toBe('http://192.168.1.4:8000/list')
  })
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'https://user:secret@example.com/list', ''])('rejects unsafe source %s', value => expect(() => httpUrl(value)).toThrow())
  it('does not retain irrelevant credentials', () => expect(validateSource({ ...source, username: 'old', password: 'secret' }).password).toBe(''))
  it('constructs encoded Xtream playlist URLs and strips old query credentials', () => {
    const url = new URL(playlistUrl({ kind: 'xtream', url: 'https://provider.example/sub/player_api.php?old=secret', username: 'a&b', password: 'c/d#e' }))
    expect(url.pathname).toBe('/sub/get.php'); expect(url.searchParams.get('username')).toBe('a&b')
    expect(url.searchParams.get('password')).toBe('c/d#e'); expect(url.searchParams.has('old')).toBe(false)
  })
  it('recognizes HLS as one playable stream, not its segments', () => expect(parseCatalog('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts', source.url).channels).toEqual([{ name: 'Direct stream', group: 'Streams', url: source.url }]))
  it('reuses the existing parser, resolving relative URLs and preserving inert titles', () => {
    const result = parseCatalog('#EXTM3U\n#EXTINF:-1 group-title="News",<b>Untrusted title</b>\n../live/1.m3u8', source.url)
    expect(result.channels[0]).toEqual({ name: '<b>Untrusted title</b>', group: 'News', url: 'https://provider.example/live/1.m3u8', mediaKind: 'live' })
  })
  it('retains header requirements for the player and skips unsafe URLs', () => {
    const text = '#EXTM3U\n#EXTINF:-1,Good\nhttps://example.com/a\n#EXTINF:-1,Bad\nfile:///private\n#EXTINF:-1,Headers\n#EXTVLCOPT:http-user-agent=Spoof\nhttps://example.com/b'
    const result = parseCatalog(text, source.url)
    expect(result.channels).toHaveLength(2); expect(result.skipped).toBe(1)
    expect(result.channels[1].playback?.headers).toEqual({ 'user-agent': 'Spoof' })
  })
  it('rejects HTML login and error responses', () => expect(() => parseCatalog('<html>secret provider error</html>', source.url)).toThrow('did not return an M3U'))
  it('direct streams require no catalog network request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    expect((await loadCatalog({ ...source, kind: 'direct' }, new AbortController().signal)).channels).toHaveLength(1)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not expose provider URLs/passwords in network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret provider URL')))
    await expect(loadCatalog(source, new AbortController().signal)).rejects.toThrow('Cannot reach the playlist')
  })
  it('sends no cookies and resolves against the redirected URL', async () => {
    const response = new Response('#EXTM3U\n#EXTINF:-1,One\nstream.m3u8')
    Object.defineProperty(response, 'url', { value: 'https://cdn.example/lists/final.m3u' })
    const fetch = vi.fn().mockResolvedValue(response); vi.stubGlobal('fetch', fetch)
    expect((await loadCatalog(source, new AbortController().signal)).channels[0].url).toBe('https://cdn.example/lists/stream.m3u8')
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
  })
  it('bounds streamed data even when Content-Length is absent', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_BYTES + 1)) }, cancel })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    await expect(loadCatalog(source, new AbortController().signal)).rejects.toThrow('256 MB')
    expect(cancel).toHaveBeenCalled()
  })
  it('loads a real streamed catalog above both old limits with no lost entries and yields to the UI', async () => {
    const count = 45000, encoder = new TextEncoder(), progress = vi.fn()
    let batch = 0, bytes = 0, uiTicks = 0
    const body = new ReadableStream({ pull(controller) {
      if (batch === count) { controller.close(); return }
      let text = batch === 0 ? '\uFEFF#EXTM3U\r\n' : ''
      for (let i = 0; i < 500 && batch < count; i++, batch++) text += `#EXTINF:-1 tvg-id="id-${batch}" tvg-logo="https://images.example/${'a'.repeat(120)}" group-title="Group ${batch % 40}",Channel ${batch}\r\nhttps://cdn.example/stream/${batch}.m3u8\r\n`
      const chunk = encoder.encode(text); bytes += chunk.length; controller.enqueue(chunk)
    } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    const heartbeat = setInterval(() => uiTicks++, 0)
    try {
      const catalog = await loadCatalog(source, new AbortController().signal, progress)
      expect(bytes).toBeGreaterThan(8 * 1024 * 1024)
      expect(catalog.channels).toHaveLength(count)
      expect(catalog.channels.at(-1)).toEqual({ name: 'Channel 44999', group: 'Group 39', tvgId: 'id-44999', url: 'https://cdn.example/stream/44999.m3u8', mediaKind: 'live', logo: `https://images.example/${'a'.repeat(120)}` })
      expect(progress.mock.calls.at(-1)![0]).toMatchObject({ bytes, channels: count, skipped: 0 })
      expect(uiTicks).toBeGreaterThan(0)
    } finally { clearInterval(heartbeat) }
  }, 15000)
  it('preserves split UTF-8, CRLF, metadata and an unterminated last line across single-byte chunks', async () => {
    const text = '\uFEFF#EXTM3U\r\n#EXTINF:-1 tvg-name="Réunion 📺",\r\n#EXTGRP:Français\r\nstream.m3u8'
    const bytes = new TextEncoder().encode(text); let offset = 0
    const body = new ReadableStream({ pull(controller) { if (offset === bytes.length) controller.close(); else controller.enqueue(bytes.subarray(offset, ++offset)) } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    expect((await loadCatalog(source, new AbortController().signal)).channels).toEqual([{ name: 'Réunion 📺', group: 'Français', url: 'https://provider.example/stream.m3u8', mediaKind: 'live' }])
  })
  it('cancels a stalled reader promptly and never returns a partial catalog', async () => {
    const controller = new AbortController(), cancelled = vi.fn()
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('#EXTM3U\n#EXTINF:-1,One\nhttps://example.com/one\n')) }, cancel: cancelled })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    const promise = loadCatalog(source, controller.signal, progress => { if (progress.channels) controller.abort() })
    // The first progress callback occurs before the read; cancellation remains
    // effective if the download then stalls without another chunk.
    setTimeout(() => controller.abort(), 15)
    await expect(promise).rejects.toThrow('cancelled')
    expect(cancelled).toHaveBeenCalledOnce()
  })
  it('uses an inactivity timeout rather than a total 20-second limit', async () => {
    vi.useFakeTimers()
    let network!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(c) { network = c } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    const promise = loadCatalog(source, new AbortController().signal)
    const result = expect(promise).resolves.toMatchObject({ channels: [{ name: 'One' }] })
    network.enqueue(new TextEncoder().encode('#EXTM3U\n'))
    await vi.advanceTimersByTimeAsync(25000)
    network.enqueue(new TextEncoder().encode('#EXTINF:-1,One\nhttps://example.com/one\n'))
    await vi.advanceTimersByTimeAsync(25000)
    network.close(); await result
  })
  it('times out a stalled response and suppresses private network errors', async () => {
    vi.useFakeTimers()
    const cancelled = vi.fn(), body = new ReadableStream({ cancel: cancelled })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    const result = expect(loadCatalog(source, new AbortController().signal)).rejects.toThrow('45 seconds')
    await vi.advanceTimersByTimeAsync(DOWNLOAD_IDLE_MS + 1); await result
    expect(cancelled).toHaveBeenCalled()
  })
  it('rejects a pathological line without retaining the rest of the response', async () => {
    const cancelled = vi.fn()
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('#EXTM3U\n' + '#'.repeat(MAX_LINE_LENGTH + 1))) }, cancel: cancelled })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    await expect(loadCatalog(source, new AbortController().signal)).rejects.toThrow('unusually long line')
    expect(cancelled).toHaveBeenCalled()
  })
  it('closes a declared oversized response before reading it', async () => {
    const cancelled = vi.fn(), body = new ReadableStream({ cancel: cancelled })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'Content-Length': String(MAX_BYTES + 1) } })))
    await expect(loadCatalog(source, new AbortController().signal)).rejects.toThrow('256 MB')
    expect(cancelled).toHaveBeenCalled()
  })
  it('stops fetching an HLS manifest once identified instead of listing media segments', async () => {
    const cancelled = vi.fn(), body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('#EXTM3U\n#EXT-X-TARGETDURATION:6\n')) }, cancel: cancelled })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    expect((await loadCatalog(source, new AbortController().signal)).channels).toEqual([{ name: 'Direct stream', group: 'Streams', url: source.url }])
    expect(cancelled).toHaveBeenCalled()
  })
  it('keeps the incremental parser equivalent to shared metadata parsing', () => {
    const text = '#EXTM3U x-tvg-url="https://example.com/epg.xml" catchup="append" catchup-days="4"\n#EXTINF:-1 group-title="News;Local" tvg-id="1",One\n#EXTVLCOPT:http-user-agent=Custom\nhttps://example.com/one\n#EXTINF:-1,Two\n#KODIPROP:inputstream.adaptive.license_type=widevine\nhttps://example.com/two'
    const entries: unknown[] = [], parser = createM3UParser(entry => entries.push(entry))
    text.split('\n').forEach(parser.writeLine)
    expect({ entries, ...parser.finish() }).toEqual(parseM3U(text))
    expect(entries).toHaveLength(2)
  })
})
