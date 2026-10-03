// Adapts the original src/scripts/tv/ui/{hero,card,rail}.ts composition to
// packaged TV apps: no Astro navigation, desktop bridge, or unsupported CSS.
import type { Channel } from './catalog'
import { channelId, type TVLibrary } from './library'
export function channelCard(channel: Channel, activate: () => void, library?: TVLibrary): HTMLButtonElement {
  const card = document.createElement('button'); card.className = 'channel'; card.type = 'button'
  card.dataset.kind = channel.mediaKind || 'live'
  const art = document.createElement('span'); art.className = 'card-art'; art.setAttribute('aria-hidden', 'true')
  const fallback = document.createElement('span'); fallback.className = 'art-fallback'; fallback.textContent = channel.name.slice(0, 2).toUpperCase(); art.append(fallback)
  if (channel.logo) {
    const image = document.createElement('img'); image.src = channel.logo; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer'
    image.onerror = () => image.remove(); art.append(image)
  }
  const name = document.createElement('span'); name.className = 'card-title'; name.textContent = (library?.isFavorite(channel) ? '★ ' : '') + channel.name
  const meta = document.createElement('small'); meta.textContent = channel.group
  card.append(art, name, meta); card.onclick = activate
  return card
}
let rowGeneration = 0
export function cancelHomeRows() { rowGeneration++ }
export async function homeRows(root: HTMLElement, channels: Channel[], library: TVLibrary | undefined, activate: (channel: Channel) => void) {
  const token = ++rowGeneration
  root.replaceChildren()
  // One bounded pass, rather than separate full-catalog copies for every rail.
  const recent: Channel[] = [], favorites: Channel[] = [], live: Channel[] = [], movies: Channel[] = [], series: Channel[] = []
  const seenRecent = new Set<string>(); let started = performance.now(), index = 0
  for (const channel of channels) {
    if (library?.recent.size && library.lastPlayed(channel) && !seenRecent.has(channelId(channel))) { recent.push(channel); seenRecent.add(channelId(channel)) }
    if (library?.favorites.size && favorites.length < 12 && library.isFavorite(channel)) favorites.push(channel)
    const row = channel.mediaKind === 'movie' ? movies : ['series', 'episode'].includes(channel.mediaKind || '') ? series : live
    if (row.length < 12) row.push(channel)
    if (++index % 512 === 0 && performance.now() - started >= 12) { await new Promise<void>(resolve => setTimeout(resolve, 0)); if (token !== rowGeneration) return; started = performance.now() }
  }
  recent.sort((a, b) => (library?.lastPlayed(b)?.at || 0) - (library?.lastPlayed(a)?.at || 0))
  for (const [title, entries] of [['Recently watched', recent.slice(0, 12)], ['Your favorites', favorites], ['Live TV', live], ['Movies', movies], ['Series & episodes', series]] as const) {
    if (!entries.length) continue
    const section = document.createElement('section'); section.className = 'home-row'
    const heading = document.createElement('h2'); heading.textContent = title
    const rail = document.createElement('div'); rail.className = 'poster-rail'
    for (const channel of entries) rail.append(channelCard(channel, () => activate(channel), library))
    section.append(heading, rail); root.append(section)
  }
}
