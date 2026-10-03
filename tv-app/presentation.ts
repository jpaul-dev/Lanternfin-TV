// Adapts the original src/scripts/tv/ui/{hero,card,rail}.ts composition to
// packaged TV apps: no Astro navigation, desktop bridge, or unsupported CSS.
import type { Channel } from './catalog'
import { channelId, type TVLibrary } from './library'
import { groupVariants } from './variants'
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
  const meta = document.createElement('small'); meta.textContent = channel.group
  const recent = library?.lastPlayed(channel)
  if (versions && versions.length > 1) { const badge = document.createElement('span'); badge.className = 'version-badge'; badge.textContent = `${versions.length} versions`; art.append(badge) }
  if (library?.isWatched(channel)) { const badge = document.createElement('span'); badge.className = 'watched-badge'; badge.textContent = '✓ Watched'; art.append(badge); card.setAttribute('aria-label', `${channel.name} · ${channel.group} · Watched`) }
  if (versions && versions.length > 1) card.setAttribute('aria-label', `${card.getAttribute('aria-label') || `${channel.name} · ${channel.group}`} · ${versions.length} versions`)
  if (recent?.position && recent.duration) { const progress = document.createElement('progress'); progress.max = recent.duration; progress.value = recent.position; progress.className = 'card-progress'; progress.setAttribute('aria-label', 'Viewing progress'); art.append(progress) }
  card.append(art, name, meta); card.onclick = activate
  return card
}
let rowGeneration = 0
let grouping: AbortController | undefined
export function cancelHomeRows() { rowGeneration++; grouping?.abort() }
export async function homeRows(root: HTMLElement, channels: Channel[], library: TVLibrary | undefined, activate: (channel: Channel, versions?: Channel[]) => void, language?: string) {
  grouping?.abort(); const controller = new AbortController(); grouping = controller
  const token = ++rowGeneration
  const focused = root.contains(document.activeElement) ? (document.activeElement as HTMLElement)?.dataset.channel : undefined
  root.replaceChildren()
  let grouped: Awaited<ReturnType<typeof groupVariants>> | undefined
  if (language) {
    try { grouped = await groupVariants(channels, language, controller.signal) } catch { return }
    if (token !== rowGeneration) return
  }
  // One bounded pass, rather than separate full-catalog copies for every rail.
  const recent: Channel[] = [], favorites: Channel[] = [], live: Channel[] = [], movies: Channel[] = [], series: Channel[] = []
  const seenRecent = new Set<string>(); let started = performance.now(), index = 0
  for (const channel of channels) {
    if (library?.recent.size && library.lastPlayed(channel) && !seenRecent.has(channelId(channel))) { recent.push(channel); seenRecent.add(channelId(channel)) }
    if (library?.favorites.size && favorites.length < 12 && library.isFavorite(channel)) favorites.push(channel)
    const row = channel.mediaKind === 'movie' ? movies : ['series', 'episode'].includes(channel.mediaKind || '') ? series : live
    const group = grouped?.groups.get(channel)
    if (row.length < 12 && (!group || group.selected === channel)) row.push(channel)
    if (++index % 512 === 0 && performance.now() - started >= 12) { await new Promise<void>(resolve => setTimeout(resolve, 0)); if (token !== rowGeneration) return; started = performance.now() }
  }
  recent.sort((a, b) => (library?.lastPlayed(b)?.at || 0) - (library?.lastPlayed(a)?.at || 0))
  for (const [title, entries] of [['Continue watching', recent.filter(channel => !!library?.lastPlayed(channel)?.position).slice(0, 12)], ['Recently watched', recent.slice(0, 12)], ['Your favorites', favorites], ['Live TV', live], ['Movies', movies], ['Series & episodes', series]] as const) {
    if (!entries.length) continue
    const section = document.createElement('section'); section.className = 'home-row'
    const heading = document.createElement('h2'); heading.textContent = title
    const rail = document.createElement('div'); rail.className = 'poster-rail'
    for (const channel of entries) {
      const group = title === 'Movies' || title === 'Series & episodes' ? grouped?.groups.get(channel) : undefined
      rail.append(channelCard(channel, () => activate(channel, group?.members), library, group?.members))
    }
    section.append(heading, rail); root.append(section)
  }
  if (focused) root.querySelector<HTMLElement>(`[data-channel="${focused}"]`)?.focus({ preventScroll: true })
  return grouped?.groups
}
