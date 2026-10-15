import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { PairingSession } from '../pairing-service/src/index'
import { PairingAPI, PhonePairing, TVPairing } from '../src/shared/pairing/client'
import { SESSION_MS, createIdentity, randomToken } from '../src/shared/pairing/protocol'

class Storage {
  values = new Map<string, unknown>(); alarmAt = 0; queue = Promise.resolve<unknown>(undefined)
  async get<T>(key: string): Promise<T | undefined> { return structuredClone(this.values.get(key)) as T }
  async put(key: string, value: unknown) { this.values.set(key, structuredClone(value)) }
  async delete(key: string) { return this.values.delete(key) }
  async deleteAll() { this.values.clear() }
  async setAlarm(time: number) { this.alarmAt = time }
  transaction<T>(work: (storage: Storage) => Promise<T>): Promise<T> { const next = this.queue.then(() => work(this)); this.queue = next.catch(() => {}); return next }
}
let objects: Map<string, { object: PairingSession; storage: Storage }>, env: any, limited: boolean, requests: Array<{ url: string; body: string }>
const url = 'https://pair.example'
const account = { version: 1 as const, kind: 'xtream' as const, name: 'Home', url: 'https://provider.example', username: 'alice', password: 'private-password', epgUrl: '' }
function api() { return new PairingAPI(url, new AbortController().signal) }
async function call(path: string, method = 'GET', data?: unknown, token?: string) {
  return worker.fetch(new Request(url + path, { method, headers: { ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) }), env)
}
beforeEach(() => {
  objects = new Map(); requests = []; limited = false
  env = {
    SESSIONS: { idFromName: (id: string) => id, get: (id: string) => {
      if (!objects.has(id)) { const storage = new Storage(); objects.set(id, { storage, object: new PairingSession({ storage } as any) }) }
      return objects.get(id)!.object
    } },
    ASSETS: { fetch: () => new Response('<html>Phone setup</html>') },
    PAIRING_LIMITER: { limit: async () => ({ success: !limited }) }, POLL_LIMITER: { limit: async () => ({ success: !limited }) },
  }
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    requests.push({ url: input, body: String(init?.body || '') })
    return worker.fetch(new Request(input, init), env)
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('pairing relay and clients', () => {
  it('pairs, approves, transfers and acknowledges without giving the relay plaintext credentials', async () => {
    const tv = await TVPairing.create(api(), 'Living room TV')
    const fragment = new URLSearchParams(new URL(tv.link).hash.slice(1))
    const phone = await PhonePairing.join(api(), tv.code, fragment.get('key')!)
    expect(phone.deviceName).toBe('Living room TV')
    await expect(phone.send(account)).rejects.toThrow('approve')
    expect((await tv.poll()).confirmation).toBe(phone.confirmation)
    await expect(phone.confirmCodesMatch()).rejects.toThrow('Approve phone')
    await tv.approve(); await phone.confirmCodesMatch(); await phone.send(account)
    expect(await tv.poll()).toMatchObject({ status: 'offered', account })
    const stored = JSON.stringify([...objects.values()].map(value => [...value.storage.values]))
    for (const secret of [account.password, account.username, account.url]) { expect(stored).not.toContain(secret); expect(JSON.stringify(requests)).not.toContain(secret) }
    expect((await call(`/api/sessions/${tv.code}/tv`)).status).toBe(401)
    expect((await call(`/api/sessions/${tv.code}/tv`, 'GET', undefined, randomToken())).status).toBe(401)
    await tv.complete('accepted')
    expect(await phone.status()).toBe('accepted')
    expect(JSON.stringify([...objects.get(tv.code)!.storage.values])).not.toContain('ciphertext')
    await expect(phone.send(account)).rejects.toThrow()
  })

  it('pins the QR public key and refuses a substituted key', async () => {
    const tv = await TVPairing.create(api(), 'TV'), other = await createIdentity()
    await expect(PhonePairing.join(api(), tv.code, other.publicKey)).rejects.toThrow('does not match')
  })

  it('gives a late-joining phone only the session time remaining', async () => {
    const tv = await TVPairing.create(api(), 'TV')
    const storage = objects.get(tv.code)!.storage
    const stored = await storage.get<any>('session')
    stored.expiresAt = Date.now() + 30000; await storage.put('session', stored)
    const phone = await PhonePairing.join(api(), tv.code)
    expect(phone.deadline - Date.now()).toBeGreaterThan(28000)
    expect(phone.deadline - Date.now()).toBeLessThanOrEqual(30000)
  })

  it('bounds unexpected streamed responses before parsing them', async () => {
    const cancelled = vi.fn()
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(31000)) }, cancel: cancelled,
    })))
    await expect(api().request('')).rejects.toThrow('oversized')
    expect(cancelled).toHaveBeenCalled()
  })

  it('allows only one phone to claim a code even when requests arrive together', async () => {
    const tv = await TVPairing.create(api(), 'TV')
    const results = await Promise.allSettled([PhonePairing.join(api(), tv.code), PhonePairing.join(api(), tv.code)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
  })

  it('rejects a second envelope and a phone trying to approve itself', async () => {
    const identity = await createIdentity(), created = await (await call('/api/sessions', 'POST', { tvKey: identity.publicKey, deviceName: 'TV' })).json() as any
    const phone = await createIdentity(), joined = await (await call(`/api/sessions/${created.code}/claim`, 'POST', { phoneKey: phone.publicKey })).json() as any
    expect((await call(`/api/sessions/${created.code}/approve`, 'POST', {}, joined.phoneToken)).status).toBe(403)
    const envelope = { iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAA' }
    expect((await call(`/api/sessions/${created.code}/offer`, 'POST', { envelope }, joined.phoneToken)).status).toBe(409)
    expect((await call(`/api/sessions/${created.code}/approve`, 'POST', {}, created.tvToken)).status).toBe(200)
    expect((await call(`/api/sessions/${created.code}/offer`, 'POST', { envelope }, joined.phoneToken)).status).toBe(200)
    expect((await call(`/api/sessions/${created.code}/offer`, 'POST', { envelope }, joined.phoneToken)).status).toBe(409)
    expect((await call(`/api/sessions/${created.code}/phone`, 'GET', undefined, created.tvToken)).status).toBe(403)
    expect((await call(`/api/sessions/${created.code}/complete`, 'POST', { status: 'accepted' }, joined.phoneToken)).status).toBe(403)
  })

  it('cancels and expires sessions, with no payload surviving the expiry alarm', async () => {
    const tv = await TVPairing.create(api(), 'TV'), phone = await PhonePairing.join(api(), tv.code)
    await tv.cancel(); await expect(phone.status()).rejects.toMatchObject({ status: 410 })
    const next = await TVPairing.create(api(), 'TV'), nextPhone = await PhonePairing.join(api(), next.code)
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + SESSION_MS + 1)
    await expect(nextPhone.status()).rejects.toMatchObject({ status: 410 })
    await objects.get(next.code)!.object.alarm()
    expect(objects.get(next.code)!.storage.values.size).toBe(0)
  })

  it('rejects unexpected plaintext fields, oversized bodies, public initialization and URL query strings', async () => {
    const identity = await createIdentity()
    expect((await call('/api/sessions', 'POST', { tvKey: identity.publicKey, deviceName: 'TV', password: 'no-plaintext' })).status).toBe(400)
    expect((await call('/api/sessions', 'POST', { tvKey: identity.publicKey, deviceName: 'x'.repeat(27000) })).status).toBe(400)
    expect((await call('/api/sessions/ABCDEFGH/initialize', 'POST', {})).status).toBe(404)
    expect((await call('/api/sessions?password=test', 'POST', {})).status).toBe(400)
    expect(objects.size).toBe(0)
  })

  it('rate limits session creation and returns no-store/security headers on API and phone assets', async () => {
    limited = true
    const response = await call('/api/sessions', 'POST', {})
    expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('60')
    expect(response.headers.get('cache-control')).toBe('no-store')
    const asset = await call('/')
    expect(asset.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(asset.headers.get('referrer-policy')).toBe('no-referrer')
    expect((await call('/api/sessions', 'OPTIONS')).headers.get('access-control-allow-headers')).toContain('Authorization')
  })
})
