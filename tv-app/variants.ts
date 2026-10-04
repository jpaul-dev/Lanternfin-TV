import { LANGUAGE_TOKENS, parseNamePrefix, prefixQualityTokens } from '../src/scripts/lib/language-tags'
import type { Channel } from './catalog'

export type VariantGroup = { members: Channel[]; selected: Channel }
export type VariantPreference = string | readonly string[]
function variantKey(channel: Channel) {
  // No per-title metadata cache: a full provider library can remain alive for
  // hours, so even weakly keyed cached objects would remain alive with it.
  if (channel.mediaKind !== 'movie' && channel.mediaKind !== 'series') return ''
  const prefix = parseNamePrefix(channel.name)
  // Preserve years, editions, punctuation and accents. Never guess the identity
  // of an untagged title, live channel or individual episode.
  return prefix.tag ? `${channel.mediaKind}:${prefix.rest.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()}` : ''
}
function selection(members: Channel[], language: VariantPreference) {
  if (!members.length) throw new TypeError('At least one version is required.')
  const requested = typeof language === 'string' ? language.toLowerCase() : '', base = requested.split('-')[0]
  let selected = members[0], best = Infinity, firstTag: string | undefined, different = false
  for (const channel of members) {
    const tag = parseNamePrefix(channel.name).tag || '', code = LANGUAGE_TOKENS[tag]?.bcp47?.toLowerCase()
    const index = typeof language === 'string' ? code === requested ? 0 : code?.split('-')[0] === base ? 1 : 2 : language.indexOf(tag)
    const rank = (index < 0 ? language.length : index) * 100 + prefixQualityTokens(channel.name).length
    if (firstTag === undefined) firstTag = tag; else if (tag !== firstTag) different = true
    if (rank < best) { best = rank; selected = channel }
  }
  return { selected, different }
}
export function preferredVariant(members: Channel[], language: VariantPreference) { return selection(members, language).selected }

/** Singleton titles cost one map entry; only actual duplicates allocate arrays.
 * An overfull bucket becomes a marker immediately and never retains >100 titles.
 * Optional membership is checked within the cooperative scan, not by making a
 * second full-size category array or a generator that can block between yields.
 */
export async function indexVariants(channels: Channel[], language: VariantPreference, signal: AbortSignal, include?: (channel: Channel) => boolean) {
  const buckets = new Map<string, Channel | Channel[] | null>(), groups = new WeakMap<Channel, VariantGroup>()
  let count = 0
  let started = performance.now(), operations = 0
  const check = () => { if (signal.aborted) throw new Error('Grouping cancelled.') }
  const yieldIfNeeded = async () => {
    if (performance.now() - started >= 10) { await new Promise<void>(resolve => setTimeout(resolve, 0)); started = performance.now() }
    check()
  }
  check()
  for (const channel of channels) {
    const key = !include || include(channel) ? variantKey(channel) : ''
    if (key) {
      const bucket = buckets.get(key)
      if (bucket === undefined) buckets.set(key, channel)
      else if (bucket !== null) {
        if (!Array.isArray(bucket)) buckets.set(key, [bucket, channel])
        else if (bucket.length === 100) buckets.set(key, null)
        else bucket.push(channel)
      }
    }
    if (++operations % 512 === 0) await yieldIfNeeded()
  }
  for (const members of buckets.values()) {
    if (Array.isArray(members)) {
      const choice = selection(members, language)
      if (choice.different) {
        const group = { members, selected: choice.selected }; count++
        for (const channel of members) groups.set(channel, group)
      }
    }
    if (++operations % 512 === 0) await yieldIfNeeded()
  }
  check(); return { groups, count }
}

/** Yielding grouping for current search results; never rewrites IDs or history.
 * Without any collapsible versions, borrow the original array without copying.
 */
export async function groupVariants(channels: Channel[], language: VariantPreference, signal: AbortSignal) {
  const { groups, count } = await indexVariants(channels, language, signal)
  if (signal.aborted) throw new Error('Grouping cancelled.')
  if (!count) return { channels, groups }
  const result: Channel[] = [], seen = new Set<VariantGroup>()
  let started = performance.now(), operations = 0
  for (const channel of channels) {
    const group = groups.get(channel)
    if (!group) result.push(channel)
    else if (!seen.has(group)) { seen.add(group); result.push(group.selected) }
    if (++operations % 512 === 0 && performance.now() - started >= 10) { await new Promise<void>(resolve => setTimeout(resolve, 0)); if (signal.aborted) throw new Error('Grouping cancelled.'); started = performance.now() }
  }
  if (signal.aborted) throw new Error('Grouping cancelled.')
  return { channels: result, groups }
}
