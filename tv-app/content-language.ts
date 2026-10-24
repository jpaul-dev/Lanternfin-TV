import { LANGUAGE_TOKENS, languageTagLabel, preferredTagsForLocale } from '../src/scripts/lib/language-tags'

// Chromium 79 does not provide Intl.DisplayNames on every TV. Keep meaningful
// packaged labels for every original provider token without an online lookup.
const LABELS: Record<string, string> = {
  en: 'English', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', tr: 'Turkish', ru: 'Russian', ar: 'Arabic',
  ro: 'Romanian', bg: 'Bulgarian', no: 'Norwegian', fi: 'Finnish', is: 'Icelandic', hu: 'Hungarian', hr: 'Croatian', sr: 'Serbian', mk: 'Macedonian', sk: 'Slovak',
  hi: 'Hindi', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada', bn: 'Bengali', id: 'Indonesian', my: 'Burmese', vi: 'Vietnamese', th: 'Thai', so: 'Somali', he: 'Hebrew', ur: 'Urdu',
  el: 'Greek', fa: 'Persian', sq: 'Albanian', sv: 'Swedish', da: 'Danish', tl: 'Tagalog', 'es-419': 'Spanish (Latin America)', 'fr-CA': 'French (Canada)', ku: 'Kurdish', 'pt-BR': 'Portuguese (Brazil)', cs: 'Czech', uk: 'Ukrainian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
}
const owns = (value: string) => Object.prototype.hasOwnProperty.call(LANGUAGE_TOKENS, value)
/** Upgrade earlier portable BCP-47 choices; retain provider aliases separately. */
export function normalizeContentLanguage(value: unknown): string {
  if (typeof value !== 'string' || value === 'auto') return 'auto'
  if (owns(value)) return value
  return Object.keys(LANGUAGE_TOKENS).find(tag => LANGUAGE_TOKENS[tag].bcp47 === value) || 'auto'
}
export function contentLanguageChoices(locale: string) {
  return Object.keys(LANGUAGE_TOKENS).map(tag => {
    const info = LANGUAGE_TOKENS[tag], translated = languageTagLabel(tag, locale)
    const label = translated !== tag ? translated : info.label || LABELS[info.bcp47 || ''] || tag
    return { value: tag, label: `${label} (${tag})` }
  }).sort((a, b) => a.label.localeCompare(b.label, locale))
}
/** Exact provider preference first, then related language tags, interface
 * language and English. Regional fallbacks retain earlier portable behavior;
 * the original token choices (including non-language SC) stay distinct.
 */
export function contentLanguageTags(value: string, locale: string): string[] {
  const chosen = normalizeContentLanguage(value), result: string[] = []
  const add = (tag: string) => { if (owns(tag) && !result.includes(tag)) result.push(tag) }
  if (chosen !== 'auto') {
    add(chosen)
    const code = LANGUAGE_TOKENS[chosen].bcp47
    if (code) {
      for (const tag of Object.keys(LANGUAGE_TOKENS)) if (LANGUAGE_TOKENS[tag].bcp47 === code) add(tag)
      for (const tag of Object.keys(LANGUAGE_TOKENS)) if (LANGUAGE_TOKENS[tag].bcp47?.split('-')[0] === code.split('-')[0]) add(tag)
    }
  }
  const interfaceTags = preferredTagsForLocale(locale)
  if (Array.isArray(interfaceTags)) for (const tag of interfaceTags) add(tag)
  add('EN'); return result
}
