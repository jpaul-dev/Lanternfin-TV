import { LANGUAGE_TOKENS, parseNamePrefix, prefixQualityTokens } from '../src/scripts/lib/language-tags'
import type { Channel } from './catalog'

export type VariantGroup = { members: Channel[]; selected: Channel }
const metadata = new WeakMap<Channel, { key: string; tag: string; quality: number }>()
function meta(channel: Channel) {
  let value = metadata.get(channel)
  if (!value) {
    const prefix = parseNamePrefix(channel.name)
    // Conservative title identity: preserve years, editions, punctuation and accents.
    // Untagged titles, live channels and episodes never collapse by guessed identity.
    value = { key: prefix.tag && ['movie', 'series'].includes(channel.mediaKind || '') ? `${channel.mediaKind}:${prefix.rest.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()}` : '', tag: prefix.tag || '', quality: prefixQualityTokens(channel.name).length }
    metadata.set(channel, value)
  }
  return value
}
export function preferredVariant(members: Channel[], language: string) {
  const base = language.toLowerCase().split('-')[0]
  const rank = (channel: Channel) => { const info = meta(channel), code = LANGUAGE_TOKENS[info.tag]?.bcp47?.toLowerCase(); return (code === language.toLowerCase() ? 0 : code?.split('-')[0] === base ? 1 : 2) * 100 + info.quality }
  return members.reduce((best, channel) => rank(channel) < rank(best) ? channel : best)
}
/** Yielding grouping for current search results; never rewrites IDs or viewing history. */
export async function groupVariants(channels: Channel[], language: string, signal: AbortSignal) {
  const buckets = new Map<string, Channel[]>(), groups = new WeakMap<Channel, VariantGroup>()
  let started = performance.now(), operations = 0
  const check = () => { if (signal.aborted) throw new Error('Grouping cancelled.') }
  const yieldIfNeeded = async () => {
    if (performance.now() - started >= 10) { await new Promise<void>(resolve => setTimeout(resolve, 0)); started = performance.now() }
    check()
  }
  check()
  for (const channel of channels) {
    const key = meta(channel).key
    if (key) { let bucket = buckets.get(key); if (!bucket) buckets.set(key, bucket = []); bucket.push(channel) }
    if (++operations % 512 === 0) await yieldIfNeeded()
  }
  for (const members of buckets.values()) {
    if (members.length > 1 && members.length <= 100 && new Set(members.map(channel => meta(channel).tag)).size > 1) {
      const group = { members, selected: preferredVariant(members, language) }
      for (const channel of members) groups.set(channel, group)
    }
    if (++operations % 512 === 0) await yieldIfNeeded()
  }
  const result: Channel[] = [], seen = new Set<VariantGroup>()
  for (const channel of channels) {
    const group = groups.get(channel)
    if (!group) result.push(channel)
    else if (!seen.has(group)) { seen.add(group); result.push(group.selected) }
    if (++operations % 512 === 0) await yieldIfNeeded()
  }
  check(); return { channels: result, groups }
}
