// Shared by the TV, phone page and relay. Provider credentials only appear in
// PairingAccount on the two clients; the relay receives an opaque envelope.
export const SESSION_MS = 5 * 60 * 1000
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export const CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
export const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{87}$/
export type PairingAccount = { version: 1; kind: 'xtream' | 'm3u'; name: string; url: string; username: string; password: string; epgUrl: string }
export type Envelope = { iv: string; ciphertext: string }
export type PairingIdentity = { privateKey: CryptoKey; publicKey: string }
export type PairingSecret = { key: CryptoKey; confirmation: string }

export function encode64(bytes: Uint8Array): string {
  let value = ''; for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function decode64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid pairing data.')
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  const result = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) result[index] = binary.charCodeAt(index)
  if (encode64(result) !== value) throw new Error('Invalid pairing data.')
  return result
}
export function randomToken(): string { return encode64(crypto.getRandomValues(new Uint8Array(32))) }
export function normalizeCode(value: string): string { return value.toUpperCase().replace(/[\s-]/g, '') }
export function displayCode(code: string): string { return `${code.slice(0, 4)} ${code.slice(4)}` }
export function serviceOrigin(value: string): string {
  const url = new URL(value)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('Phone setup requires a secure service address.')
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid phone setup service address.')
  return url.origin
}
function address(value: unknown, optional = false): string {
  if (optional && value === '') return ''
  if (typeof value !== 'string' || !value.trim() || value.length > 8192) throw new Error('Enter a valid provider address.')
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS provider address.')
  url.hash = ''; return url.href
}
export function validateAccount(value: unknown): PairingAccount {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid account details.')
  const input = value as Record<string, unknown>
  if (input.version !== 1 || !['xtream', 'm3u'].includes(String(input.kind))) throw new Error('Unsupported account type.')
  for (const field of ['name', 'username', 'password']) if (typeof input[field] !== 'string' || (input[field] as string).length > (field === 'name' ? 80 : 1024)) throw new Error('Account details are too long.')
  const kind = input.kind as PairingAccount['kind']
  let url = address(input.url), username = (input.username as string).trim(), password = (input.password as string).trim()
  if (kind === 'xtream') {
    const parsed = new URL(url)
    username ||= parsed.searchParams.get('username') || ''
    password ||= parsed.searchParams.get('password') || ''
    if (!username || !password || username.length > 1024 || password.length > 1024) throw new Error('Enter your provider username and password.')
    parsed.pathname = parsed.pathname.replace(/\/(?:player_api|get)\.php\/?$/i, '').replace(/\/$/, '') || '/'
    parsed.search = ''; url = parsed.href.replace(/\/$/, '')
  } else { username = ''; password = '' }
  return { version: 1, kind, name: (input.name as string).trim(), url, username, password, epgUrl: address(input.epgUrl ?? '', true) }
}
export async function createIdentity(): Promise<PairingIdentity> {
  if (!globalThis.crypto?.subtle) throw new Error('Secure phone setup is unavailable on this device. You can still enter your account on the TV.')
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  return { privateKey: keys.privateKey, publicKey: encode64(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))) }
}
export async function validatePublicKey(value: unknown): Promise<string> {
  if (typeof value !== 'string' || !PUBLIC_KEY_PATTERN.test(value)) throw new Error('Invalid pairing key.')
  await crypto.subtle.importKey('raw', decode64(value), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  return value
}
function context(code: string, tvKey: string, phoneKey: string): Uint8Array<ArrayBuffer> {
  if (!CODE_PATTERN.test(code)) throw new Error('Invalid pairing code.')
  return new TextEncoder().encode(`Lanternfin account pairing v1\n${code}\n${tvKey}\n${phoneKey}`)
}
export async function sharedSecret(identity: PairingIdentity, peerKey: string, code: string, tvKey: string, phoneKey: string): Promise<PairingSecret> {
  await validatePublicKey(peerKey)
  if (identity.publicKey !== tvKey && identity.publicKey !== phoneKey) throw new Error('Pairing keys do not match.')
  const peer = await crypto.subtle.importKey('raw', decode64(peerKey), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, identity.privateKey, 256))
  const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits'])
  shared.fill(0)
  const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('Lanternfin pairing v1'), info: context(code, tvKey, phoneKey) }, material, 288))
  const key = await crypto.subtle.importKey('raw', derived.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt'])
  const confirmation = (new DataView(derived.buffer).getUint32(32) % 1000000).toString().padStart(6, '0')
  derived.fill(0)
  return { key, confirmation }
}
export function validateEnvelope(input: unknown): Envelope {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid encrypted account.')
  const value = input as Record<string, unknown>
  if (Object.keys(value).some(key => key !== 'iv' && key !== 'ciphertext') || typeof value.iv !== 'string' || value.iv.length !== 16 || typeof value.ciphertext !== 'string' || value.ciphertext.length < 24 || value.ciphertext.length > 24576) throw new Error('Invalid encrypted account.')
  if (decode64(value.iv).length !== 12) throw new Error('Invalid encrypted account.')
  decode64(value.ciphertext)
  return { iv: value.iv, ciphertext: value.ciphertext }
}
export async function encryptAccount(account: PairingAccount, secret: PairingSecret, code: string, tvKey: string, phoneKey: string): Promise<Envelope> {
  const bytes = new TextEncoder().encode(JSON.stringify(validateAccount(account)))
  if (bytes.length > 18000) throw new Error('Account details are too long.')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  try { return { iv: encode64(iv), ciphertext: encode64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context(code, tvKey, phoneKey) }, secret.key, bytes))) } }
  finally { bytes.fill(0) }
}
export async function decryptAccount(input: Envelope, secret: PairingSecret, code: string, tvKey: string, phoneKey: string): Promise<PairingAccount> {
  const envelope = validateEnvelope(input)
  let bytes: Uint8Array<ArrayBuffer>
  try { bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode64(envelope.iv), additionalData: context(code, tvKey, phoneKey) }, secret.key, decode64(envelope.ciphertext))) }
  catch { throw new Error('The account transfer could not be verified. Start a new pairing session.') }
  try { return validateAccount(JSON.parse(new TextDecoder().decode(bytes))) } finally { bytes.fill(0) }
}
