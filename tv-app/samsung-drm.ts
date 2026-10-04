import { browserHeaderProblem, webAddress, type Media } from './media'
import { licenseFormat, wrapLicense, unwrapLicense, type LicenseFormat } from './license-format'
import type { AVPlay } from './player'

type Plan = { properties: Record<string, string | boolean>; licenseUrl: string; headers: Record<string, string>; format: LicenseFormat; challenge: boolean }
const CHALLENGE_LIMIT = 512 * 1024, RESPONSE_LIMIT = 4 * 1024 * 1024
const nativeHeader = (name: string) => ['user-agent', 'cookie'].includes(name.toLowerCase())
const invalid = () => new Error('Unsupported Samsung PlayReady configuration.')
function checkedHeaders(values: Record<string, string> = {}) {
  const headers: Record<string, string> = Object.create(null), entries = Object.entries(values)
  if (entries.length > 64) throw invalid()
  let size = 0
  for (const [name, value] of entries) {
    if (!/^[!#$%&'*+.^_`|~\w-]{1,100}$/.test(name) || typeof value !== 'string' || /[\r\n\0]/.test(value) || value.length > 8192 || (size += value.length) > 65536 || Object.prototype.hasOwnProperty.call(headers, name.toLowerCase())) throw invalid()
    headers[name.toLowerCase()] = value
  }
  return headers
}

/** Native PlayReady fills the header gap; it never drops requirements to qualify. */
export function samsungPlayReadyPlan(media: Media): Plan | undefined {
  const options = media.playback, drm = options?.drm
  if (!options || options.problem || drm?.system !== 'com.microsoft.playready' || !drm.licenseUrl || drm.clearKeys) return
  const manifest = options.manifestType
  if (manifest ? !['mpd', 'dash'].includes(manifest) : !/\.mpd(?:\?|$)/i.test(media.url)) return
  try {
    webAddress(media.url)
    const mediaHeaders = checkedHeaders(options.headers)
    if (!Object.keys(mediaHeaders).every(nativeHeader)) return
    const licenseUrl = webAddress(drm.licenseUrl), headers = checkedHeaders(drm.headers), format = licenseFormat(drm.format?.request, drm.format?.response)
    if (licenseUrl.length > 8192) return
    const properties: Plan['properties'] = { DeleteLicenseAfterUse: true }
    const challenge = !browserHeaderProblem(headers)
    if (challenge) properties.GetChallenge = true
    else {
      // The native GetRights API has separate, documented Cookie/UserAgent fields.
      // Mixed arbitrary headers or transformed bodies cannot be represented here.
      if (Object.keys(headers).some(name => !nativeHeader(name)) || format.request || format.response) return
      properties.LicenseServer = licenseUrl
      if (Object.prototype.hasOwnProperty.call(headers, 'cookie') || Object.prototype.hasOwnProperty.call(mediaHeaders, 'cookie')) properties.Cookie = headers.cookie || ''
      if (Object.prototype.hasOwnProperty.call(headers, 'user-agent') || Object.prototype.hasOwnProperty.call(mediaHeaders, 'user-agent')) properties.UserAgent = headers['user-agent'] || ''
    }
    return { properties, licenseUrl, headers, format, challenge }
  } catch { return }
}
export function needsSamsungPlayReady(media: Media) {
  return !!samsungPlayReadyPlan(media) && !!(browserHeaderProblem(media.playback?.headers) || browserHeaderProblem(media.playback?.drm?.headers))
}

function decodeChallenge(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(CHALLENGE_LIMIT / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw invalid()
  const binary = atob(value)
  if (binary.length > CHALLENGE_LIMIT) throw invalid()
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}
function encodeLicense(bytes: Uint8Array) {
  let binary = ''
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192))
  return btoa(binary)
}
function untilAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(invalid()) }
    if (signal.aborted) { promise.catch(() => {}); reject(invalid()); return }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
  })
}

