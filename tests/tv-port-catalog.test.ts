import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpUrl, loadCatalog, MAX_BYTES, parseCatalog, playlistUrl, validateSource, type Source } from '../tv-app/catalog'
const source: Source = { kind: 'playlist', url: 'https://provider.example/list.m3u', username: '', password: '' }
afterEach(() => vi.unstubAllGlobals())
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
    expect(result.channels[0]).toEqual({ name: '<b>Untrusted title</b>', group: 'News', url: 'https://provider.example/live/1.m3u8' })
  })
  it('reports unsupported headers/DRM/URLs instead of playing them silently', () => {
    const text = '#EXTM3U\n#EXTINF:-1,Good\nhttps://example.com/a\n#EXTINF:-1,Bad\nfile:///private\n#EXTINF:-1,Headers\n#EXTVLCOPT:http-user-agent=Spoof\nhttps://example.com/b'
    const result = parseCatalog(text, source.url)
    expect(result.channels).toHaveLength(1); expect(result.skipped).toBe(2)
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
    await expect(loadCatalog(source, new AbortController().signal)).rejects.toThrow('8 MB')
    expect(cancel).toHaveBeenCalled()
  })
})
