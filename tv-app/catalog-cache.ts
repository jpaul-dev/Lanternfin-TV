import { httpUrl, type Catalog, type Channel, type Source } from './catalog'
import { playlistChannel, playlistGuide } from './playlist-cache-record'
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
const validGeneration = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
function checkedCategories(value: any): Record<MediaKind, Category[]> {
  const categories = {} as Record<MediaKind, Category[]>
  for (const kind of KINDS) {
    const list = value?.[kind]
    if (!Array.isArray(list) || list.length > 10000 || !list.every(validCategory) || new Set(list.map(category => category.id)).size !== list.length) throw fail()
    categories[kind] = list.map(({ id, name }) => ({ id, name }))
  }
  return categories
}

/** Bounded plain IndexedDB snapshots. Xtream uses credential-free references;
 * opted-in M3U snapshots retain complete playback requirements (see setup copy).
 */
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
  private transaction<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction, set: (value: T) => void) => void, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      checkSignal(signal)
      const tx = db.transaction(stores, mode); let result: T
      const abort = () => { try { tx.abort() } catch { /* Already settled. */ } }
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
      const timer = setTimeout(() => { abort(); cleanup(); reject(fail()) }, 5000)
      signal?.addEventListener('abort', abort, { once: true })
      tx.oncomplete = () => { cleanup(); resolve(result) }; tx.onerror = tx.onabort = () => { cleanup(); reject(fail()) }
      try { action(tx, value => { result = value }) } catch { cleanup(); abort(); reject(fail()) }
    })
  }
  private sweep(tx: IDBTransaction, id: string, keep: (key: IDBValidKey[]) => boolean = () => false) {
    const cursor = tx.objectStore('chunks').openCursor(IDBKeyRange.bound([id], [id, []]))
    cursor.onsuccess = () => { const item = cursor.result; if (item) { if (!keep(item.key as IDBValidKey[])) item.delete(); item.continue() } }
  }
  private async remove(db: IDBDatabase, id?: string) {
    await this.transaction<void>(db, ['meta', 'chunks'], 'readwrite', tx => {
      if (!id) { tx.objectStore('meta').clear(); tx.objectStore('chunks').clear(); return }
      tx.objectStore('meta').delete(id)
      this.sweep(tx, id)
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
    const categories = checkedCategories(snapshot.categories), seen = new Set<string>()
    if (!Number.isFinite(snapshot.at) || snapshot.at > Date.now() + 60000 || !Array.isArray(snapshot.entries)) throw fail()
    await this.publish(source, signal, async (write, check) => {
      let count = 0
      for (const entry of snapshot.entries) {
        if (!KINDS.includes(entry.kind) || !validCategory(entry.category) || !categories[entry.kind].some(category => category.id === entry.category.id) || !Array.isArray(entry.channels)) throw fail()
        const categoryKey = `${entry.kind}:${entry.category.id}`
        if (seen.has(categoryKey)) throw fail(); seen.add(categoryKey)
        for (let start = 0; start < Math.max(1, entry.channels.length); start += 500) {
          check()
          const rows = entry.channels.slice(start, start + 500).map(channel => {
            const reference = channelReference(source, channel)
            if (!reference || reference.mediaKind !== entry.kind) throw fail()
            return { reference, ...(channel.logo ? { logo: channel.logo } : {}), ...(channel.description ? { description: channel.description } : {}), ...(channel.tvArchive ? { tvArchive: channel.tvArchive, tvArchiveDuration: channel.tvArchiveDuration } : {}) }
          })
          count += rows.length; if (count > MAX_RECORDS) throw fail()
          await write(JSON.stringify({ kind: entry.kind, category: entry.category, rows, skipped: start === 0 ? entry.skipped : 0 }))
        }
      }
      if (seen.size !== KINDS.reduce((sum, kind) => sum + categories[kind].length, 0)) throw fail()
      return { at: snapshot.at, categories, count }
    })
  }
  /** Stage either catalog format, then publish and remove old chunks atomically. */
  private async publish(source: Source, signal: AbortSignal | undefined, stage: (write: (json: string) => Promise<void>, check: () => void) => Promise<Record<string, unknown>>) {
    const id = sourceId(source), epoch = (epochs.get(id) || 0) + 1, global = globalEpoch; epochs.set(id, epoch)
    const check = () => { checkSignal(signal); if (epoch !== epochs.get(id) || global !== globalEpoch) throw fail() }
    check()
    const generation = [...crypto.getRandomValues(new Uint32Array(4))].map(value => value.toString(16).padStart(8, '0')).join('')
    const db = await this.open(); let published = false
    try {
      check()
      // Reclaim abandoned staging from a previous interrupted app session, while
      // preserving the currently published generation (including legacy keys).
      await this.transaction(db, ['meta', 'chunks'], 'readwrite', tx => {
        const request = tx.objectStore('meta').get(id)
        request.onsuccess = () => {
          try {
            check(); let previous: any
            try { if (typeof request.result === 'string' && request.result.length <= 2 * 1024 * 1024) previous = JSON.parse(request.result) } catch {}
            this.sweep(tx, id, key => !!previous && (previous.generation === undefined ? key.length === 2 && typeof key[1] === 'number' : validGeneration(previous.generation) && key.length === 3 && key[1] === previous.generation))
          } catch { tx.abort() }
        }
      }, signal)
      let characters = 0, chunks = 0
      const metadata = await stage(async json => {
        check(); characters += json.length
        if (characters > MAX_CHARACTERS || json.length > 2 * 1024 * 1024 || chunks >= 4000) throw fail()
        await this.transaction(db, ['chunks'], 'readwrite', tx => { check(); tx.objectStore('chunks').put(json, [id, generation, chunks]) }, signal); chunks++
      }, check)
      check()
      const meta = JSON.stringify({ ...metadata, chunks, generation })
      if (meta.length > 2 * 1024 * 1024) throw fail()
      // Publish the complete snapshot and remove the old one in one transaction.
      // Quota errors or aborts roll back both, leaving the old snapshot readable.
      await this.transaction(db, ['meta', 'chunks'], 'readwrite', tx => {
        check()
        const request = tx.objectStore('chunks').count(IDBKeyRange.bound([id, generation, 0], [id, generation, Math.max(0, chunks - 1)]))
        request.onsuccess = () => {
          try {
            check(); if (request.result !== chunks) throw fail()
            tx.objectStore('meta').put(meta, id); this.sweep(tx, id, key => key.length === 3 && key[1] === generation)
          } catch { tx.abort() }
        }
      }, signal)
      published = true
    } finally {
      if (!published) try { await this.transaction(db, ['chunks'], 'readwrite', tx => this.sweep(tx, id, key => key.length !== 3 || key[1] !== generation)) } catch { /* A later save reclaims interrupted staging. */ }
      db.close()
    }
  }
  async savePlaylist(source: Source, catalog: Catalog, signal?: AbortSignal) {
    if (source.kind !== 'playlist') return
    if (!Array.isArray(catalog.channels) || !catalog.channels.length || catalog.channels.length > MAX_RECORDS || !Number.isInteger(catalog.skipped) || catalog.skipped < 0 || catalog.skipped > MAX_RECORDS) throw fail()
    const epgUrl = playlistGuide(catalog.epgUrl), at = Date.now()
    await this.publish(source, signal, async (write, check) => {
      let rows: string[] = [], size = 2, started = performance.now(), count = 0
      const flush = async () => { await write(`[${rows.join(',')}]`); rows = []; size = 2 }
      for (const channel of catalog.channels) {
        check()
        const json = JSON.stringify(playlistChannel(channel))
        if (json.length > 256 * 1024) throw fail()
        if (rows.length && (rows.length === 500 || size + json.length + 1 > 512 * 1024)) await flush()
        rows.push(json); size += json.length + 1; count++
        if (count % 64 === 0 && performance.now() - started >= 10) { await new Promise<void>(resolve => setTimeout(resolve, 0)); check(); started = performance.now() }
      }
      if (rows.length) await flush()
      return { format: 'playlist-v1', at, count, skipped: catalog.skipped, ...(epgUrl ? { epgUrl } : {}) }
    })
  }
  async loadPlaylist(source: Source, signal?: AbortSignal): Promise<(Catalog & { at: number }) | undefined> {
    if (source.kind !== 'playlist') return
    const id = sourceId(source), global = globalEpoch, epoch = epochs.get(id)
    const check = () => { checkSignal(signal); if (global !== globalEpoch || epoch !== epochs.get(id)) throw fail() }
    check(); const db = await this.open()
    try {
      check()
      const raw = await this.transaction<unknown>(db, ['meta'], 'readonly', (tx, set) => { const request = tx.objectStore('meta').get(id); request.onsuccess = () => set(request.result) }, signal)
      check(); if (raw === undefined) return
      if (typeof raw !== 'string' || raw.length > 65536) throw fail()
      const meta = JSON.parse(raw)
      if (!Number.isFinite(meta.at) || meta.at > Date.now() + 60000 || meta.at < Date.now() - TTL) { check(); await this.remove(db, id); return }
      if (meta.format !== 'playlist-v1' || !validGeneration(meta.generation) || !Number.isInteger(meta.chunks) || meta.chunks < 1 || meta.chunks > 4000 || !Number.isInteger(meta.count) || meta.count < 1 || meta.count > MAX_RECORDS || !Number.isInteger(meta.skipped) || meta.skipped < 0 || meta.skipped > MAX_RECORDS) throw fail()
      const channels: Channel[] = [], epgUrl = playlistGuide(meta.epgUrl), groups = new Map<string, string>()
      let characters = 0, started = performance.now()
      for (let chunk = 0; chunk < meta.chunks; chunk++) {
        check()
        const json = await this.transaction<unknown>(db, ['chunks'], 'readonly', (tx, set) => { const request = tx.objectStore('chunks').get([id, meta.generation, chunk]); request.onsuccess = () => set(request.result) }, signal)
        check()
        if (typeof json !== 'string' || json.length > 512 * 1024 || (characters += json.length) > MAX_CHARACTERS) throw fail()
        const rows = JSON.parse(json)
        if (!Array.isArray(rows) || !rows.length || rows.length > 500 || channels.length + rows.length > meta.count) throw fail()
        for (const row of rows) {
          const channel = playlistChannel(row)
          if (!groups.has(channel.group)) groups.set(channel.group, channel.group)
          channel.group = groups.get(channel.group)!; channels.push(channel)
          if (channels.length % 64 === 0 && performance.now() - started >= 10) { await new Promise<void>(resolve => setTimeout(resolve, 0)); check(); started = performance.now() }
        }
      }
      check(); if (channels.length !== meta.count) throw fail()
      return { channels, skipped: meta.skipped, at: meta.at, ...(epgUrl ? { epgUrl } : {}) }
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
      if (!Number.isInteger(meta.chunks) || meta.chunks < 0 || meta.chunks > 4000 || !meta.categories || meta.generation !== undefined && !validGeneration(meta.generation)) throw fail()
      const categories = checkedCategories(meta.categories)
      const entries = new Map<string, CachedCategory>(); let characters = 0, count = 0
      for (let chunk = 0; chunk < meta.chunks; chunk++) {
        check()
        const json = await this.transaction<unknown>(db, ['chunks'], 'readonly', (tx, set) => { const request = tx.objectStore('chunks').get(meta.generation === undefined ? [id, chunk] : [id, meta.generation, chunk]); request.onsuccess = () => set(request.result) })
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
          channel.categoryId = data.category.id // Also upgrades older cached catalogs, including live channels.
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
