import { describe, expect, it } from 'vitest'
import { browserHeaderProblem, providerMedia } from '../tv-app/media'
import { parseCatalog } from '../tv-app/catalog'
const base = 'https://provider.example/list.m3u'
describe('provider playback metadata', () => {
  it('retains protected entries, artwork, and separate media/license authentication', () => {
    const entry = parseCatalog('#EXTM3U\n#EXTINF:-1 tvg-type="movie" tvg-logo="poster.jpg",A movie\n#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha\n#KODIPROP:inputstream.adaptive.license_key=https://license.example/get|Authorization=Bearer%20license|R{SSM}|\nhttps://cdn.example/movie.mpd|Authorization=Bearer%20media', base).channels[0]
    expect(entry).toMatchObject({ logo: 'https://provider.example/poster.jpg', mediaKind: 'movie', playback: { headers: { authorization: 'Bearer media' }, drm: { system: 'com.widevine.alpha', licenseUrl: 'https://license.example/get', headers: { authorization: 'Bearer license' } } } })
    expect(entry.playback?.problem).toBeUndefined()
  })
  it('does not guess custom license transformations or discard the channel', () => {
    const result = providerMedia({ url: 'a.mpd', drmScheme: 'widevine', licenseKey: 'https://license.example/|Token=x|B{SSM}|JBlicense' }, base)
    expect(result.playback?.problem).toContain('custom license')
  })
  it('rejects header injection and unsafe license URLs without exposing their contents', () => {
    const result = providerMedia({ url: 'a.mpd|Authorization=secret%0d%0aX-Evil%3Atrue' }, base)
    expect(result.playback?.problem).toContain('invalid'); expect(result.playback?.problem).not.toContain('secret')
    expect(providerMedia({ url: 'a.mpd', drmScheme: 'widevine', licenseKey: 'javascript:secret' }, base).playback?.problem).toContain('invalid')
  })
  it('supports explicitly supplied ClearKey values and labels restricted headers', () => {
    const result = providerMedia({ url: 'a.mpd', drmScheme: 'clearkey', licenseKey: `${'a'.repeat(32)}:${'b'.repeat(32)}` }, base)
    expect(result.playback?.drm?.clearKeys).toEqual({ ['a'.repeat(32)]: 'b'.repeat(32) })
    expect(browserHeaderProblem({ Referer: 'secret', 'User-Agent': 'secret' })).toContain('Referer, User-Agent')
    expect(browserHeaderProblem({ Authorization: 'secret' })).toBeUndefined()
  })
})
