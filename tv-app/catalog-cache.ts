import { httpUrl, type Channel, type Source } from './catalog'
import { sourceId } from './profiles'
import { channelReference, readProviderReference, referenceChannel } from './provider-reference'
import type { Category, MediaKind } from './xtream'

export type CachedCategory = { kind: MediaKind; category: Category; channels: Channel[]; skipped: number }
export type CatalogSnapshot = { at: number; categories: Record<MediaKind, Category[]>; entries: CachedCategory[] }
const KINDS: MediaKind[] = ['live', 'movie', 'series'], TTL = 6 * 3600000, MAX_CHARACTERS = 64 * 1024 * 1024, MAX_RECORDS = 500000
const epochs = new Map<string, number>(); let globalEpoch = 0
const fail = () => new Error('The saved library is unavailable. Live loading still works.')
const checkSignal = (signal?: AbortSignal) => { if (signal?.aborted) throw new Error('Library loading cancelled.') }
const validCategory = (value: any): value is Category => value && typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value.id) && typeof value.name === 'string' && value.name.length <= 200

/** A small plain IndexedDB store; no executable data and no copied media/account credentials. */
export class CatalogCache {
  constructor(private factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB) {}
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (!this.factory) { reject(fail()); return }
      let done = false
      const timer = setTimeout(() => { done = true; reject(fail()) }, 5000)
      let request: IDBOpenDBRequest
      try { request = this.factory.open('lanternfin.tv.catalog.v1', 1) } catch { clearTimeout(timer); reject(fail()); return }
      const failed = () => { done = true; clearTimeout(timer); reject(fail()) }
      request.onerror = request.onblocked = failed
      request.onupgradeneeded = () => { const db = request.result; db.createObjectStore('meta'); db.createObjectStore('chunks') }
      request.onsuccess = () => { clearTimeout(timer); if (done) request.result.close(); else { done = true; request.result.onversionchange = () => request.result.close(); resolve(request.result) } }
    })
  }
  private transaction<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction, set: (value: T) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode); let result: T
      const timer = setTimeout(() => { try { tx.abort() } catch { /* Already settled. */ }; reject(fail()) }, 5000)
      tx.oncomplete = () => { clearTimeout(timer); resolve(result) }; tx.onerror = tx.onabort = () => { clearTimeout(timer); reject(fail()) }
      try { action(tx, value => { result = value }) } catch { clearTimeout(timer); tx.abort(); reject(fail()) }
    })
  }
  private async remove(db: IDBDatabase, id?: string) {
    await this.transaction<void>(db, ['meta', 'chunks'], 'readwrite', tx => {
      if (!id) { tx.objectStore('meta').clear(); tx.objectStore('chunks').clear(); return }
      tx.objectStore('meta').delete(id)
      const cursor = tx.objectStore('chunks').openCursor(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]))
      cursor.onsuccess = () => { const item = cursor.result; if (item) { item.delete(); item.continue() } }
    })
  }
  async forget(source?: Source) {
    const id = source && sourceId(source)
    if (id) epochs.set(id, (epochs.get(id) || 0) + 1); else globalEpoch++
    if (!this.factory) return
    const db = await this.open(); try { await this.remove(db, id) } finally { db.close() }
  }
  async save(source: Source, snapshot: CatalogSnapshot, signal?: AbortSignal) {
    if (source.kind !== 'xtream') return
    const id = sourceId(source), epoch = (epochs.get(id) || 0) + 1, global = globalEpoch; epochs.set(id, epoch)
    const check = () => { checkSignal(signal); if (epoch !== epochs.get(id) || global !== globalEpoch) throw fail() }
    check(); const db = await this.open()
    try {
      check(); await this.remove(db, id)
      let count = 0, characters = 0, chunks = 0
      for (const entry of snapshot.entries) {
        for (let start = 0; start < Math.max(1, entry.channels.length); start += 500) {
          check()
          const rows = entry.channels.slice(start, start + 500).map(channel => {
            const reference = channelReference(source, channel)
            if (!reference) throw fail()
            return { reference, ...(channel.logo ? { logo: channel.logo } : {}), ...(channel.description ? { description: channel.description } : {}), ...(channel.tvArchive ? { tvArchive: channel.tvArchive, tvArchiveDuration: channel.tvArchiveDuration } : {}) }
          })
          const json = JSON.stringify({ kind: entry.kind, category: entry.category, rows, skipped: start === 0 ? entry.skipped : 0 })
          characters += json.length; count += rows.length
          if (characters > MAX_CHARACTERS || json.length > 2 * 1024 * 1024 || count > MAX_RECORDS || chunks >= 4000) throw fail()
          await this.transaction(db, ['chunks'], 'readwrite', tx => { tx.objectStore('chunks').put(json, [id, chunks]) }); chunks++
        }
      }
      check(); const meta = JSON.stringify({ at: snapshot.at, categories: snapshot.categories, chunks, count })
      if (meta.length > 2 * 1024 * 1024) throw fail()
      await this.transaction(db, ['meta'], 'readwrite', tx => { tx.objectStore('meta').put(meta, id) })
    } finally { db.close() }
  }
  async load(source: Source, signal?: AbortSignal): Promise<CatalogSnapshot | undefined> {
    if (source.kind !== 'xtream') return
    const id = sourceId(source), global = globalEpoch, epoch = epochs.get(id)
    const check = () => { checkSignal(signal); if (global !== globalEpoch || epoch !== epochs.get(id)) throw fail() }
    const db = await this.open()
    try {
      check()
      const raw = await this.transaction<unknown>(db, ['meta'], 'readonly', (tx, set) => { const request = tx.objectStore('meta').get(id); request.onsuccess = () => set(request.result) })
      if (raw === undefined) return
      if (typeof raw !== 'string' || raw.length > 2 * 1024 * 1024) throw fail()
      const meta = JSON.parse(raw)
      if (!Number.isFinite(meta.at) || meta.at > Date.now() + 60000 || meta.at < Date.now() - TTL) { check(); await this.remove(db, id); return }
      if (!Number.isInteger(meta.chunks) || meta.chunks < 0 || meta.chunks > 4000 || !meta.categories) throw fail()
      const categories = {} as Record<MediaKind, Category[]>
      for (const kind of KINDS) {
        const list = meta.categories[kind]
        if (!Array.isArray(list) || list.length > 10000 || !list.every(validCategory)) throw fail()
        categories[kind] = list.map(({ id, name }) => ({ id, name }))
      }
      const entries = new Map<string, CachedCategory>(); let characters = 0, count = 0
      for (let chunk = 0; chunk < meta.chunks; chunk++) {
        check()
        const json = await this.transaction<unknown>(db, ['chunks'], 'readonly', (tx, set) => { const request = tx.objectStore('chunks').get([id, chunk]); request.onsuccess = () => set(request.result) })
        check()
        if (typeof json !== 'string' || json.length > 2 * 1024 * 1024 || (characters += json.length) > MAX_CHARACTERS) throw fail()
        const data = JSON.parse(json)
        if (!KINDS.includes(data.kind) || !validCategory(data.category) || !Array.isArray(data.rows) || data.rows.length > 500 || !categories[data.kind as MediaKind].some(category => category.id === data.category.id)) throw fail()
        const key = `${data.kind}:${data.category.id}`
        if (!entries.has(key)) entries.set(key, { kind: data.kind, category: data.category, channels: [], skipped: 0 })
        const entry = entries.get(key)!
        entry.skipped += Number.isInteger(data.skipped) && data.skipped > 0 && data.skipped <= MAX_RECORDS ? data.skipped : 0
        for (const value of data.rows) {
          if (++count > MAX_RECORDS) throw fail()
          const reference = readProviderReference(value?.reference)
          if (!reference || reference.mediaKind !== data.kind) throw fail()
          const channel = referenceChannel(source, reference)
          try { if (typeof value.logo === 'string' && value.logo.length <= 2048) channel.logo = httpUrl(value.logo) } catch { /* Ignore invalid artwork. */ }
          if (typeof value.description === 'string') channel.description = value.description.slice(0, 200)
          if (value.tvArchive === 1) { channel.tvArchive = 1; channel.tvArchiveDuration = Math.max(1, Math.min(30, Number(value.tvArchiveDuration) || 7)) }
          entry.channels.push(channel)
        }
      }
      if (count !== meta.count || entries.size !== KINDS.reduce((sum, kind) => sum + categories[kind].length, 0)) throw fail()
      check(); return { at: meta.at, categories, entries: [...entries.values()] }
    } finally { db.close() }
  }
}
