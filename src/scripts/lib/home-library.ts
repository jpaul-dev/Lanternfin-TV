import { sourceKey, validateHomeRow } from '../../../shared/home-protocol.mjs'
import { homeEnabled, homeHasRow, homePublish, homeRow, homeRows } from './home-client'

type Sources = { entries: any[]; selectedId: string }
export function sharedSource(entry: any): any | undefined {
  if (!entry || !['xtream', 'm3u'].includes(entry.type)) return
  try { return validateHomeRow(`source/${sourceKey(entry)}`, entry) } catch { return }
}
export function mergeHomeSources(local: Sources | null): Sources {
  const state: Sources = { entries: (local?.entries || []).map(e => ({ ...e })), selectedId: local?.selectedId || '' }
  if (!homeEnabled()) return state
  for (const entry of state.entries) {
    const source = sharedSource(entry)
    if (source && !homeHasRow(`source/${sourceKey(source)}`)) homePublish(`source/${sourceKey(source)}`, source)
  }
  for (const remote of homeRows().filter(r => r.key.startsWith('source/'))) {
    const row = homeRow(remote.key)!, key = remote.key.slice(7)
    const existing = state.entries.find(e => { try { return sharedSource(e) && sourceKey(e) === key } catch { return false } })
    if (row.value === null) { if (existing) state.entries = state.entries.filter(e => e !== existing); continue }
    if (existing) Object.assign(existing, row.value)
    else state.entries.push({ ...row.value, _id: `home-${key}`, addedAt: row.changed })
  }
  if (!state.entries.some(e => e._id === state.selectedId)) state.selectedId = state.entries[0]?._id || ''
  return state
}
export function publishHomeSources(previous: Sources | null, next: Sources): void {
  if (!homeEnabled()) return
  const current = new Map<string, any>()
  for (const entry of next.entries) { const source = sharedSource(entry); if (source) current.set(sourceKey(source), source) }
  const before = new Map<string, any>()
  for (const entry of previous?.entries || []) { const source = sharedSource(entry); if (source) before.set(sourceKey(source), source) }
  for (const [key, source] of current) if (JSON.stringify(source) !== JSON.stringify(before.get(key))) homePublish(`source/${key}`, source)
  for (const key of before.keys()) if (!current.has(key)) homePublish(`source/${key}`, null)
}
function storedSources(): Sources | null { try { return JSON.parse(localStorage.getItem('xt_playlists') || 'null') } catch { return null } }
export function shareProgress(playlistId: string, kind: string, id: string | number, value: unknown): void {
  if (!homeEnabled()) return
  const entry = storedSources()?.entries.find(e => e._id === playlistId), source = sharedSource(entry)
  if (!source || source.type !== 'xtream' || !['vod', 'episode'].includes(kind)) return
  const key = sourceKey(source)
  if (!homeHasRow(`source/${key}`)) homePublish(`source/${key}`, source)
  try { homePublish(`progress/${key}/${kind}/${id}`, value) } catch { /* Local-only IDs remain usable. */ }
}
export function mergeHomeProgress(local: any, sources = storedSources()): any {
  const result = JSON.parse(JSON.stringify(local || {}))
  if (!homeEnabled()) return result
  for (const entry of sources?.entries || []) {
    const source = sharedSource(entry)
    if (!source || source.type !== 'xtream') continue
    const key = sourceKey(source), prefs = result[entry._id] ||= {}
    for (const [kind, bucket] of [['vod', 'progVod'], ['episode', 'progEpisode']]) {
      prefs[bucket] ||= {}
      for (const [id, value] of Object.entries(prefs[bucket])) if (!homeHasRow(`progress/${key}/${kind}/${id}`)) shareProgress(entry._id, kind, id, value)
      for (const remote of homeRows()) {
        const prefix = `progress/${key}/${kind}/`
        if (!remote.key.startsWith(prefix)) continue
        const row = homeRow(remote.key)!, id = row.key.slice(prefix.length)
        if (row.value === null) delete prefs[bucket][id]
        else prefs[bucket][id] = { ...row.value, updatedAt: row.changed }
      }
    }
  }
  return result
}
