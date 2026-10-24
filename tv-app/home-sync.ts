import { homeReady, homeEnabled, homeRows, homeRow, homeHasRow, homePublish } from '../src/scripts/lib/home-client'
import { sourceKey } from '../shared/home-protocol.mjs'
import { homeSource } from './home-source'
import { readProfiles, rememberProfile, removeProfile } from './profiles'
import { readSource, storeSource } from './storage'
import type { Source } from './catalog'

let merging = false
export async function syncTVHomeSources(): Promise<void> {
  if (!homeEnabled() || merging) return
  merging = true
  try {
    await homeReady()
    const current = readSource(localStorage), profiles = readProfiles(localStorage)
    for (const profile of profiles) {
      const entry = homeSource(profile.source, profile.name)
      if (entry && !homeHasRow(`source/${sourceKey(entry)}`)) homePublish(`source/${sourceKey(entry)}`, entry)
    }
    for (const remote of homeRows().filter(row => row.key.startsWith('source/'))) {
      const row = homeRow(remote.key)!, existing = profiles.find(p => { const entry = homeSource(p.source); return entry && `source/${sourceKey(entry)}` === row.key })
      if (row.value === null) { if (existing) removeProfile(localStorage, existing.source, true); continue }
      const value = row.value
      const source: Source = { kind: value.type === 'xtream' ? 'xtream' : 'playlist', url: value.serverUrl || value.url, username: value.username || '', password: value.password || '' }
      rememberProfile(localStorage, source, value.title, existing?.source, { keepLibrary: true, guideUrl: value.epgUrl }, true)
    }
    const available = readProfiles(localStorage)
    if (current && available.some(p => JSON.stringify(p.source) === JSON.stringify(current))) storeSource(localStorage, current)
    else if (available.length) storeSource(localStorage, available[0].source)
  } finally { merging = false }
}