/** One license exchange at a time; no native identifiers/challenges enter reports. */
export function samsungPlayReady(api: AVPlay, plan: Plan, fail: (message: string) => void) {
  let closed = false, active: string | undefined, controller: AbortController | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: ReturnType<typeof setTimeout> | undefined
  const queue: string[] = []
  const close = () => { closed = true; queue.length = 0; active = undefined; clearTimeout(timer); controller?.abort(); void reader?.cancel().catch(() => {}); reader = undefined }
  const error = (message: string) => { if (!closed) { close(); fail(message) } }
  const set = (operation: 'SetProperties' | 'InstallLicense', value: string) => {
    if (!api.setDrm) throw invalid()
    const result = api.setDrm('PLAYREADY', operation, value)
    if (result === false || typeof result === 'string' && result.toUpperCase() === 'FALSE') throw invalid()
  }
  async function exchange(challenge: string) {
    active = challenge; controller = new AbortController(); const signal = controller.signal
    let stage = 'request'
    timer = setTimeout(() => error('The Samsung PlayReady license request timed out. Check provider access and retry.'), 20000)
    try {
      const raw = decodeChallenge(challenge), body = plan.format.request ? wrapLicense(raw, plan.format.request) : raw
      const headers = { 'content-type': 'text/xml', ...plan.headers }
      const request = fetch(plan.licenseUrl, { method: 'POST', body: body as BodyInit, headers, signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error' })
      void request.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}) }, () => {})
      const response = await untilAbort(request, signal)
      if (closed || signal.aborted) { void response.body?.cancel().catch(() => {}); return }
      if (!response.ok) { void response.body?.cancel().catch(() => {}); throw invalid() }
      stage = 'response'
      if (!response.body || Number(response.headers.get('content-length')) > RESPONSE_LIMIT) { void response.body?.cancel().catch(() => {}); throw invalid() }
      // A byte budget alone does not bound an array of millions of tiny chunks.
      const bytes = new Uint8Array(RESPONSE_LIMIT)
      reader = response.body.getReader(); let length = 0, reads = 0
      while (true) {
        const part = await untilAbort(reader.read(), signal)
        if (part.done) break
        if (length + part.value.byteLength > RESPONSE_LIMIT) throw invalid()
        bytes.set(part.value, length); length += part.value.byteLength
        if (++reads % 256 === 0) await untilAbort(new Promise<void>(resolve => setTimeout(resolve, 0)), signal)
      }
      if (closed || signal.aborted) return
      const payload = bytes.subarray(0, length), license = plan.format.response ? unwrapLicense(payload, plan.format.response) : payload
      if (!license.length) throw invalid()
      stage = 'install'; set('InstallLicense', encodeLicense(license))
    } catch {
      error(stage === 'install' ? 'The Samsung player rejected the PlayReady license. Check provider authorization and device support.' : stage === 'response' ? 'The PlayReady license response is empty, too large, or has an unsupported format.' : 'The PlayReady license request failed. Check provider authorization, license headers, network access and cross-origin permissions.')
    } finally {
      clearTimeout(timer); void reader?.cancel().catch(() => {}); reader = undefined; controller?.abort(); controller = undefined; active = undefined
      if (!closed && queue.length) void exchange(queue.shift()!)
    }
  }
  return {
    close,
    configure() { if (closed) return; try { set('SetProperties', JSON.stringify(plan.properties)) } catch { error('The Samsung player could not configure PlayReady. Check device support and reinstall the complete app package.') } },
    event(type: unknown, data: unknown) {
      if (closed || type !== 'PLAYREADY' || !data || typeof data !== 'object') return
      const event = data as { name?: unknown; challenge?: unknown }
      if (event.name === 'DrmError') { error('Samsung PlayReady failed. Check provider authorization, license settings and device support.'); return }
      if (event.name !== 'Challenge') return
      if (!plan.challenge) { error('The Samsung player requested an unexpected PlayReady license exchange.'); return }
      try { decodeChallenge(event.challenge) } catch { error('The Samsung player supplied an invalid PlayReady license challenge.'); return }
      const challenge = event.challenge as string
      if (challenge === active || queue.includes(challenge)) return
      if (active) { if (queue.length >= 3) error('Too many simultaneous PlayReady license requests. Retry the stream.'); else queue.push(challenge) }
      else void exchange(challenge)
    },
  }
}
