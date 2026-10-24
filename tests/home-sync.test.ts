// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sourceKey } from '../shared/home-protocol.mjs'

const source = { type: 'xtream', title: 'Test account', serverUrl: 'https://provider.example', username: 'user', password: 'pass', liveContainer: 'm3u8' }
const key = sourceKey(source)
let records: Map<string, any>, revision: number, offline: boolean
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); localStorage.clear()
  ;(window as any).__LANTERNFIN_HOME__ = true
  records = new Map(); revision = 0; offline = false
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (offline) throw new Error('Offline')
    const body = init.body ? JSON.parse(init.body) : null
    const accepted: string[] = [], conflicts: string[] = []
    if (body?.changes) for (const change of body.changes) {
      const old = records.get(change.key)
      if ((old?.version || 0) !== change.base) { conflicts.push(change.op); continue }
      records.set(change.key, { key: change.key, value: change.value, version: ++revision, changed: Date.now() }); accepted.push(change.op)
    }
    const since = body?.since ?? Number(new URL(url).searchParams.get('since') || 0)
    return { ok: true, status: 200, json: async () => ({ homeId: 'test-home', version: revision, rows: [...records.values()].filter(r => r.version > since), accepted, conflicts }) }
  }))
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); delete (window as any).__LANTERNFIN_HOME__ })
const remote = (key: string, value: any) => records.set(key, { key, value, version: ++revision, changed: Date.now() })
describe('home sync adapters', () => {
  it('maps the same provider account to existing Android IDs and fresh browser IDs without changing the active source', async () => {
    remote(`source/${key}`, source)
    const client = await import('../src/scripts/lib/home-client')
    const library = await import('../src/scripts/lib/home-library')
    await client.homeReady()
    const existing = { entries: [{ ...source, _id: 'android-local-id', title: 'Old title' }], selectedId: 'android-local-id' }
    const merged = library.mergeHomeSources(existing)
    expect(merged.entries).toHaveLength(1)
    expect(merged.entries[0]._id).toBe('android-local-id')
    expect(existing.entries[0].title).toBe('Old title')
    expect(merged.selectedId).toBe('android-local-id')
    expect(library.mergeHomeSources(null).selectedId).toBe(`home-${key}`)
  })
  it('persists offline changes, applies completion and deletion, and rejects old offline writes after a newer device update', async () => {
    remote(`source/${key}`, source)
    const client = await import('../src/scripts/lib/home-client')
    const library = await import('../src/scripts/lib/home-library')
    const sources = { entries: [{ ...source, _id: 'phone-id' }], selectedId: 'phone-id' }
    localStorage.setItem('xt_playlists', JSON.stringify(sources))
    await client.homeReady()
    offline = true
    library.shareProgress('phone-id', 'vod', 42, { position: 60, duration: 1200, completed: false })
    await client.homeSync()
    expect(JSON.parse(localStorage.getItem('lf_home_cache_v1')!).pending).toHaveLength(1)
    remote(`progress/${key}/vod/42`, { position: 1200, duration: 1200, completed: true })
    offline = false; await client.homeSync()
    expect(client.homeStatus()).toContain('newer shared changes kept')
    expect(library.mergeHomeProgress({})['phone-id'].progVod['42'].completed).toBe(true)
    library.shareProgress('phone-id', 'vod', 42, null); await client.homeSync()
    expect(library.mergeHomeProgress({ 'phone-id': { progVod: { '42': { position: 50 } } } })['phone-id'].progVod['42']).toBeUndefined()
  })
  it('coalesces rapid playback samples without dropping the latest sample during an in-flight sync', async () => {
    remote(`source/${key}`, source)
    const client = await import('../src/scripts/lib/home-client')
    await client.homeReady()
    const row = `progress/${key}/vod/42`
    client.homePublish(row, { position: 10, duration: 100, completed: false })
    const pending = client.homeSync()
    client.homePublish(row, { position: 20, duration: 100, completed: false })
    await pending
    await client.homeSync()
    expect(records.get(row).value.position).toBe(20)
    expect(JSON.parse(localStorage.getItem('lf_home_cache_v1')!).pending).toHaveLength(0)
  })
  it('shares Xtream resume positions with the LG/Samsung library using provider IDs', async () => {
    remote(`source/${key}`, source)
    remote(`progress/${key}/episode/17`, { position: 135, duration: 1800, completed: false, seriesId: '4', seriesName: 'Test series', episodeTitle: 'Episode one', extension: 'mkv' })
    const client = await import('../src/scripts/lib/home-client')
    await client.homeReady()
    const { TVLibrary } = await import('../tv-app/library')
    const { referenceChannel } = await import('../tv-app/provider-reference')
    const tvSource = { kind: 'xtream' as const, url: source.serverUrl, username: source.username, password: source.password }
    const tv = new TVLibrary(localStorage, tvSource)
    const channel = referenceChannel(tvSource, { providerId: '17', mediaKind: 'episode', extension: 'mkv', name: 'Episode one', group: '', seriesId: '4' })
    expect(tv.lastPlayed(channel)?.position).toBe(135)
    tv.record(channel, 250, 1800)
    await client.homeSync()
    expect(records.get(`progress/${key}/episode/17`).value.position).toBe(250)
    tv.removeRecent(channel); await client.homeSync()
    expect(records.get(`progress/${key}/episode/17`).value).toBeNull()
  })
})
