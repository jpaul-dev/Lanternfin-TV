// Adapts the original src/scripts/tv/ui/{hero,card,rail}.ts composition to
// packaged TV apps: no Astro navigation, desktop bridge, or unsupported CSS.
import type { Channel } from './catalog'
import { channelId, type TVLibrary } from './library'
import { indexVariants } from './variants'
import { tr } from './i18n'
import { HOME_ROWS, DEFAULT_HOME_ROWS, type HomeRow } from './home-config'
import { NewestTitles } from './discovery'
import { runtimeLabel } from './provider-runtime'
import { homeKind, type HomeCategory, type HomeRowId } from './source-home'
import type { VariantGroup, VariantPreference } from './variants'
export type CategoryHomeRow = { category: HomeCategory; channels?: Channel[]; open: () => void }
const cardChannels = new WeakMap<HTMLElement, Channel>()
const cardVariantGroups = new WeakMap<HTMLElement, Channel[]>()
export function cardChannel(element: HTMLElement) { return cardChannels.get(element) }
export function cardVersions(element: HTMLElement) { return cardVariantGroups.get(element) }
export function channelCard(channel: Channel, activate: () => void, library?: TVLibrary, versions?: Channel[]): HTMLButtonElement {
  const card = document.createElement('button'); card.className = 'channel'; card.type = 'button'
  card.dataset.kind = channel.mediaKind || 'live'
  card.dataset.channel = channelId(channel)
  cardChannels.set(card, channel)
  if (versions) cardVariantGroups.set(card, versions)
  const art = document.createElement('span'); art.className = 'card-art'; art.setAttribute('aria-hidden', 'true')
  const fallback = document.createElement('span'); fallback.className = 'art-fallback'; fallback.textContent = channel.name.slice(0, 2).toUpperCase(); art.append(fallback)
  if (channel.logo) {
    const image = document.createElement('img'); image.src = channel.logo; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer'
    image.onerror = () => image.remove(); art.append(image)
  }
  const name = document.createElement('span'); name.className = 'card-title'; name.textContent = (library?.isFavorite(channel) ? '★ ' : '') + channel.name
  const meta = document.createElement('small'); meta.textContent = [channel.year, channel.rating ? `${channel.rating.toFixed(1)} / 10` : '', channel.group].filter(Boolean).join(' · ')
  const recent = library?.lastPlayed(channel)
  if (versions && versions.length > 1) { const badge = document.createElement('span'); badge.className = 'version-badge'; badge.textContent = `${versions.length} versions`; art.append(badge) }
  if (library?.isWatched(channel)) { const badge = document.createElement('span'); badge.className = 'watched-badge'; badge.textContent = '✓ Watched'; art.append(badge); card.setAttribute('aria-label', `${channel.name} · ${channel.group} · Watched`) }
  if (versions && versions.length > 1) card.setAttribute('aria-label', `${card.getAttribute('aria-label') || `${channel.name} · ${channel.group}`} · ${versions.length} versions`)
  if (recent?.position && recent.duration) { const progress = document.createElement('progress'); progress.max = recent.duration; progress.value = recent.position; progress.className = 'card-progress'; progress.setAttribute('aria-label', 'Viewing progress'); art.append(progress) }
  card.append(art, name, meta); card.onclick = activate
  return card
}
/** Android-style landscape episode rows retain the shared remote/menu identity. */
export function episodeRow(episode: Channel, activate: () => void, library?: TVLibrary) {
  const card = channelCard(episode, activate, library), copy = document.createElement('span')
  card.classList.add('episode-row'); copy.className = 'episode-copy'
  const name = card.querySelector<HTMLElement>('.card-title')!, meta = card.querySelector('small')!
  const recent = library?.lastPlayed(episode)
  meta.textContent = [runtimeLabel(episode.durationSeconds), recent?.position ? tr('Continue from {position}', { position: runtimeLabel(Math.floor(recent.position)) }) : '', library?.isWatched(episode) ? tr('Watched') : ''].filter(Boolean).join(' · ')
  meta.hidden = !meta.textContent; copy.append(name, meta)
  if (episode.description) { const plot = document.createElement('span'); plot.className = 'episode-description'; plot.textContent = episode.description.slice(0, 600); copy.append(plot) }
  card.append(copy); return card
}
let rowGeneration = 0
let grouping: AbortController | undefined
let activeRows: HTMLElement | undefined
export function cancelHomeRows() { rowGeneration++; grouping?.abort(); activeRows?.setAttribute('aria-busy', 'false') }
export async function homeRows(root: HTMLElement, channels: Channel[], library: TVLibrary | undefined, activate: (channel: Channel, versions?: Channel[]) => void, language?: VariantPreference, layout: readonly HomeRowId[] = DEFAULT_HOME_ROWS, categoryRows: CategoryHomeRow[] = [], include?: (channel: Channel) => boolean, resolve?: (channel: Channel) => Channel | undefined) {
  grouping?.abort(); const controller = new AbortController(); grouping = controller
  const token = ++rowGeneration
  activeRows = root; root.setAttribute('aria-busy', 'true'); root.dataset.loading = tr('Loading…')
  try {
  let grouped: Awaited<ReturnType<typeof indexVariants>> | undefined
  const visible = include || ((channel: Channel) => library?.isVisible(channel) !== false)
  const groupMovies = layout.includes('movies') || layout.includes('new-movies'), groupSeries = layout.includes('series') || layout.includes('new-series')
  if (language && (groupMovies || groupSeries)) {
    try { grouped = await indexVariants(channels, language, controller.signal, channel => visible(channel) && (channel.mediaKind === 'movie' ? groupMovies : channel.mediaKind === 'series' && groupSeries), resolve) } catch { return }
    if (token !== rowGeneration) return
  }
  // One bounded pass, rather than separate full-catalog copies for every rail.
  const recent: Channel[] = [], favorites: Channel[] = [], watchlist: Channel[] = [], live: Channel[] = [], movies: Channel[] = [], series: Channel[] = []
  const watchlistOrder = new Map([...(library?.watchlist || [])].reverse().map((id, index) => [id, index]))
  const seenWatchlist = new Set<string>()
  const newestMovies = new NewestTitles(), newestSeries = new NewestTitles()
  const wantMovies = layout.includes('new-movies'), wantSeries = layout.includes('new-series')
  const selectedCategories = categoryRows.filter(row => layout.includes(row.category.id))
  const playlistRows = new Map<string, Map<string, { entries: Channel[]; seen: Set<string> }>>(), playlistEntries = new Map<string, Channel[]>()
  for (const row of selectedCategories) if (!language && row.category.group !== undefined) {
    let kinds = playlistRows.get(row.category.group); if (!kinds) playlistRows.set(row.category.group, kinds = new Map())
    const entries: Channel[] = []; kinds.set(row.category.kind, { entries, seen: new Set() }); playlistEntries.set(row.category.id, entries)
  }
  const seenRecent = new Set<string>(); let started = performance.now(), index = 0
  for (const original of channels) {
    if (++index % 512 === 0 && performance.now() - started >= 12) { await new Promise<void>(resolve => setTimeout(resolve, 0)); if (token !== rowGeneration) return; started = performance.now() }
    const channel = resolve ? resolve(original) : original
    if (!channel || !visible(channel)) continue
    const custom = playlistRows.get(channel.group)?.get(homeKind(channel))
    if (custom && custom.entries.length < 12) { const id = channelId(channel); if (!custom.seen.has(id)) { custom.seen.add(id); custom.entries.push(channel) } }
    if (library?.recent.size && library.lastPlayed(channel) && !seenRecent.has(channelId(channel))) { recent.push(channel); seenRecent.add(channelId(channel)) }
    if (library?.favorites.size && favorites.length < 12 && library.isFavorite(channel)) favorites.push(channel)
    if (library?.watchlist.size && watchlistOrder.has(channelId(channel)) && !seenWatchlist.has(channelId(channel))) { watchlist.push(channel); seenWatchlist.add(channelId(channel)) }
    const row = channel.mediaKind === 'movie' ? movies : ['series', 'episode'].includes(channel.mediaKind || '') ? series : live
    const group = grouped?.groups.get(channel)
    if (row.length < 12 && (!group || group.selected === channel)) row.push(channel)
    // A newly added language version can promote its group while preserving the
    // user's preferred version. The original date on each item stays untouched.
    if (channel.mediaKind === 'movie' && wantMovies) newestMovies.add(group?.selected || channel, channel.addedAt)
    if (channel.mediaKind === 'series' && wantSeries) newestSeries.add(group?.selected || channel, channel.addedAt)
  }
  recent.sort((a, b) => (library?.lastPlayed(b)?.at || 0) - (library?.lastPlayed(a)?.at || 0))
  watchlist.sort((a, b) => watchlistOrder.get(channelId(a))! - watchlistOrder.get(channelId(b))!); watchlist.length = Math.min(12, watchlist.length)
  const fragment = document.createDocumentFragment()
  const rows = { continue: recent.filter(channel => !!library?.lastPlayed(channel)?.position).slice(0, 12), watchlist, recent: recent.slice(0, 12), favorites, live, movies, series, 'new-movies': newestMovies.channels, 'new-series': newestSeries.channels }
  const custom = new Map<string, { entries: Channel[]; groups?: WeakMap<Channel, VariantGroup>; row: CategoryHomeRow }>()
  for (const row of selectedCategories) {
    const playlist = row.category.group !== undefined
    const include = (channel: Channel) => visible(channel) && (!(playlist && language) || channel.group === row.category.group && homeKind(channel) === row.category.kind)
    const entries = playlist && language ? channels : playlistEntries.get(row.category.id) || row.channels || []
    let groups: WeakMap<Channel, VariantGroup> | undefined
    // Group within this category, so a language version in a different category
    // cannot replace the user's selected provider membership.
    if (language) { try { groups = (await indexVariants(entries, language, controller.signal, include)).groups } catch { return } }
    const cards: Channel[] = [], seen = new Set<string>(); let scanned = 0
    for (const entry of entries) {
      if (!include || include(entry)) {
        const channel = groups?.get(entry)?.selected || entry
        const id = channelId(channel); if (!seen.has(id)) { seen.add(id); cards.push(channel); if (cards.length === 12) break }
      }
      if (++scanned % 512 === 0 && performance.now() - started >= 12) { await new Promise<void>(resolve => setTimeout(resolve, 0)); if (token !== rowGeneration) return; started = performance.now() }
    }
    if (token !== rowGeneration) return
    custom.set(row.category.id, { entries: cards, groups, row })
  }
  for (const id of layout) {
    const category = custom.get(id), title = category?.row.category.title || HOME_ROWS[id as HomeRow], entries = category?.entries || rows[id as HomeRow]
    if (!entries || !entries.length && !category) continue
    const section = document.createElement('section'); section.className = 'home-row'; section.dataset.row = category ? id : title; section.dataset.rowId = id
    const heading = document.createElement('h2'); heading.textContent = category ? title : tr(title)
    const rail = document.createElement('div'); rail.className = 'poster-rail'
    for (const channel of entries) {
      const group = category ? category.groups?.get(channel) : ['movies', 'series', 'new-movies', 'new-series'].includes(id) ? grouped?.groups.get(channel) : undefined
      rail.append(channelCard(channel, () => activate(channel, group?.members), library, group?.members))
    }
    const header = document.createElement('div'); header.className = 'home-row-heading'; header.append(heading)
    if (category) {
      const open = document.createElement('button'); open.textContent = tr('View all'); open.dataset.homeAction = 'open'
      open.setAttribute('aria-label', tr('View all in {name}', { name: title })); open.onclick = category.row.open; header.append(open)
    }
    section.append(header)
    if (category && !entries.length) { const note = document.createElement('p'); note.className = 'row-note'; note.textContent = tr('No titles loaded for this category. Choose View all to open it.'); section.append(note) }
    if (id === 'new-series') { const note = document.createElement('p'); note.className = 'row-note'; note.textContent = tr('Includes series updated by your provider.'); section.append(note) }
    section.append(rail); fragment.append(section)
  }
  if (token !== rowGeneration) return
  // Keep old rails interactive until their replacements are ready. Restore only
  // focus still inside these rows; never pull the user back from the sidebar.
  const focused = root.contains(document.activeElement) ? (document.activeElement as HTMLElement)?.dataset.channel : undefined
  const focusedAction = root.contains(document.activeElement) ? (document.activeElement as HTMLElement)?.dataset.homeAction : undefined
  const focusedRow = focused || focusedAction ? (document.activeElement?.closest('.home-row') as HTMLElement | null)?.dataset.row : undefined
  const scroll = new Map([...root.querySelectorAll<HTMLElement>('.poster-rail')].map(rail => [rail.parentElement?.dataset.row, rail.scrollLeft]))
  root.replaceChildren(fragment)
  for (const rail of root.querySelectorAll<HTMLElement>('.poster-rail')) rail.scrollLeft = scroll.get(rail.parentElement?.dataset.row) || 0
  if (focused || focusedAction) {
    const row = [...root.querySelectorAll<HTMLElement>('.home-row')].find(row => row.dataset.row === focusedRow)
    const target = (focusedAction ? row?.querySelector<HTMLElement>('[data-home-action="open"]') : row?.querySelector<HTMLElement>(`[data-channel="${focused}"]`) || root.querySelector<HTMLElement>(`[data-channel="${focused}"]`)) || root.querySelector<HTMLElement>('button') || document.getElementById('hero-play')
    target?.focus({ preventScroll: true })
  }
  return grouped?.groups
  } finally { if (token === rowGeneration) root.setAttribute('aria-busy', 'false') }
}
