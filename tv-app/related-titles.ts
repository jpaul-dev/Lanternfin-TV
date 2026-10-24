import type { Channel, Source } from './catalog'
import { channelId } from './library'
import { groupVariants, type VariantPreference } from './variants'

export type RelatedTitle = { channel: Channel; versions?: Channel[] }
/** Category-local suggestions, like the original TV detail rail; no external recommendation service. */
export async function relatedTitles(current: Channel, pool: Channel[], source: Source['kind'], language: VariantPreference | undefined, signal: AbortSignal, include?: (channel: Channel) => boolean): Promise<RelatedTitle[]> {
  const check = () => { if (signal.aborted) throw new Error('Related titles canceled.') }
  check()
  if (!['movie', 'series'].includes(current.mediaKind || '')) return []
  const currentId = channelId(current), matches: Channel[] = []
  let categoryId = current.categoryId, started = performance.now(), processed = 0, includesCurrent = false
  const yieldIfNeeded = async () => {
    if (performance.now() - started >= 10) { await new Promise<void>(resolve => setTimeout(resolve, 0)); started = performance.now() }
    check()
  }
  // Older bookmarks did not retain category IDs. Resolve from the current source's catalog.
  if (source === 'xtream' && !categoryId) {
    for (const channel of pool) {
      if (channel.mediaKind === current.mediaKind && channel.providerId === current.providerId && channel.categoryId) { categoryId = channel.categoryId; break }
      if (++processed % 512 === 0) await yieldIfNeeded()
    }
    if (!categoryId) return [] // Duplicate category labels must never be treated as the same category.
  }
  for (const channel of pool) {
    if ((!include || include(channel)) && channel.mediaKind === current.mediaKind && (source === 'xtream' ? channel.categoryId === categoryId : channel.group === current.group)) {
      matches.push(channel)
      if (channel === current || (source === 'xtream' ? channel.providerId === current.providerId : channel.url === current.url)) includesCurrent = true
    }
    if (++processed % 512 === 0) await yieldIfNeeded()
  }
  // Include the current title when grouping so its other language versions do not recommend themselves.
  if (language && !includesCurrent) matches.unshift(current)
  const grouped = language ? await groupVariants(matches, language, signal) : undefined
  const result: RelatedTitle[] = []
  for (const channel of grouped?.channels || matches) {
    const group = grouped?.groups.get(channel), id = channelId(channel)
    if (id !== currentId && !group?.members.some(member => channelId(member) === currentId)) {
      const previous = result.findIndex(item => channelId(item.channel) === id)
      if (previous < 0 || (result[previous].channel.rating || 0) < (channel.rating || 0)) {
        if (previous >= 0) result.splice(previous, 1)
        let index = result.findIndex(item => (item.channel.rating || 0) < (channel.rating || 0))
        if (index < 0) index = result.length
        if (index < 12) { result.splice(index, 0, { channel, ...(group ? { versions: group.members } : {}) }); if (result.length > 12) result.pop() }
      }
    }
    if (++processed % 512 === 0) await yieldIfNeeded()
  }
  check(); return result
}
