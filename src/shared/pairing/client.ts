import { CODE_PATTERN, SESSION_MS, TOKEN_PATTERN, createIdentity, decryptAccount, encryptAccount, normalizeCode, serviceOrigin, sharedSecret, validatePublicKey, type Envelope, type PairingAccount, type PairingIdentity, type PairingSecret } from './protocol'

export class PairingError extends Error { constructor(message: string, readonly status = 0) { super(message) } }
function deadline(response: Record<string, any>, started: number): number {
  const remaining = response.expiresInMs
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > SESSION_MS) throw new PairingError('Invalid pairing expiry.', 400)
  // Use a duration so an incorrectly set TV clock cannot extend the session.
  return started + remaining
}

async function readResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) throw new PairingError('The pairing service returned an empty response.', 502)
  const decoder = new TextDecoder(); let size = 0, text = ''
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break
      size += next.value.byteLength
      if (size > 30000) throw new PairingError('The pairing service returned an oversized response.', 502)
      text += decoder.decode(next.value, { stream: true })
    }
    return text + decoder.decode()
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
}
export class PairingAPI {
  readonly origin: string
  constructor(origin: string, private signal: AbortSignal) { this.origin = serviceOrigin(origin) }
  async request(path: string, method = 'GET', data?: unknown, token?: string): Promise<Record<string, any>> {
    if (this.signal.aborted) throw new PairingError('Pairing cancelled.')
    const controller = new AbortController(), abort = () => controller.abort()
    this.signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, 15000)
    try {
      const headers: Record<string, string> = {}
      if (data !== undefined) headers['Content-Type'] = 'application/json'
      if (token) headers.Authorization = `Bearer ${token}`
      const response = await fetch(`${this.origin}/api/sessions${path}`, { method, headers, ...(data !== undefined ? { body: JSON.stringify(data) } : {}), signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' })
      const text = await readResponse(response)
      let value: Record<string, any>
      try { value = JSON.parse(text) } catch { throw new PairingError('The pairing service is unavailable. Try again shortly.', response.status) }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PairingError('Invalid pairing response.')
      if (!response.ok) throw new PairingError(typeof value.error === 'string' ? value.error.slice(0, 180) : 'Phone setup could not continue.', response.status)
      return value
    } catch (error) {
      if (error instanceof PairingError) throw error
      throw new PairingError(this.signal.aborted ? 'Pairing cancelled.' : 'Cannot reach phone setup. Check your connection and try again.')
    } finally { clearTimeout(timer); this.signal.removeEventListener('abort', abort) }
  }
}

export class TVPairing {
  private phoneKey = ''
  private secret?: PairingSecret
  private done = false
  private approved = false
  private constructor(readonly api: PairingAPI, readonly code: string, private token: string, private identity: PairingIdentity, readonly deadline: number) {}
  static async create(api: PairingAPI, deviceName: string): Promise<TVPairing> {
    const identity = await createIdentity()
    const started = Date.now(), session = await api.request('', 'POST', { tvKey: identity.publicKey, deviceName })
    if (typeof session.code !== 'string' || !CODE_PATTERN.test(session.code) || typeof session.tvToken !== 'string' || !TOKEN_PATTERN.test(session.tvToken)) throw new PairingError('Invalid pairing session.')
    return new TVPairing(api, session.code, session.tvToken, identity, deadline(session, started))
  }
  get link(): string { return `${this.api.origin}/#${new URLSearchParams({ code: this.code, key: this.identity.publicKey })}` }
  async poll(): Promise<{ status: string; account?: PairingAccount; confirmation?: string }> {
    if (Date.now() >= this.deadline) throw new PairingError('This code expired. Start a new pairing session.', 410)
    const response = await this.api.request(`/${this.code}/tv`, 'GET', undefined, this.token)
    if (response.status === 'offered' && !this.approved) throw new PairingError('An account arrived before you approved the phone. Start a new session.')
    if (!['claimed', 'paired', 'offered'].includes(response.status)) return { status: response.status }
    if (!this.secret) {
      this.phoneKey = await validatePublicKey(response.phoneKey)
      this.secret = await sharedSecret(this.identity, this.phoneKey, this.code, this.identity.publicKey, this.phoneKey)
    } else if (response.phoneKey !== this.phoneKey) throw new PairingError('The paired phone changed. Start a new session.')
    if (response.status !== 'offered') return { status: response.status, confirmation: this.secret.confirmation }
    const account = await decryptAccount(response.envelope as Envelope, this.secret, this.code, this.identity.publicKey, this.phoneKey)
    return { status: 'offered', account, confirmation: this.secret.confirmation }
  }
  async approve(): Promise<void> { await this.api.request(`/${this.code}/approve`, 'POST', {}, this.token); this.approved = true }
  async complete(status: 'accepted' | 'rejected' | 'failed'): Promise<void> {
    try { await this.api.request(`/${this.code}/complete`, 'POST', { status }, this.token) }
    catch (error) {
      if (!(error instanceof PairingError) || error.status) throw error
      await this.api.request(`/${this.code}/complete`, 'POST', { status }, this.token)
    }
    this.done = true; this.secret = undefined
  }
  async cancel(): Promise<void> {
    this.secret = undefined
    if (!this.done) { this.done = true; await new PairingAPI(this.api.origin, new AbortController().signal).request(`/${this.code}/cancel`, 'DELETE', undefined, this.token) }
    this.token = ''
  }
}

export class PhonePairing {
  private confirmed = false
  private sent = false
  private sending = false
  private constructor(readonly api: PairingAPI, readonly code: string, readonly deviceName: string, readonly confirmation: string, private token: string, private identity: PairingIdentity, private tvKey: string, private secret: PairingSecret, readonly deadline: number) {}
  static async join(api: PairingAPI, enteredCode: string, expectedTVKey = ''): Promise<PhonePairing> {
    const code = normalizeCode(enteredCode)
    if (!CODE_PATTERN.test(code)) throw new PairingError('Enter the eight-character code shown on your TV.')
    const identity = await createIdentity()
    const started = Date.now(), session = await api.request(`/${code}/claim`, 'POST', { phoneKey: identity.publicKey })
    const tvKey = await validatePublicKey(session.tvKey)
    if (expectedTVKey && tvKey !== expectedTVKey) throw new PairingError('This connection does not match the TV’s QR code. Start a new session.')
    if (typeof session.phoneToken !== 'string' || !TOKEN_PATTERN.test(session.phoneToken) || typeof session.deviceName !== 'string' || session.deviceName.length > 60) throw new PairingError('Invalid pairing response.')
    const secret = await sharedSecret(identity, tvKey, code, tvKey, identity.publicKey)
    return new PhonePairing(api, code, session.deviceName, secret.confirmation, session.phoneToken, identity, tvKey, secret, deadline(session, started))
  }
  async send(account: PairingAccount): Promise<void> {
    if (!this.confirmed) throw new PairingError('Compare the codes and approve this phone on your TV first.')
    if (this.sent || this.sending) throw new PairingError('An account was already sent. Start a new session to send another.')
    if (Date.now() >= this.deadline) throw new PairingError('This code expired. Start a new session on your TV.', 410)
    this.sending = true
    try {
      const envelope = await encryptAccount(account, this.secret, this.code, this.tvKey, this.identity.publicKey)
      try { await this.api.request(`/${this.code}/offer`, 'POST', { envelope }, this.token) }
      catch (error) {
        // An interrupted reply must not encourage sending credentials again.
        const status = await this.status().catch(() => '')
        if (!['offered', 'accepted'].includes(status)) throw error
      }
      this.sent = true
    } finally { this.sending = false }
  }
  async confirmCodesMatch(): Promise<void> {
    if (await this.status() !== 'paired') throw new PairingError('Choose Approve phone on your TV first, then tap The codes match.')
    this.confirmed = true
  }
  async status(): Promise<string> { return (await this.api.request(`/${this.code}/phone`, 'GET', undefined, this.token)).status }
}
