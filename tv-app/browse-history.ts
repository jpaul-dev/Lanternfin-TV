import type { Channel } from './catalog'
import { channelId } from './library'
import { BROWSE_VIEWS, type BrowseView } from './browse-options'
import type { Category } from './xtream'

export type BrowseSection = BrowseView | 'live'
export type BrowseFocus = { kind: 'title' | 'category' | 'control'; id: string }
export type BrowseVisit = { query: string; group: string; category?: Category; page: number; focus?: BrowseFocus; scroll: number; gridScroll: number; categoryScroll: number; signature: string }
const CONTROLS = ['search', 'group', 'media-filter', 'sort-order', 'watched-filter', 'language-filter', 'reset-filters', 'categories-back', 'previous', 'next', 'page-jump', 'page-go']
const copy = (visit: BrowseVisit): BrowseVisit => ({ ...visit, ...(visit.category ? { category: { ...visit.category } } : {}), ...(visit.focus ? { focus: { ...visit.focus } } : {}) })
export function browseFocus(element: HTMLElement): BrowseFocus | undefined {
  if (element.dataset.channel && /^[a-f0-9]{16}$/.test(element.dataset.channel)) return { kind: 'title', id: element.dataset.channel }
  if (element.dataset.category && element.dataset.category.length <= 200) return { kind: 'category', id: element.dataset.category }
  if (CONTROLS.includes(element.id)) return { kind: 'control', id: element.id }
}

/** Memory only: no queries, positions or category names go into storage/backups. */
export class BrowseHistory {
  private sources = new Map<string, Map<BrowseSection, BrowseVisit>>()
  remember(source: string, section: BrowseSection, visit: BrowseVisit) {
    if (!/^[a-f0-9]{16}$/.test(source) || ![...BROWSE_VIEWS, 'live'].includes(section)) return
    if (visit.query.length > 512 || visit.group.length > 200 || visit.signature.length > 256) return
    if (![visit.page, visit.scroll, visit.gridScroll, visit.categoryScroll].every(value => Number.isFinite(value) && value >= 0 && value <= 10000000) || !Number.isInteger(visit.page)) return
    if (visit.category && (!/^[A-Za-z0-9_-]{1,80}$/.test(visit.category.id) || visit.category.name.length > 200)) return
    if (visit.focus && (visit.focus.kind === 'title' ? !/^[a-f0-9]{16}$/.test(visit.focus.id) : visit.focus.kind === 'category' ? visit.focus.id.length > 200 : visit.focus.kind !== 'control' || !CONTROLS.includes(visit.focus.id))) return
    const views = this.sources.get(source) || new Map<BrowseSection, BrowseVisit>()
    views.set(section, copy(visit)); this.sources.delete(source); this.sources.set(source, views)
    while (this.sources.size > 20) this.sources.delete(this.sources.keys().next().value!)
  }
  recall(source: string, section: BrowseSection) {
    const views = this.sources.get(source), visit = views?.get(section)
    if (views) { this.sources.delete(source); this.sources.set(source, views) }
    return visit && copy(visit)
  }
  forget(source?: string) { if (source) this.sources.delete(source); else this.sources.clear() }
}

/** Find the same card after sorting/library changes, without blocking a large TV catalog. */
export async function resolveBrowseVisit(items: Channel[], visit: BrowseVisit, pageSize: number, complete: boolean, signal: AbortSignal) {
  const check = () => { if (signal.aborted) throw new Error('Navigation cancelled.') }
  check(); let page = visit.page, missing = false, moved = false
  if (visit.focus?.kind === 'title') {
    let index = -1, started = performance.now()
    for (let i = 0; i < items.length; i++) {
      if (channelId(items[i]) === visit.focus.id) { index = i; break }
      if (i % 512 === 0 && performance.now() - started >= 10) { await new Promise<void>(resolve => setTimeout(resolve, 0)); check(); started = performance.now() }
    }
    missing = index < 0
    if (!missing) { page = Math.floor(index / pageSize); moved = page !== visit.page }
  }
  check()
  const lastPage = Math.max(0, Math.ceil(items.length / pageSize) - 1), pending = !complete && (missing || page > lastPage)
  return { page: Math.min(page, lastPage), pending, missing, moved: moved || page > lastPage }
}
