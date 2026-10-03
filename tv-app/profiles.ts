import { httpUrl, validateSource, type Source } from './catalog'
import { libraryId } from './library'
import { readSource, storeSource } from './storage'

export type SourceProfile = { id: string; name: string; source: Source; keepLibrary?: boolean; guideUrl?: string }
export function guideAddress(value: unknown): string | undefined {
  if (value === undefined || value === '') return
  if (typeof value !== 'string' || value.length > 8192) throw new Error('Enter a guide address shorter than 8,192 characters.')
  return value.trim() ? httpUrl(value) : undefined
}
const KEY = 'lanternfin.tv.profiles.v1'
const MAX = 20
export const sourceId = (source: Source) => libraryId(JSON.stringify(validateSource(source)))
const label = (name: unknown, source: Source) => typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : source.kind === 'xtream' ? 'Xtream account' : source.kind === 'playlist' ? 'M3U playlist' : 'Direct stream'

/** Saved accounts are deliberately opt-in, bounded and unencrypted, like source.v1. */
export function readProfiles(storage: Storage): SourceProfile[] {
  const profiles: SourceProfile[] = []
  try {
    const raw = storage.getItem(KEY)
    if (raw && raw.length <= 512 * 1024) {
      const entries = JSON.parse(raw)
      if (Array.isArray(entries)) for (const entry of entries.slice(0, MAX)) {
        try { const source = validateSource(entry.source), id = sourceId(source); let guideUrl: string | undefined; try { guideUrl = guideAddress(entry.guideUrl) } catch { /* A damaged guide URL must not hide a valid source. */ }; if (!profiles.some(profile => profile.id === id)) profiles.push({ id, source, name: label(entry.name, source), ...(entry.keepLibrary === true ? { keepLibrary: true } : {}), ...(guideUrl ? { guideUrl } : {}) }) } catch { /* A damaged entry does not hide other profiles. */ }
      }
    }
  } catch { /* Restore the legacy source if it is still readable. */ }
  const legacy = readSource(storage)
  if (legacy && profiles.length < MAX && !profiles.some(profile => profile.id === sourceId(legacy))) profiles.push({ id: sourceId(legacy), source: legacy, name: label('', legacy) })
  return profiles
}
export function rememberProfile(storage: Storage, input: Source, name: string, replaces?: Source, options: { guideUrl?: string; keepLibrary?: boolean } = {}) {
  const source = validateSource(input), id = sourceId(source)
  const profiles = readProfiles(storage).filter(profile => !replaces || sourceId(replaces) === id || profile.id !== sourceId(replaces))
  const guideUrl = guideAddress(options.guideUrl)
  const index = profiles.findIndex(profile => profile.id === id), profile = { id, source, name: label(name, source), ...(options.keepLibrary === true && source.kind === 'xtream' ? { keepLibrary: true } : {}), ...(guideUrl ? { guideUrl } : {}) }
  if (index >= 0) profiles[index] = profile
  else { if (profiles.length >= MAX) throw new Error('You can save up to 20 sources. Remove one before saving another.'); profiles.push(profile) }
  storage.setItem(KEY, JSON.stringify(profiles)); storeSource(storage, source)
}
export function removeProfile(storage: Storage, source: Source) {
  const id = sourceId(source), remaining = readProfiles(storage).filter(profile => profile.id !== id)
  const current = readSource(storage)
  // Remove legacy credentials first; a later quota/write failure must not resurrect them.
  if (current && sourceId(current) === id) storeSource(storage, null)
  if (remaining.length) storage.setItem(KEY, JSON.stringify(remaining)); else storage.removeItem(KEY)
}
export function forgetProfiles(storage: Storage) { storeSource(storage, null); storage.removeItem(KEY) }
