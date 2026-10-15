import { CODE_ALPHABET, CODE_PATTERN, SESSION_MS, TOKEN_PATTERN, encode64, randomToken, validateEnvelope, validatePublicKey, type Envelope } from '../../src/shared/pairing/protocol'

type Status = 'waiting' | 'claimed' | 'paired' | 'offered' | 'accepted' | 'rejected' | 'failed'
type Session = {
  code: string; expiresAt: number; status: Status; deviceName: string;
  tvKey: string; tvTokenHash: string; phoneKey?: string; phoneTokenHash?: string; envelope?: Envelope;
}
type RelayEnv = {
  SESSIONS: DurableObjectNamespace;
  ASSETS: Fetcher;
  PAIRING_LIMITER: RateLimit;
  POLL_LIMITER: RateLimit;
}
const baseHeaders = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
}
const apiHeaders = { ...baseHeaders, 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' }
const reply = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: apiHeaders })
const expired = () => reply(410, { error: 'This pairing session ended. Open a new code on your TV.' })

async function hash(value: string): Promise<string> { return encode64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))) }
function newCode(): string {
  // The alphabet contains 32 symbols, so masking is uniform.
  return [...crypto.getRandomValues(new Uint8Array(8))].map(byte => CODE_ALPHABET[byte & 31]).join('')
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new Error('Use a JSON request.')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('Missing request.')
  let size = 0, text = ''; const decoder = new TextDecoder()
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break
      size += next.value.byteLength
      if (size > 26000) throw new Error('Request is too large.')
      text += decoder.decode(next.value, { stream: true })
    }
    const value = JSON.parse(text + decoder.decode())
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request.')
    return value
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
}
function exactFields(body: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new Error('Unexpected request fields.')
}

// No public endpoint can initialize or replace an existing object directly.
// The outer Worker is the only caller of /initialize.
export class PairingSession {
  constructor(private ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname
      const data = request.method === 'POST' ? await readBody(request) : {}
      let tokenHash = ''
      if (path !== '/initialize' && path !== '/claim') {
        const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || ''
        if (!TOKEN_PATTERN.test(token)) return reply(401, { error: 'This device is not paired.' })
        tokenHash = await hash(token)
      }
      if (path === '/initialize') {
        exactFields(data, ['code', 'tvKey', 'tvTokenHash', 'deviceName'])
        if (typeof data.code !== 'string' || !CODE_PATTERN.test(data.code) || typeof data.tvTokenHash !== 'string' || !TOKEN_PATTERN.test(data.tvTokenHash) || typeof data.deviceName !== 'string' || data.deviceName.length > 60) return reply(400, { error: 'Invalid session.' })
        await validatePublicKey(data.tvKey)
      }
      let phoneToken = '', phoneTokenHash = ''
      if (path === '/claim' && request.method === 'POST') {
        exactFields(data, ['phoneKey']); await validatePublicKey(data.phoneKey)
        phoneToken = randomToken(); phoneTokenHash = await hash(phoneToken)
      }
      if (path === '/offer') { exactFields(data, ['envelope']); data.envelope = validateEnvelope(data.envelope) }
      if (path === '/approve') exactFields(data, [])
      if (path === '/complete') { exactFields(data, ['status']); if (!['accepted', 'rejected', 'failed'].includes(String(data.status))) return reply(400, { error: 'Invalid completion state.' }) }

      // All state transitions are atomic, including simultaneous claims/offers.
      return await this.ctx.storage.transaction(async storage => {
        let session = await storage.get<Session>('session')
        const now = Date.now()
        if (path === '/initialize' && request.method === 'POST') {
          if (session && session.expiresAt > now) return reply(409, { error: 'Code already in use.' })
          session = { code: String(data.code), tvKey: String(data.tvKey), tvTokenHash: String(data.tvTokenHash), deviceName: String(data.deviceName), expiresAt: now + SESSION_MS, status: 'waiting' }
          await storage.put('session', session); await storage.setAlarm(session.expiresAt)
          return reply(201, { code: session.code, expiresInMs: SESSION_MS })
        }
        if (!session || session.expiresAt <= now) { if (session) await storage.delete('session'); return expired() }
        if (path === '/claim' && request.method === 'POST') {
          if (session.status !== 'waiting') return reply(409, { error: 'A phone already joined. Start a new code on the TV if it was not yours.' })
          session.phoneKey = String(data.phoneKey); session.phoneTokenHash = phoneTokenHash; session.status = 'claimed'
          await storage.put('session', session)
          return reply(200, { phoneToken, tvKey: session.tvKey, deviceName: session.deviceName, expiresInMs: session.expiresAt - now })
        }
        const television = tokenHash === session.tvTokenHash, phone = !!session.phoneTokenHash && tokenHash === session.phoneTokenHash
        if (!television && !phone) return reply(401, { error: 'This device is not paired.' })
        if (path === '/tv' && television && request.method === 'GET') return reply(200, { status: session.status, expiresAt: session.expiresAt, ...(session.phoneKey ? { phoneKey: session.phoneKey } : {}), ...(session.envelope ? { envelope: session.envelope } : {}) })
        if (path === '/phone' && phone && request.method === 'GET') return reply(200, { status: session.status, expiresAt: session.expiresAt })
        if (path === '/approve' && television && request.method === 'POST') {
          if (session.status !== 'claimed') return reply(409, { error: 'No phone is awaiting approval.' })
          session.status = 'paired'; await storage.put('session', session)
          return reply(200, { status: session.status })
        }
        if (path === '/offer' && phone && request.method === 'POST') {
          if (session.status !== 'paired') return reply(409, { error: 'Approve the phone on your TV before sending an account. Each session accepts one account.' })
          session.envelope = data.envelope as Envelope; session.status = 'offered'
          await storage.put('session', session); return reply(200, { status: session.status })
        }
        if (path === '/complete' && television && request.method === 'POST') {
          if (session.status === data.status && ['accepted', 'rejected', 'failed'].includes(session.status)) return reply(200, { status: session.status })
          if (session.status !== 'offered' && !(data.status === 'rejected' && ['claimed', 'paired'].includes(session.status))) return reply(409, { error: 'No account is awaiting approval.' })
          session.status = data.status as Status
          // Discard the encrypted payload as soon as the TV finishes or rejects.
          delete session.envelope; delete session.phoneKey; session.tvKey = ''
          await storage.put('session', session); return reply(200, { status: session.status })
        }
        if (path === '/cancel' && television && request.method === 'DELETE') { await storage.delete('session'); return reply(200, { status: 'cancelled' }) }
        return reply(403, { error: 'This device cannot perform that action.' })
      })
    } catch { return reply(400, { error: 'Invalid pairing request.' }) }
  }

  async alarm(): Promise<void> {
    const session = await this.ctx.storage.get<Session>('session')
    if (session && session.expiresAt > Date.now()) await this.ctx.storage.setAlarm(session.expiresAt)
    else await this.ctx.storage.deleteAll()
  }
}

