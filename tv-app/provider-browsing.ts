import type { Channel } from './catalog'
import type { ProviderIndex } from './provider-index'
import type { Category, MediaKind } from './xtream'
import { homeKind } from './source-home'
import { tr } from './i18n'

type Allowed = (kind: MediaKind, id: string) => boolean
export type ResolveTitle = (channel: Channel) => Channel | undefined
const kinds = { live: 'Live TV', movie: 'Movies', series: 'Series' }
const identity = (channel: Channel) => channel.categoryId ? `${homeKind(channel)}:${channel.categoryId}` : ''

/** Select a real visible membership; IDs and media addresses stay unchanged. */
export function providerResolver(index: ProviderIndex | undefined, allowed: Allowed, group = ''): ResolveTitle {
  const accept = (channel: Channel) => (!group || identity(channel) === group) && allowed(homeKind(channel), channel.categoryId || '')
  return channel => index ? index.representative(channel, accept) : accept(channel) ? channel : undefined
}

/** A compact category directory spanning all loaded memberships, not just first labels. */
export async function providerGroups(pool: Channel[], index: ProviderIndex | undefined, allowed: Allowed, signal: AbortSignal): Promise<Category[]> {
  const groups = new Map<string, { id: string; name: string; kind: MediaKind; category: string }>(), names = new Map<string, number>()
  let operations = 0, started = performance.now()
  const check = () => { if (signal.aborted) throw new Error('Category search cancelled.') }
  const yieldIfNeeded = async () => {
    if (performance.now() - started >= 10) { await new Promise<void>(resolve => setTimeout(resolve, 0)); started = performance.now() }
    check()
  }
  check()
  const labels = new Map<string, string>()
  for (const kind of ['live', 'movie', 'series'] as const) {
    for (const category of index?.categories[kind] || []) {
      labels.set(`${kind}:${category.id}`, category.name)
      if (++operations % 512 === 0) await yieldIfNeeded()
    }
  }
  for (const channel of pool) {
    for (const member of index?.categoryChannels(channel) || [channel]) {
      const id = identity(member), kind = homeKind(member)
      const label = labels.get(id) || (member.mediaKind === 'episode' ? '' : member.group)
      if (id && label && !groups.has(id) && allowed(kind, member.categoryId!)) {
        groups.set(id, { id, name: label, kind, category: member.categoryId! })
        const name = `${kind}:${label}`; names.set(name, (names.get(name) || 0) + 1)
      }
      if (++operations % 512 === 0) await yieldIfNeeded()
    }
    if (++operations % 512 === 0) await yieldIfNeeded()
  }
  const result: Category[] = []
  for (const entry of groups.values()) {
    const suffix = names.get(`${entry.kind}:${entry.name}`)! > 1 ? ` · ${entry.category}` : ''
    result.push({ id: entry.id, name: `${entry.name} · ${tr(kinds[entry.kind])}${suffix}` })
    if (++operations % 512 === 0) await yieldIfNeeded()
  }
  check(); return result
}
