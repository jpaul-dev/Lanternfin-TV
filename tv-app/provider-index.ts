import { MAX_CHANNELS, type Catalog, type Channel, type Source } from './catalog'
import { loadCategories, loadCategory, type Category, type MediaKind } from './xtream'
import type { CatalogSnapshot } from './catalog-cache'

export type IndexProgress = { running: boolean; complete: boolean; loaded: number; total: number; titles: number; failed: number; message: string }
type Loader = { categories: typeof loadCategories; category: typeof loadCategory }
type IndexedTitle = { channel: Channel; index: number }
class IndexBudgetError extends Error {}
/** One category at a time keeps provider load and peak memory predictable. No credential-bearing cache is persisted. */
export class ProviderIndex {
  private indexedItems: Channel[] = []
  get items() { return this.indexedItems }
  readonly categories: Partial<Record<MediaKind, Category[]>> = {}
  progress: IndexProgress = { running: false, complete: false, loaded: 0, total: 0, titles: 0, failed: 0, message: '' }
  private controller?: AbortController
  private cache = new Map<string, Catalog>()
  private seen = new Map<string, IndexedTitle>()
  private retained = 0
  private records = 0
  cachedAt?: number
  constructor(private source: Source, live: Category[], private loaders: Loader = { categories: loadCategories, category: loadCategory }, private budget = { records: MAX_CHANNELS, characters: 64 * 1024 * 1024 }) { this.categories.live = live }
  cached(kind: MediaKind, category: Category) { return this.cache.get(`${kind}:${category.id}`) }
  private indexed(id: string) { const entry = this.seen.get(id); return entry && this.items[entry.index] === entry.channel ? entry.channel : undefined }
  has(channel: Channel) { const found = this.indexed(`${channel.mediaKind}:${channel.providerId}`); return !!found && (found === channel || found.url === channel.url) }
  async restore(snapshot: CatalogSnapshot, signal?: AbortSignal) {
    if (this.items.length || this.controller) throw new Error('A saved catalog can only initialize an empty index.')
    const controller = new AbortController(); this.controller = controller
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true })
    const check = () => { if (controller.signal.aborted || signal?.aborted) throw new Error('Saved library loading canceled.') }
    // Stage the complete snapshot off-screen. Cancellation or a budget failure
    // leaves the previous index untouched, including its original live categories.
    const cache = new Map<string, Catalog>(), seen = new Map<string, IndexedTitle>(), items: Channel[] = []
    let retained = 0, records = 0, started = performance.now()
    try {
      check()
      for (const entry of snapshot.entries) {
        for (const item of entry.channels) {
          check(); records++; retained += item.name.length + item.url.length + item.group.length + (item.logo?.length || 0) + (item.description?.length || 0)
          if (records > this.budget.records || retained > this.budget.characters) throw new IndexBudgetError('The saved library exceeds this TV’s memory budget.')
          const id = `${item.mediaKind}:${item.providerId}`
          if (!seen.has(id)) { seen.set(id, { channel: item, index: items.length }); items.push(item) }
          if (records % 512 === 0 && performance.now() - started >= 10) { await new Promise<void>(resolve => setTimeout(resolve, 0)); started = performance.now() }
        }
        cache.set(`${entry.kind}:${entry.category.id}`, { channels: entry.channels, skipped: entry.skipped })
      }
      check(); this.cache = cache; this.seen = seen; this.indexedItems = items; this.records = records; this.retained = retained
      Object.assign(this.categories, snapshot.categories); this.cachedAt = snapshot.at
      this.progress = { running: false, complete: true, loaded: cache.size, total: cache.size, titles: items.length, failed: 0, message: '' }
    } finally { signal?.removeEventListener('abort', abort); if (this.controller === controller) this.controller = undefined }
  }
  snapshot(): CatalogSnapshot | undefined {
    if (!this.progress.complete) return
    const categories = this.categories as Record<MediaKind, Category[]>
    return { at: Date.now(), categories, entries: (['live', 'movie', 'series'] as const).flatMap(kind => categories[kind].map(category => ({ kind, category, ...this.cache.get(`${kind}:${category.id}`)! }))) }
  }
  private async store(kind: MediaKind, category: Category, result: Catalog, signal: AbortSignal) {
    const check = () => { if (signal.aborted) throw new Error('Library loading paused.') }
    const budgetError = () => new IndexBudgetError('The library reached this TV’s memory budget. Loaded titles remain searchable; other categories can still be opened individually.')
    check(); if (this.records + result.channels.length > this.budget.records) throw budgetError()
    const base = this.items, seen = this.seen, pending = new Map<string, IndexedTitle>(), additions: Channel[] = []
    let characters = 0, processed = 0, started = performance.now()
    const yieldIfNeeded = async () => {
      if (performance.now() - started >= 10) { await new Promise<void>(resolve => setTimeout(resolve, 0)); started = performance.now() }
    }
    try {
      for (const item of result.channels) {
        check(); characters += item.name.length + item.url.length + item.group.length + (item.logo?.length || 0) + (item.description?.length || 0)
        if (this.retained + characters > this.budget.characters) throw budgetError()
        const id = `${item.mediaKind}:${item.providerId}`
        if (!pending.has(id) && !this.indexed(id)) {
          const entry = { channel: item, index: base.length + additions.length }
          pending.set(id, entry); seen.set(id, entry); additions.push(item)
        }
        if (++processed % 512 === 0) { await yieldIfNeeded(); check() }
      }
      check()
      // Entries become visible to has() only after this single array publication.
      // Building the membership map above can yield without exposing partial rows.
      if (additions.length) this.indexedItems = base.concat(additions)
      this.records += result.channels.length; this.retained += characters; this.cache.set(`${kind}:${category.id}`, result)
      this.progress.loaded = this.cache.size; this.progress.titles = this.items.length
    } catch (error) {
      for (const [id, entry] of pending) {
        // A resumed run may already own the same ID; never delete its entry.
        if (seen.get(id) === entry) seen.delete(id)
        if (++processed % 512 === 0) await yieldIfNeeded()
      }
      throw error
    }
  }
  pause() { this.controller?.abort(); this.controller = undefined; this.progress.running = false }
  async start(changed: (progress: IndexProgress) => void) {
    if (this.controller || this.progress.complete) return
    const controller = new AbortController(); this.controller = controller
    this.progress = { ...this.progress, running: true, failed: 0, message: '' }; changed({ ...this.progress })
    const check = () => { if (controller.signal.aborted) throw new Error('Library loading paused.') }
    try {
      for (const kind of ['live', 'movie', 'series'] as const) {
        check()
        let categories = this.categories[kind]
        if (!categories) {
          try { categories = await this.loaders.categories(this.source, kind, controller.signal); check(); this.categories[kind] = categories }
          catch (error) { check(); this.progress.failed++; this.progress.message = (error as Error).message; continue }
        }
        this.progress.total = Object.values(this.categories).reduce((sum, list) => sum + list.length, 0)
        for (const category of categories) {
          check(); const key = `${kind}:${category.id}`
          if (this.cache.has(key)) continue
          try {
            const result = await this.loaders.category(this.source, kind, category, controller.signal); check()
            await this.store(kind, category, result, controller.signal); check()
          } catch (error) {
            check(); if (error instanceof IndexBudgetError) throw error
            this.progress.failed++; this.progress.message = (error as Error).message
          }
          changed({ ...this.progress })
          await new Promise<void>(resolve => setTimeout(resolve, 0)); check()
        }
      }
      this.progress.complete = this.progress.failed === 0
    } catch (error) { if (!controller.signal.aborted) this.progress.message = (error as Error).message }
    finally {
      if (this.controller === controller) {
        this.controller = undefined; this.progress.running = false; changed({ ...this.progress })
      }
    }
  }
}
