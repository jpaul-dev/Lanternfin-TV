import { parseNamePrefix, languageTagLabel } from '../src/scripts/lib/language-tags'
import type { Channel } from './catalog'

const languages = new WeakMap<Channel, string>()
/** Provider title tags are a browsing hint, not a guarantee about the audio tracks. */
export function providerLanguage(channel: Channel): string {
  let tag = languages.get(channel)
  if (tag === undefined) { tag = parseNamePrefix(channel.name).tag || 'untagged'; languages.set(channel, tag) }
  return tag
}
export function providerLanguageLabel(tag: string) { return tag === 'untagged' ? 'No language tag' : `${languageTagLabel(tag, 'en')} · ${tag}` }
export function watchedFilter(value: string, watched: boolean): boolean {
  return value === 'watched' ? watched : value === 'unwatched' ? !watched : true
}