export default {
  async fetch(request: Request, env: RelayEnv): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) {
      const asset = await env.ASSETS.fetch(request)
      const response = new Response(asset.body, asset)
      for (const [key, value] of Object.entries(baseHeaders)) response.headers.set(key, value)
      return response
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: apiHeaders })
    if (url.search) return reply(400, { error: 'Pairing API requests do not use query parameters.' })
    try {
      const match = url.pathname.match(/^\/api\/sessions\/([23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8})\/(claim|tv|phone|approve|offer|complete|cancel)$/)
      const creating = url.pathname === '/api/sessions' && request.method === 'POST'
      if (!creating && !match) return reply(404, { error: 'Unknown pairing action.' })
      const polling = request.method === 'GET' && (match?.[2] === 'tv' || match?.[2] === 'phone')
      const limiter = polling ? env.POLL_LIMITER : env.PAIRING_LIMITER
      // Anonymous session creation/claiming needs a coarse network limit. Polls
      // use per-capability keys so shared home/mobile networks remain usable.
      const actor = polling ? await hash(request.headers.get('authorization') || '') : request.headers.get('CF-Connecting-IP') || 'local'
      if (!(await limiter.limit({ key: `lanternfin:v1:${actor}` })).success) {
        const response = reply(429, { error: 'Too many pairing attempts. Wait a minute and try again.' }); response.headers.set('Retry-After', '60'); return response
      }
      if (creating) {
        const data = await readBody(request); exactFields(data, ['tvKey', 'deviceName'])
        await validatePublicKey(data.tvKey)
        if (typeof data.deviceName !== 'string' || !data.deviceName.trim() || data.deviceName.length > 60 || /[\u0000-\u001f]/.test(data.deviceName)) return reply(400, { error: 'Invalid TV name.' })
        for (let attempt = 0; attempt < 4; attempt++) {
          const code = newCode(), tvToken = randomToken()
          const stub = env.SESSIONS.get(env.SESSIONS.idFromName(code))
          const result = await stub.fetch(new Request('https://session/initialize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, tvKey: data.tvKey, deviceName: data.deviceName.trim(), tvTokenHash: await hash(tvToken) }) }))
          if (result.status === 409) continue
          if (!result.ok) return reply(503, { error: 'Phone setup is temporarily unavailable.' })
          return reply(201, { ...(await result.json() as object), tvToken })
        }
        return reply(503, { error: 'Could not create a pairing code. Try again.' })
      }
      const [, code, action] = match!
      const validMethod = ['tv', 'phone'].includes(action) ? 'GET' : action === 'cancel' ? 'DELETE' : 'POST'
      if (request.method !== validMethod) return reply(405, { error: 'Method not allowed.' })
      const stub = env.SESSIONS.get(env.SESSIONS.idFromName(code))
      return await stub.fetch(new Request(`https://session/${action}`, request))
    } catch { return reply(400, { error: 'Invalid pairing request.' }) }
  },
} satisfies ExportedHandler<RelayEnv>
