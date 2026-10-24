import { validateHomeRow } from '../../../shared/home-protocol.mjs'

export type HomeRow = { key: string; value: any; version: number; changed: number }
type Change = { key: string; value: any; base: number; op: string }
type Connection = { url: string; token: string; homeId: string }
type Saved = { homeId: string; version: number; rows: HomeRow[]; pending: Change[] }
const CONFIG = 'lf_home_connection_v1', CACHE = 'lf_home_cache_v1'
let ready: Promise<void> | undefined, flight: Promise<void> | undefined, timer: ReturnType<typeof setInterval> | undefined
let version = 0, homeId = '', status = 'Not connected', conflicts = 0
const rows = new Map<string, HomeRow>(), pending = new Map<string, Change>()
let initialized = false
let generation = 0
function read<T>(key: string): T | null { try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null } }
export function homeHosted(): boolean { return typeof window !== 'undefined' && (window as any).__LANTERNFIN_HOME__ === true }
export function homeConnection(): Connection | null { return read<Connection>(CONFIG) }
export function homeEnabled(): boolean { return homeHosted() || !!homeConnection() }
export function homeStatus(): string { return status }
export function homeRows(): HomeRow[] { return [...rows.values()] }
export function homeRow(key: string): HomeRow | undefined { const change = pending.get(key); return change ? { key, value: change.value, version: change.base, changed: Date.now() } : rows.get(key) }
export function homeHasRow(key: string): boolean { return rows.has(key) || pending.has(key) }
const notify = () => { if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('lf:home-changed')) }
function persist() {
  try { localStorage.setItem(CACHE, JSON.stringify({ homeId, version, rows: [...rows.values()], pending: [...pending.values()] })) }
  catch { status = 'Device storage is full. Keep the app open until sync completes.' }
}
function initialize() {
  if (initialized || !homeEnabled()) return
  initialized = true
  const saved = read<Saved>(CACHE), connection = homeConnection()
  if (saved && (!connection || connection.homeId === saved.homeId)) {
    homeId = saved.homeId; version = saved.version || 0
    for (const row of saved.rows || []) rows.set(row.key, row)
    for (const change of saved.pending || []) pending.set(change.key, change)
  }
}
export function homeAddress(raw: string): string {
  const url = new URL(raw.includes('://') ? raw.trim() : `http://${raw.trim()}`)
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    !/^(localhost|[a-z0-9-]+\.local|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i.test(url.hostname)) throw new Error('Use lanternfin.local or the home computer’s local IP address, including its port if shown.')
  return url.origin
}
async function transport(url: string, init: RequestInit): Promise<Response> {
  if ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__) {
    const { fetch: nativeFetch } = await import('@tauri-apps/plugin-http')
    return nativeFetch(url, init)
  }
  return fetch(url, init)
}
export async function homeRequest(path: string, data?: unknown, connection = homeConnection()): Promise<any> {
  const base = homeHosted() ? location.origin : connection?.url
  if (!base) throw new Error('Connect to Lanternfin Home first.')
  const headers: Record<string, string> = { 'X-Lanternfin-Home': '1' }
  if (!homeHosted() && connection?.token) headers.Authorization = `Bearer ${connection.token}`
  if (data !== undefined) headers['Content-Type'] = 'application/json'
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await transport(base + '/_home/' + path, { method: data === undefined ? 'GET' : 'POST', headers, body: data === undefined ? undefined : JSON.stringify(data), signal: controller.signal })
    const result = await response.json()
    if (!response.ok) throw new Error(response.status === 401 ? 'Pair this device again to reconnect.' : result.error || 'Home sync is unavailable.')
    return result
  } finally { clearTimeout(timeout) }
}
export async function connectHome(address: string, code: string): Promise<void> {
  const connection = { url: homeAddress(address), token: '', homeId: '' }
  const result = await homeRequest('pair', { code, name: /Android/i.test(navigator.userAgent) ? 'Android app' : 'TV app', native: true }, connection)
  if (typeof result.token !== 'string' || typeof result.homeId !== 'string') throw new Error('This address is not a Lanternfin Home server.')
  localStorage.setItem(CONFIG, JSON.stringify({ ...connection, token: result.token, homeId: result.homeId }))
  generation++; flight = undefined
  if (homeId !== result.homeId) { rows.clear(); pending.clear(); version = 0; homeId = result.homeId; persist() }
  ready = undefined; initialized = true
  await homeReady()
}
export async function disconnectHome(): Promise<void> {
  // Disconnect remains possible when the host is off. Its paired-device list can revoke the old key later.
  const logout = homeRequest('logout', {}).catch(() => {})
  generation++; flight = undefined
  localStorage.removeItem(CONFIG); localStorage.removeItem(CACHE)
  if (timer) clearInterval(timer)
  timer = undefined; rows.clear(); pending.clear(); version = 0; ready = undefined; initialized = false; homeId = ''; status = 'Not connected'
  notify()
  await logout
}
export function homePublish(key: string, value: unknown): void {
  if (!homeEnabled()) return
  initialize()
  const safe = validateHomeRow(key, value)
  if (JSON.stringify(homeRow(key)?.value) === JSON.stringify(safe)) return
  const bytes = new Uint8Array(16); crypto.getRandomValues(bytes)
  const op = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  pending.set(key, { key, value: safe, base: pending.get(key)?.base ?? rows.get(key)?.version ?? 0, op })
  persist()
  // Coalesce playback ticks and source changes; persist first so navigation cannot lose them.
  setTimeout(() => void homeSync(), 250)
}
export function homeSync(): Promise<void> {
  if (flight) return flight
  if (!homeEnabled()) return Promise.resolve()
  initialize()
  const epoch = generation
  flight = (async () => {
    const batch = [...pending.values()].sort((a, b) => Number(b.key.startsWith('source/')) - Number(a.key.startsWith('source/'))).slice(0, 250)
    try {
      const result = batch.length ? await homeRequest('sync', { changes: batch, since: version }) : await homeRequest(`state?since=${version}`)
      if (epoch !== generation) return
      if (!Array.isArray(result.rows) || typeof result.homeId !== 'string' || !Number.isSafeInteger(result.version)) throw new Error('Invalid home response.')
      if (homeId && homeId !== result.homeId) throw new Error('The home library was replaced. Disconnect and pair again.')
      homeId = result.homeId
      for (const row of result.rows) { validateHomeRow(row.key, row.value); rows.set(row.key, row) }
      for (const sent of batch) {
        const waiting = pending.get(sent.key)
        if (result.conflicts?.includes(sent.op)) { pending.delete(sent.key); conflicts++ }
        else if (result.accepted?.includes(sent.op)) {
          if (waiting?.op === sent.op) pending.delete(sent.key)
          else if (waiting) waiting.base = rows.get(sent.key)?.version || waiting.base
        }
      }
      version = result.version
      status = pending.size ? `Syncing ${pending.size} changes…` : conflicts ? `Synced · ${conflicts} newer shared changes kept` : 'Connected · progress synced'
      persist(); notify()
    } catch (error) { if (epoch === generation) { status = `${error instanceof Error && /Pair |replaced/.test(error.message) ? error.message : 'Home is offline'} · changes kept on this device`; notify() } }
    finally { if (epoch === generation) flight = undefined }
  })()
  return flight
}
export function homeReady(): Promise<void> {
  if (!homeEnabled()) return Promise.resolve()
  if (!ready) {
    initialize()
    ready = homeSync()
    if (!timer) { timer = setInterval(() => void homeSync(), 5000); window.addEventListener('online', () => void homeSync()); document.addEventListener('visibilitychange', () => { if (!document.hidden) void homeSync() }) }
  }
  return ready
}
export function homeMediaUrl(raw: string, headers: Record<string, string> = {}): string {
  if (!homeHosted() || !/^https?:\/\//i.test(raw)) return raw
  const url = new URL(raw)
  if (url.origin === location.origin) return raw
  if (url.username || url.password) headers = { ...headers, authorization: `Basic ${btoa(decodeURIComponent(url.username) + ':' + decodeURIComponent(url.password))}` }
  const context = JSON.stringify({ origin: url.origin, headers })
  const encoded = btoa(Array.from(new TextEncoder().encode(context), b => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${location.origin}/_home/media/~${encoded}/${url.protocol.slice(0, -1)}/${url.host}${url.pathname}${url.search}`
}
export async function homeProviderFetch(url: string, init: RequestInit): Promise<Response> {
  const headers = Object.fromEntries(new Headers(init.headers).entries())
  return fetch('/_home/fetch', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lanternfin-Home': '1' }, signal: init.signal, body: JSON.stringify({ url, method: init.method || 'GET', headers, body: typeof init.body === 'string' ? init.body : undefined }) })
}
