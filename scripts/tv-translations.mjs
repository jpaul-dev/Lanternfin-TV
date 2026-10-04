import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const locales = ['es', 'de', 'fr', 'pt-BR', 'it', 'ru', 'zh', 'ja', 'tr', 'ar', 'ur', 'nl', 'hi', 'id', 'pl']
// Portable labels that use different English copy for the same original action.
const aliases = { Watchlist: 'nav.watchlist', 'Save for later': 'detail.action.watchLater', 'Remove from watchlist': 'detail.action.removeWatchlist', 'Source accent color': 'login.field.accent', 'The current source overrides the app accent color.': 'settings.accent.overrideHint', 'Automatic · interface language': 'settings.contentLang.auto' }
/** Packaged scripts avoid file:// fetch restrictions. No translation service is contacted. */
export async function buildTranslations(root, out) {
  const english = JSON.parse(await readFile(resolve(root, 'src/i18n/en.json'), 'utf8'))
  for (const code of locales) {
    const localized = JSON.parse(await readFile(resolve(root, `src/i18n/${code}.json`), 'utf8')), values = Object.create(null)
    for (const [key, text] of Object.entries(english)) {
      const value = localized[key]
      if (typeof text === 'string' && text && typeof value === 'string' && value && !(text in values)) values[text] = value
    }
    for (const [text, key] of Object.entries(aliases)) {
      if (typeof english[key] !== 'string') throw new Error(`Unknown TV translation key: ${key}`)
      if (typeof localized[key] === 'string' && localized[key]) values[text] = localized[key]
    }
    await writeFile(resolve(out, `locale-${code}.js`), `window.LanternfinTranslations=window.LanternfinTranslations||{};window.LanternfinTranslations[${JSON.stringify(code)}]=${JSON.stringify(values).replace(/</g, '\\u003c')};\n`)
  }
}
