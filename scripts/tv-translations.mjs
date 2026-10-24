import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const locales = ['es', 'de', 'fr', 'pt-BR', 'it', 'ru', 'zh', 'ja', 'tr', 'ar', 'ur', 'nl', 'hi', 'id', 'pl']
// Portable labels that use different English copy for the same original action.
const aliases = { Watchlist: 'nav.watchlist', 'Save for later': 'detail.action.watchLater', 'Remove from watchlist': 'detail.action.removeWatchlist', 'Source accent color': 'login.field.accent', 'The current source overrides the app accent color.': 'settings.accent.overrideHint', 'Automatic · interface language': 'settings.contentLang.auto', Automatic: 'epg.map.filterAuto' }
const parameters = text => (text.match(/\{\w+\}/g) || []).sort().join('|')
export function validatePortableTranslations(english, translated, code) {
  if (!english || typeof english !== 'object' || Array.isArray(english) || !translated || typeof translated !== 'object' || Array.isArray(translated)) throw new Error(`Invalid portable messages: ${code}`)
  const keys = Object.keys(english)
  if (!keys.length || keys.length !== Object.keys(translated).length) throw new Error(`Incomplete portable messages: ${code}`)
  for (const key of keys) {
    const value = translated[key]
    if (english[key] !== key || !Object.prototype.hasOwnProperty.call(translated, key) || typeof value !== 'string' || !value.trim() || value.length > 8192 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) || parameters(key) !== parameters(value) || /[{}]/.test(value.replace(/\{\w+\}/g, ''))) throw new Error(`Invalid portable translation (${code}): ${key}`)
  }
}
/** Packaged scripts avoid file:// fetch restrictions. No translation service is contacted. */
export async function buildTranslations(root, out) {
  const english = JSON.parse(await readFile(resolve(root, 'src/i18n/en.json'), 'utf8'))
  const portableEnglish = JSON.parse(await readFile(resolve(root, 'tv-app/locales/en.json'), 'utf8'))
  validatePortableTranslations(portableEnglish, portableEnglish, 'en')
  for (const code of locales) {
    const localized = JSON.parse(await readFile(resolve(root, `src/i18n/${code}.json`), 'utf8')), values = Object.create(null)
    const portable = JSON.parse(await readFile(resolve(root, `tv-app/locales/${code}.json`), 'utf8'))
    validatePortableTranslations(portableEnglish, portable, code)
    for (const [key, text] of Object.entries(english)) {
      const value = localized[key]
      if (typeof text === 'string' && text && typeof value === 'string' && value && !(text in values)) values[text] = value
    }
    for (const [text, key] of Object.entries(aliases)) {
      if (typeof english[key] !== 'string') throw new Error(`Unknown TV translation key: ${key}`)
      if (typeof localized[key] === 'string' && localized[key]) values[text] = localized[key]
    }
    Object.assign(values, portable)
    await writeFile(resolve(out, `locale-${code}.js`), `window.LanternfinTranslations=window.LanternfinTranslations||{};window.LanternfinTranslations[${JSON.stringify(code)}]=${JSON.stringify(values).replace(/</g, '\\u003c')};\n`)
  }
}
