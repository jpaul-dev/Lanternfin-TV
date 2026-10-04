/** Declarative Kodi-compatible wrapping. Never evaluates provider scripts or weakens DRM policy. */
export type LicenseFormat = { request?: string; response?: string }
const LIMIT = 4 * 1024 * 1024
const invalid = () => new Error('The provider license format is invalid or unsupported.')
export function licenseFormat(request = '', response = ''): LicenseFormat {
  if (request.length > 16384 || response.length > 256) throw invalid()
  if (/%7BSSM%7D/i.test(request)) { try { request = decodeURIComponent(request) } catch { throw invalid() } }
  const result: LicenseFormat = {}
  if (request && request !== 'R{SSM}') {
    const markers = request.match(/[RbBDH]?\{(?:SSM|SID|KID|PSSH|HASH)\}/g) || []
    if (!markers.length || markers.some(marker => !/^[bBD]\{SSM\}$/.test(marker)) || /\{[A-Z_]+\}/.test(request.replace(/[bBD]\{SSM\}/g, ''))) throw invalid()
    result.request = request
  }
  if (response && response !== 'R') {
    // A second JSON token can specify an HDCP limit. Reject it instead of ignoring protection requirements.
    if (response !== 'B' && !/^J(B)?[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(response)) throw invalid()
    result.response = response
  }
  return result
}
function bytes(value: ArrayBuffer | ArrayBufferView | string | null | undefined): Uint8Array {
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (!value) throw invalid()
  return ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value)
}
function base64(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192))
  return btoa(binary)
}
function decodeBase64(value: string): Uint8Array {
  const encoded = value.replace(/[\t\r\n ]/g, '')
  if (!encoded || encoded.length > LIMIT || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw invalid()
  try { return Uint8Array.from(atob(encoded), char => char.charCodeAt(0)) } catch { throw invalid() }
}
export function wrapLicense(value: ArrayBuffer | ArrayBufferView | string | null | undefined, template: string): Uint8Array {
  if (typeof value === 'string' && value.length > 512 * 1024) throw invalid()
  const data = bytes(value)
  if (data.byteLength > 512 * 1024) throw invalid()
  // Validate again at the trust boundary, including manually supplied Media objects.
  if (licenseFormat(template).request !== template) throw invalid()
  let encoded: string | undefined, decimal: string | undefined, escaped: string | undefined
  const encoder = new TextEncoder(), parts: string[] = [], markers = /([bBD])\{SSM\}/g
  let offset = 0, length = 0, match: RegExpExecArray | null
  while ((match = markers.exec(template))) {
    const literal = template.slice(offset, match.index), prefix = match[1]
    const replacement = prefix === 'D' ? decimal ??= data.join(',') : prefix === 'B' ? escaped ??= encodeURIComponent(encoded ??= base64(data)) : encoded ??= base64(data)
    // Reject expansion before concatenating or encoding the amplified template.
    length += encoder.encode(literal).byteLength + replacement.length
    if (length > LIMIT) throw invalid()
    parts.push(literal, replacement); offset = match.index + match[0].length
  }
  const tail = template.slice(offset)
  if (length + encoder.encode(tail).byteLength > LIMIT) throw invalid()
  parts.push(tail); return encoder.encode(parts.join(''))
}
export function unwrapLicense(value: ArrayBuffer | ArrayBufferView | string, format: string): Uint8Array {
  if (licenseFormat('', format).response !== format) throw invalid()
  const data = bytes(value)
  if (data.byteLength > LIMIT) throw invalid()
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(data) } catch { throw invalid() }
  if (format === 'B') return decodeBase64(text)
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw invalid() }
  const field = format.slice(format.startsWith('JB') ? 2 : 1)
  if (!parsed || typeof parsed !== 'object' || !Object.prototype.hasOwnProperty.call(parsed, field)) throw invalid()
  const result = (parsed as Record<string, unknown>)[field]
  if (typeof result !== 'string') throw invalid()
  if (format.startsWith('JB')) return decodeBase64(result)
  if (!result) throw invalid()
  for (let i = 0; i < result.length; i++) if (result.charCodeAt(i) > 255) throw invalid()
  return Uint8Array.from(result, char => char.charCodeAt(0))
}
