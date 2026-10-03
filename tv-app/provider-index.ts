import { MAX_CHANNELS, type Catalog, type Channel, type Source } from './catalog'
import { loadCategories, loadCategory, type Category, type MediaKind } from './xtream'
import type { CatalogSnapshot } from './catalog-cache'

export type IndexProgress = { running: boolean; complete: boolean; loaded: number; total: number; titles: number; failed: number; message: string }
type Loader = { categories: typeof loadCategories; category: typeof loadCategory }
class IndexBudgetError extends Error {}
/** One category at a time keeps provider load and peak memory predictable. No credential-bearing cache is persisted. */
export class ProviderIndex {
  readonly items: Channel[] = []
  readonly categories: Partial<Record<MediaKind, Category[]>> = {}
  progress: IndexProgress = { running: false, complete: false, loaded: 0, total: 0, titles: 0, failed: 0, message: '' }
  private controller?: AbortController
  private cache = new Map<string, Catalog>()
  private seen = new Set<string>()
  private retained = 0
  private records = 0
  cachedAt?: number
  constructor(private source: Source, live: Category[], private loaders: Loader = { categories: loadCategories, category: loadCategory }, private budget = { records: MAX_CHANNELS, characters: 64 * 1024 * 1024 }) { this.categories.live = live }
  cached(kind: MediaKind, category: Category) { return this.cache.get(`${kind}:${category.id}`) }
  restore(snapshot: CatalogSnapshot) {
    if (this.items.length || this.controller) throw new Error('A saved catalog can only initialize an empty index.')
    Object.assign(this.categories, snapshot.categories)
    for (const entry of snapshot.entries) this.store(entry.kind, entry.category, { channels: entry.channels, skipped: entry.skipped })
    this.cachedAt = snapshot.at
    this.progress = { running: false, complete: true, loaded: this.cache.size, total: this.cache.size, titles: this.items.length, failed: 0, message: '' }
  }
  snapshot(): CatalogSnapshot | undefined {
    if (!this.progress.complete) return
    const categories = this.categories as Record<MediaKind, Category[]>
    return { at: Date.now(), categories, entries: (['live', 'movie', 'series'] as const).flatMap(kind => categories[kind].map(category => ({ kind, category, ...this.cache.get(`${kind}:${category.id}`)! }))) }
  }
  private store(kind: MediaKind, category: Category, result: Catalog) {
    let characters = 0
    for (const item of result.channels) characters += item.name.length + item.url.length + item.group.length + (item.logo?.length || 0) + (item.description?.length || 0)
    if (this.records + result.channels.length > this.budget.records || this.retained + characters > this.budget.characters) throw new IndexBudgetError('The library reached this TV’s memory budget. Loaded titles remain searchable; other categories can still be opened individually.')
    this.records += result.channels.length; this.retained += characters; this.cache.set(`${kind}:${category.id}`, result)
    for (const item of result.channels) {
      const id = `${item.mediaKind}:${item.providerId}`
      if (!this.seen.has(id)) { this.seen.add(id); this.items.push(item) }
    }
    this.progress.loaded = this.cache.size; this.progress.titles = this.items.length
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
            this.store(kind, category, result)
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
