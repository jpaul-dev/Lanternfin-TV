import { validateSource } from './catalog'
import { TVLibrary } from './library'
import { guideAddress, readProfiles, rememberProfile, sourceId, type SourceProfile } from './profiles'
import { normalizePreferences, readPreferences, savePreferences, type Preferences } from './preferences'
import { readSource, storeSource } from './storage'

type Snapshot = ReturnType<TVLibrary['snapshot']>
export type Backup = { format: 'lanternfin-tv'; version: 1; profiles: Array<SourceProfile & { library: Snapshot }>; preferences: Preferences }
export const BACKUP_BYTES = 8 * 1024 * 1024, BACKUP_TEXT = 12 * 1024 * 1024
const ITERATIONS = 600000, AAD = new TextEncoder().encode('Lanternfin TV encrypted backup v1')
const invalid = () => new Error('This is not a supported Lanternfin backup, or its data exceeds the TV’s limits.')
export class MemoryStore implements Storage {
  private data = new Map<string, string>()
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, String(value)) }
  removeItem(key: string) { this.data.delete(key) }
  key(index: number) { return [...this.data.keys()][index] ?? null }
}
function fromSnapshot(source: SourceProfile['source'], value: unknown): TVLibrary {
  if (!value || typeof value !== 'object') throw invalid()
  const data = { ...(value as Partial<Snapshot>), ...(!Object.prototype.hasOwnProperty.call(value, 'watchlist') ? { watchlist: [] } : {}) } as Snapshot
  for (const [field, max] of [['favorites', 2000], ['watchlist', 2000], ['recent', 100], ['references', 4100], ['seasons', 1000], ['watched', 10000]] as const) if (!Array.isArray(data[field]) || data[field].length > max) throw invalid()
  const raw = JSON.stringify(data); if (raw.length > 2 * 1024 * 1024) throw invalid()
  // Reuse the same bounded reader used for TV storage; no supplied storage key is trusted.
  const memory = new MemoryStore(); memory.getItem = () => raw
  const library = new TVLibrary(memory, source), clean = library.snapshot()
  for (const key of ['favorites', 'watchlist', 'recent', 'references', 'seasons'] as const) if (clean[key].length !== data[key].length) throw invalid()
  if (new Set(data.watched).size !== data.watched.length || data.watched.some(id => typeof id !== 'string' || !/^[a-f0-9]{16}$/.test(id))) throw invalid()
  library.setStorage(null); return library
}
export function validateBackup(value: unknown): Backup {
  if (!value || typeof value !== 'object') throw invalid()
  const input = value as Backup
  if (input.format !== 'lanternfin-tv' || input.version !== 1 || !Array.isArray(input.profiles) || input.profiles.length > 20) throw invalid()
  const ids = new Set<string>()
  const profiles = input.profiles.map(entry => {
    if (!entry || typeof entry.name !== 'string' || entry.name.length > 80) throw invalid()
    const source = validateSource(entry.source), id = sourceId(source)
    if (ids.has(id)) throw invalid(); ids.add(id)
    const guideUrl = guideAddress(entry.guideUrl), library = fromSnapshot(source, entry.library).snapshot()
    return { id, name: entry.name, source, library, ...(guideUrl ? { guideUrl } : {}), ...(source.kind === 'xtream' && entry.keepLibrary === true ? { keepLibrary: true } : {}) }
  })
  const result: Backup = { format: 'lanternfin-tv', version: 1, profiles, preferences: normalizePreferences(input.preferences) }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > BACKUP_BYTES) throw invalid()
  return result
}
export function createBackup(storage: Storage): Backup {
  return validateBackup({ format: 'lanternfin-tv', version: 1, profiles: readProfiles(storage).map(profile => ({ ...profile, library: new TVLibrary(storage, profile.source).snapshot() })), preferences: readPreferences(storage) })
}
function available(crypto: Crypto) { if (!crypto?.subtle || !crypto.getRandomValues) throw new Error('Encrypted backups need Web Crypto. Use a supported TV package or a secure browser context; no unencrypted backup will be created.') }
function password(value: string) { if (value.length < 12 || value.length > 256) throw new Error('Use a backup passphrase from 12 to 256 characters. Keep it somewhere safe; it cannot be recovered.') }
const base64 = (value: Uint8Array) => { let text = ''; for (let i = 0; i < value.length; i += 8192) text += String.fromCharCode(...value.subarray(i, i + 8192)); return btoa(text) }
const unbase64 = (value: unknown, max: number) => { if (typeof value !== 'string' || value.length > max || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw invalid(); try { return Uint8Array.from(atob(value), char => char.charCodeAt(0)) } catch { throw invalid() } }
async function key(passphrase: string, salt: Uint8Array<ArrayBuffer>, crypto: Crypto) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
export async function encryptBackup(backup: Backup, passphrase: string, crypto = globalThis.crypto): Promise<string> {
  available(crypto); password(passphrase)
  const bytes = new TextEncoder().encode(JSON.stringify(validateBackup(backup)))
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12))
  try {
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 }, await key(passphrase, salt, crypto), bytes)
    return JSON.stringify({ format: 'lanternfin-encrypted', version: 1, iterations: ITERATIONS, salt: base64(salt), iv: base64(iv), data: base64(new Uint8Array(encrypted)) })
  } finally { bytes.fill(0) }
}
export async function decryptBackup(text: string, passphrase: string, crypto = globalThis.crypto): Promise<Backup> {
  available(crypto); password(passphrase)
  if (text.length > BACKUP_TEXT) throw invalid()
  let envelope: { format: string; version: number; iterations: number; salt: string; iv: string; data: string }
  try { envelope = JSON.parse(text) } catch { throw invalid() }
  if (!envelope || envelope.format !== 'lanternfin-encrypted' || envelope.version !== 1 || envelope.iterations !== ITERATIONS) throw invalid()
  const salt = unbase64(envelope.salt, 24), iv = unbase64(envelope.iv, 16), data = unbase64(envelope.data, BACKUP_TEXT)
  if (salt.length !== 16 || iv.length !== 12 || data.length < 16 || data.length > BACKUP_BYTES + 16) throw invalid()
  let bytes: Uint8Array
  try { bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 }, await key(passphrase, salt, crypto), data)) }
  catch { throw new Error('The backup passphrase is incorrect, or the backup was damaged. Nothing was restored.') }
  try { let decoded: unknown; try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw invalid() }; return validateBackup(decoded) }
  finally { bytes.fill(0) }
}
export function restoreBackup(storage: Storage, input: Backup, options: { library: boolean; preferences: boolean }): number {
  const backup = validateBackup(input), draft = new MemoryStore(), existing = readProfiles(storage)
  if (new Set([...existing, ...backup.profiles].map(profile => profile.id)).size > 20) throw new Error('Restoring would exceed 20 saved sources. Remove an unused source first.')
  for (const profile of existing) rememberProfile(draft, profile.source, profile.name, undefined, profile)
  for (const profile of backup.profiles) {
    const current = existing.find(entry => entry.id === profile.id)
    if (current && JSON.stringify(current.source) !== JSON.stringify(profile.source)) throw invalid()
    if (!current) rememberProfile(draft, profile.source, profile.name, undefined, profile)
    if (options.library) {
      const library = new TVLibrary(storage, profile.source); library.setStorage(null)
      library.merge(fromSnapshot(profile.source, profile.library)); library.setStorage(draft)
    }
  }
  const active = readSource(storage); if (active) storeSource(draft, active)
  if (options.preferences) savePreferences(draft, backup.preferences)
  const changes = Array.from({ length: draft.length }, (_, index) => { const key = draft.key(index)!; return { key, before: storage.getItem(key), after: draft.getItem(key)! } })
  const applied: typeof changes = []
  try { for (const change of changes) { storage.setItem(change.key, change.after); applied.push(change) } }
  catch {
    let reverted = true
    for (const change of applied.reverse()) try { change.before === null ? storage.removeItem(change.key) : storage.setItem(change.key, change.before) } catch { reverted = false }
    throw new Error(reverted ? 'TV storage could not fit the backup. The previous saved data was restored.' : 'TV storage failed during restore and rollback. Reopen the app and inspect saved sources before retrying your backup.')
  }
  return backup.profiles.length
}
