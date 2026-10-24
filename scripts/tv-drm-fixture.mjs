// Public, deliberately non-secret keys for our generated test pattern only.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
export const TEST_KID = '11223344556677889900aabbccddeeff'
export const TEST_KEY = '00112233445566778899aabbccddeeff'
const kid = Buffer.from(TEST_KID, 'hex').toString('base64url'), key = Buffer.from(TEST_KEY, 'hex').toString('base64url')
const license = JSON.stringify({ keys: [{ kty: 'oct', kid, k: key }], type: 'temporary' })
const PREFIX = '/_test/drm/'
export function createDRMFixture({ port, directory }) {
  const counts = { manifest: 0, segments: 0, licenses: 0, wrappedLicenses: 0, preflights: 0, rejected: 0 }
  return async function handle(request, response) {
    const path = new URL(request.url, 'http://127.0.0.1').pathname
    if (!path.startsWith(PREFIX)) return false
    const name = path.slice(PREFIX.length), isLicense = ['license', 'license-wrapped'].includes(name)
    const send = (status, type, body) => { response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Vary': 'Origin' }); response.end(body) }
    const reject = (status = 403) => { counts.rejected++; send(status, 'text/plain', 'Local DRM fixture request rejected.') }
    if (request.method === 'OPTIONS') {
      const allowed = isLicense ? ['content-type', 'x-lanternfin-license'] : ['x-lanternfin-media', 'range']
      const wanted = String(request.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean)
      if (wanted.some(value => !allowed.includes(value))) { reject(); return true }
      counts.preflights++; response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': isLicense ? 'POST' : 'GET', 'Access-Control-Allow-Headers': allowed.join(', '), 'Access-Control-Max-Age': '0', 'Cache-Control': 'no-store' }); response.end(); return true
    }
    if (!isLicense && request.method !== 'GET' || isLicense && request.method !== 'POST') { reject(405); return true }
    if (name === 'status') { send(200, 'application/json', JSON.stringify(counts)); return true }
    if (name === 'playlist.m3u') {
      // localhost is a different origin from the preview's 127.0.0.1 address.
      const base = `http://localhost:${port}${PREFIX}`, headers = 'X-Lanternfin-License=demo-license'
      const items = [
        ['Inline test keys', `${TEST_KID}:${TEST_KEY}`, true],
        ['License and custom headers', `${base}license|${headers}|R{SSM}|R`, true],
        ['Wrapped license and custom headers', `${base}license-wrapped|${headers}|{"challenge":"b{SSM}"}|JBlicense`, true],
        ['Expected failure - missing media header', `${TEST_KID}:${TEST_KEY}`, false],
        ['Expected failure - wrong license header', `${base}license|X-Lanternfin-License=wrong|R{SSM}|R`, true],
      ]
      const entries = items.map(([title, format, mediaHeader], index) => `#EXTINF:-1 tvg-type="movie" group-title="Local encrypted playback tests",${title}\n#KODIPROP:inputstream.adaptive.manifest_type=mpd\n#KODIPROP:inputstream.adaptive.license_type=org.w3.clearkey\n#KODIPROP:inputstream.adaptive.license_key=${format}\n${base}manifest.mpd?case=${index}${mediaHeader ? '|X-Lanternfin-Media=demo-media' : ''}\n`).join('')
      send(200, 'audio/x-mpegurl', '#EXTM3U\n' + entries); return true
    }
    if (isLicense) {
      if (request.headers['x-lanternfin-license'] !== 'demo-license' || request.headers['x-lanternfin-media']) { reject(); request.resume(); return true }
      let size = 0, chunks = []
      try {
        for await (const chunk of request) { size += chunk.length; if (size > 16384) { reject(413); request.resume(); return true } chunks.push(chunk) }
        let text = Buffer.concat(chunks).toString('utf8')
        if (name === 'license-wrapped') {
          const wrapped = JSON.parse(text)
          if (typeof wrapped.challenge !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(wrapped.challenge)) throw new Error()
          text = Buffer.from(wrapped.challenge, 'base64').toString('utf8')
        }
        const challenge = JSON.parse(text)
        if (challenge.type !== 'temporary' || !Array.isArray(challenge.kids) || challenge.kids.length !== 1 || challenge.kids[0] !== kid) throw new Error()
        if (name === 'license-wrapped') { counts.wrappedLicenses++; send(200, 'application/json', JSON.stringify({ license: Buffer.from(license).toString('base64') })) }
        else { counts.licenses++; send(200, 'application/json', license) }
      } catch { if (!response.headersSent) reject(400) }
      return true
    }
    if (!/^(manifest\.mpd|(?:video|audio)-(?:init\.mp4|[1-9]\d?\.m4s))$/.test(name)) { reject(404); return true }
    if (request.headers['x-lanternfin-media'] !== 'demo-media' || request.headers['x-lanternfin-license']) { reject(); return true }
    try {
      const bytes = await readFile(join(directory, name))
      if (bytes.length > 8 * 1024 * 1024) throw new Error()
      if (name === 'manifest.mpd') counts.manifest++; else counts.segments++
      send(200, name === 'manifest.mpd' ? 'application/dash+xml' : 'video/mp4', bytes)
    } catch { reject(404) }
    return true
  }
}
