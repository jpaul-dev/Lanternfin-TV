import type { Channel, Source } from './catalog'
import { channelReference, readProviderReference, referenceChannel, type ProviderReference } from './provider-reference'
import { cloneSourceHome, readSourceHome, type SourceHome } from './source-home'
import { cloneBrowseOptions, DEFAULT_BROWSE_CHOICE, readBrowseOptions, type BrowseChoice, type BrowseOptions, type BrowseView } from './browse-options'
import { MAX_GUIDE_MATCHES, readGuideMatches, validGuideId } from './guide-matches'

export type Recent = { id: string; at: number; position: number; duration: number; completed?: boolean }
export type LibraryArea = 'favorites' | 'watchlist' | 'history' | 'watched' | 'seasons'
const PREFIX = 'lanternfin.tv.library.v1.'
const MAX_FAVORITES = 2000, MAX_WATCHLIST = 2000, MAX_RECENT = 100
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{16}$/.test(value)

// Stable lookup identifiers, not encryption. Provider bookmarks store bounded
// titles and IDs, but never URLs, account credentials, headers or license keys.
export function libraryId(value: string): string {
  let a = 2166136261, b = 5381
  for (let index = 0; index < value.length; index++) {
    const char = value.charCodeAt(index)
    a = Math.imul(a ^ char, 16777619); b = Math.imul(b, 33) ^ char
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}
const channelIds = new WeakMap<Channel, string>()
export const channelId = (channel: Channel) => {
  let id = channelIds.get(channel)
  if (!id) { id = libraryId(channel.url || `${channel.mediaKind}:${channel.providerId}`); channelIds.set(channel, id) }
  return id
}

export class TVLibrary {
  readonly favorites = new Set<string>()
  readonly watchlist = new Set<string>()
  readonly recent = new Map<string, Recent>()
  private readonly watched = new Set<string>()
  private readonly seasons = new Map<string, string>()
  private readonly references = new Map<string, ProviderReference>()
  private readonly key: string
  private revision = 0
  private savedRaw: string | null = null
  private home?: SourceHome
  private browsing: BrowseOptions = {}
  private guideMatches = new Map<string, string>()
  constructor(private storage: Storage | null, private source: Source) {
    this.key = PREFIX + libraryId(JSON.stringify(source))
    try {
      const raw = storage?.getItem(this.key)
      this.savedRaw = raw ?? null
      if (!raw || raw.length > 2 * 1024 * 1024) return
      const data = JSON.parse(raw)
      this.home = readSourceHome(data.homeLayout, source)
      this.browsing = readBrowseOptions(data.browseOptions) || {}
      this.guideMatches = new Map(readGuideMatches(data.guideMatches) || [])
      if (Array.isArray(data.favorites)) for (const id of data.favorites.slice(0, MAX_FAVORITES)) if (validId(id)) this.favorites.add(id)
      if (Array.isArray(data.watchlist)) for (const id of data.watchlist.slice(0, MAX_WATCHLIST)) if (validId(id)) this.watchlist.add(id)
      if (Array.isArray(data.recent)) for (const item of data.recent.slice(0, MAX_RECENT).reverse()) {
        if (!item || !validId(item.id) || ![item.at, item.position, item.duration].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) continue
        if (item.position > item.duration || item.at > Date.now() + 86400000) continue
        this.recent.set(item.id, { id: item.id, at: item.at, position: item.position, duration: item.duration, ...(item.completed === true ? { completed: true } : {}) })
        if (item.completed === true) this.watched.add(item.id)
      }
      if (Array.isArray(data.watched)) for (const id of data.watched.slice(-10000)) if (validId(id)) this.addWatched(id)
      if (Array.isArray(data.seasons)) for (const entry of data.seasons.slice(0, 1000)) { if (Array.isArray(entry) && validId(entry[0]) && typeof entry[1] === 'string' && entry[1].length <= 100) this.seasons.set(entry[0], entry[1]) }
      if (source.kind === 'xtream' && Array.isArray(data.references)) for (const item of data.references.slice(0, MAX_FAVORITES + MAX_WATCHLIST + MAX_RECENT)) {
        const reference = readProviderReference(item)
        if (!reference) continue
        const id = channelId(referenceChannel(source, reference))
        if (this.favorites.has(id) || this.watchlist.has(id) || this.recent.has(id)) this.references.set(id, reference)
      }
    } catch { /* A broken or unavailable store still permits session use. */ }
  }
  isFavorite(channel: Channel) { return this.favorites.has(channelId(channel)) }
  get homeLayout() { return this.home && cloneSourceHome(this.home) }
  get persistent() { return !!this.storage }
  guideMatch(channel: Channel) { return this.guideMatches.get(channelId(channel)) }
  setGuideMatch(channel: Channel, tvgId?: string) {
    if (channel.mediaKind && channel.mediaKind !== 'live' || tvgId !== undefined && !validGuideId(tvgId)) throw new Error('Choose a valid guide channel for a live stream.')
    const id = channelId(channel)
    if (tvgId !== undefined && !this.guideMatches.has(id) && this.guideMatches.size >= MAX_GUIDE_MATCHES) throw new Error('This source already has 1,000 guide matches. Reset an unused match before adding another.')
    this.checkStoredRevision(); const before = this.snapshot()
    if (tvgId === undefined) this.guideMatches.delete(id); else this.guideMatches.set(id, tvgId.toLowerCase())
    try { this.save() } catch { this.restoreSnapshot(before); throw new Error('TV storage could not save this guide match. Your previous match was kept.') }
  }
  browseChoice(view: BrowseView): BrowseChoice { return { ...(this.browsing[view] || DEFAULT_BROWSE_CHOICE) } }
  setBrowseChoice(view: BrowseView, choice: BrowseChoice) {
    const next = readBrowseOptions({ ...this.browsing, [view]: choice })
    if (!next) throw new Error('These browsing choices are invalid.')
    this.checkStoredRevision(); const before = this.snapshot(); this.browsing = next
    try { this.save() } catch { this.restoreSnapshot(before); throw new Error('TV storage could not save these browsing choices. Previous saved choices were kept.') }
  }
  setHomeLayout(value: SourceHome) {
    const next = readSourceHome(value, this.source)
    if (!next) throw new Error('This Home layout is invalid or exceeds eight category rows.')
    this.checkStoredRevision(); const before = this.snapshot(); this.home = next
    try { this.save() } catch { this.restoreSnapshot(before); throw new Error('TV storage could not save this layout. Your previous layout is unchanged.') }
  }
  isWatchlisted(channel: Channel) { return this.watchlist.has(channelId(channel)) }
  toggleWatchlist(channel: Channel): boolean {
    if (!['movie', 'series'].includes(channel.mediaKind || '')) throw new Error('Watchlist is for movies and series.')
    this.checkStoredRevision()
    const id = channelId(channel), before = this.snapshot()
    if (this.watchlist.has(id)) this.watchlist.delete(id)
    else {
      if (this.watchlist.size >= MAX_WATCHLIST) throw new Error('Your watchlist is full (2,000). Remove a title before adding another.')
      this.watchlist.add(id)
    }
    this.remember(channel)
    try { this.save() } catch { this.restoreSnapshot(before); throw new Error('TV storage could not save the watchlist change. Your previous list was kept.') }
    return this.watchlist.has(id)
  }
  lastPlayed(channel: Channel) { return this.recent.get(channelId(channel)) }
  isWatched(channel: Channel) { return this.watched.has(channelId(channel)) }
  markWatched(channel: Channel, completed: boolean) {
    const id = channelId(channel)
    if (completed) this.addWatched(id)
    else { this.watched.delete(id); const recent = this.recent.get(id); if (recent) delete recent.completed }
    this.save()
  }
  private addWatched(id: string) { this.watched.delete(id); this.watched.add(id); while (this.watched.size > 10000) this.watched.delete(this.watched.keys().next().value!) }
  toggleFavorite(channel: Channel): boolean {
    const id = channelId(channel)
    if (this.favorites.has(id)) this.favorites.delete(id)
    else {
      if (this.favorites.size >= MAX_FAVORITES) throw new Error('Your favorites list is full (2,000). Remove a favorite before adding another.')
      this.favorites.add(id)
    }
    this.remember(channel); this.save(); return this.favorites.has(id)
  }
  record(channel: Channel, position = 0, duration = 0, ended = false) {
    const id = channelId(channel)
    const vod = channel.mediaKind !== 'live' && Number.isFinite(duration) && duration > 60 && Number.isFinite(position) && position >= 15 && position < duration - 15 && !ended
    this.recent.delete(id)
    const completed = channel.mediaKind !== 'live' && (ended || Number.isFinite(duration) && duration > 60 && Number.isFinite(position) && position >= duration - 15)
    if (completed) this.addWatched(id)
    this.recent.set(id, { id, at: Date.now(), position: vod ? position : 0, duration: vod ? duration : 0, ...(completed ? { completed: true } : {}) })
    while (this.recent.size > MAX_RECENT) this.recent.delete(this.recent.keys().next().value!)
    this.remember(channel); this.save()
  }
  clearHistory() { this.recent.clear(); this.save() }
  removeRecent(channel: Channel) { this.recent.delete(channelId(channel)); this.save() }
  season(channel: Channel) { return this.seasons.get(channelId(channel)) }
  setSeason(channel: Channel, season: string) { this.seasons.delete(channelId(channel)); this.seasons.set(channelId(channel), season.slice(0, 100)); while (this.seasons.size > 1000) this.seasons.delete(this.seasons.keys().next().value!); this.save() }
  setStorage(storage: Storage | null) { this.storage = storage; this.save() }
  bookmarkedChannels(): Channel[] { return [...this.references.values()].map(reference => referenceChannel(this.source, reference)) }
  snapshot() { return { favorites: [...this.favorites], watchlist: [...this.watchlist], recent: [...this.recent.values()].reverse().map(item => ({ ...item })), references: [...this.references.values()].map(item => ({ ...item })), seasons: [...this.seasons], watched: [...this.watched], ...(this.home ? { homeLayout: cloneSourceHome(this.home) } : {}), ...(Object.keys(this.browsing).length ? { browseOptions: cloneBrowseOptions(this.browsing) } : {}), ...(this.guideMatches.size ? { guideMatches: [...this.guideMatches] } : {}) } }
  counts(): Record<LibraryArea, number> { return { favorites: this.favorites.size, watchlist: this.watchlist.size, history: this.recent.size, watched: this.watched.size, seasons: this.seasons.size } }
  /** One storage write, with an in-session undo that never overwrites newer activity. */
  clearAreas(areas: LibraryArea[]) {
    if (!areas.length || areas.some(area => !['favorites', 'watchlist', 'history', 'watched', 'seasons'].includes(area))) throw new Error('Choose library data to clear.')
    this.checkStoredRevision()
    const before = this.snapshot()
    if (areas.includes('favorites')) this.favorites.clear()
    if (areas.includes('watchlist')) this.watchlist.clear()
    if (areas.includes('history')) this.recent.clear()
    if (areas.includes('watched')) { this.watched.clear(); for (const item of this.recent.values()) delete item.completed }
    if (areas.includes('seasons')) this.seasons.clear()
    try { this.save() } catch { this.restoreSnapshot(before); throw new Error('TV storage could not save this change. Your library was kept.') }
    let revision = this.revision
    return () => {
      if (revision !== this.revision) throw new Error('The library changed after clearing. Undo is no longer available; restore an encrypted backup if needed.')
      this.checkStoredRevision()
      const current = this.snapshot(); this.restoreSnapshot(before)
      try { this.save() } catch { this.restoreSnapshot(current); revision = this.revision; throw new Error('TV storage could not undo this change. Try again or restore your backup.') }
    }
  }
  private checkStoredRevision() {
    try { if (!this.storage || this.storage.getItem(this.key) === this.savedRaw) return } catch { throw new Error('TV storage is unavailable. No library data was changed.') }
    throw new Error('This library changed in another app window. Reopen the source before managing its data.')
  }
  private restoreSnapshot(snapshot: ReturnType<TVLibrary['snapshot']>) {
    this.home = snapshot.homeLayout && cloneSourceHome(snapshot.homeLayout)
    this.browsing = cloneBrowseOptions(snapshot.browseOptions || {})
    this.guideMatches = new Map(snapshot.guideMatches || [])
    this.favorites.clear(); for (const id of snapshot.favorites) this.favorites.add(id)
    this.watchlist.clear(); for (const id of snapshot.watchlist) this.watchlist.add(id)
    this.recent.clear(); for (const item of [...snapshot.recent].reverse()) this.recent.set(item.id, { ...item })
    this.watched.clear(); for (const id of snapshot.watched) this.watched.add(id)
    this.seasons.clear(); for (const [id, season] of snapshot.seasons) this.seasons.set(id, season)
    this.references.clear(); for (const reference of snapshot.references) this.references.set(channelId(referenceChannel(this.source, reference)), reference)
  }
  merge(other: TVLibrary) {
    if (JSON.stringify(this.source) !== JSON.stringify(other.source)) throw new Error('Library source mismatch.')
    const favorites = new Set([...this.favorites, ...other.favorites]), watchlist = new Set([...this.watchlist, ...other.watchlist]), watched = new Set([...this.watched, ...other.watched])
    const guideMatches = new Map([...other.guideMatches, ...this.guideMatches])
    if (guideMatches.size > MAX_GUIDE_MATCHES) throw new Error('Combined library exceeds 1,000 guide matches. Restore without library data or reset unused matches first.')
    if (favorites.size > MAX_FAVORITES || watchlist.size > MAX_WATCHLIST || watched.size > 10000) throw new Error('Combined library exceeds the favorites, watchlist or watched limit. Restore sources without library data, or reduce those lists first.')
    this.guideMatches = guideMatches
    if (!this.home && other.home) this.home = cloneSourceHome(other.home)
    this.browsing = { ...cloneBrowseOptions(other.browsing), ...this.browsing }
    for (const id of favorites) this.favorites.add(id)
    for (const id of watchlist) this.watchlist.add(id)
    for (const id of watched) this.watched.add(id)
    for (const [id, item] of other.recent) if (!this.recent.has(id) || this.recent.get(id)!.at < item.at) this.recent.set(id, { ...item })
    const recent = [...this.recent.values()].sort((a, b) => a.at - b.at).slice(-MAX_RECENT)
    this.recent.clear(); for (const item of recent) this.recent.set(item.id, item)
    for (const [id, reference] of other.references) if (!this.references.has(id)) this.references.set(id, reference)
    for (const [id, season] of other.seasons) if (!this.seasons.has(id) && this.seasons.size < 1000) this.seasons.set(id, season)
    this.save()
  }
  private remember(channel: Channel) { const reference = channelReference(this.source, channel); if (reference) this.references.set(channelId(channel), reference) }
  private save() {
    this.revision++
    for (const id of this.references.keys()) if (!this.favorites.has(id) && !this.watchlist.has(id) && !this.recent.has(id)) this.references.delete(id)
    const serialized = JSON.stringify(this.snapshot())
    if (serialized.length > 2 * 1024 * 1024) throw new Error('This source’s saved library exceeds the TV storage budget.')
    this.storage?.setItem(this.key, serialized); this.savedRaw = serialized
  }
}

export function forgetLibraries(storage: Storage) {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index++) { const key = storage.key(index); if (key?.startsWith(PREFIX)) keys.push(key) }
  for (const key of keys) storage.removeItem(key)
}
export function forgetLibrary(storage: Storage, source: Source) { storage.removeItem(PREFIX + libraryId(JSON.stringify(source))) }

export function durationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds), hours = Math.floor(total / 3600), minutes = Math.floor(total / 60) % 60
  return `${hours ? hours + ':' + String(minutes).padStart(2, '0') : minutes}:${String(total % 60).padStart(2, '0')}`
}
