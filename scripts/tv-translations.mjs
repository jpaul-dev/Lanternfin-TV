import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const locales = ['es', 'de', 'fr', 'pt-BR', 'it', 'ru', 'zh', 'ja', 'tr', 'ar', 'ur', 'nl', 'hi', 'id', 'pl']
/** Packaged scripts avoid file:// fetch restrictions. No translation service is contacted. */
export async function buildTranslations(root, out) {
  const english = JSON.parse(await readFile(resolve(root, 'src/i18n/en.json'), 'utf8'))
  for (const code of locales) {
    const localized = JSON.parse(await readFile(resolve(root, `src/i18n/${code}.json`), 'utf8')), values = Object.create(null)
    for (const [key, text] of Object.entries(english)) {
      const value = localized[key]
      if (typeof text === 'string' && text && typeof value === 'string' && value && !(text in values)) values[text] = value
    }
    await writeFile(resolve(out, `locale-${code}.js`), `window.LanternfinTranslations=window.LanternfinTranslations||{};window.LanternfinTranslations[${JSON.stringify(code)}]=${JSON.stringify(values).replace(/</g, '\\u003c')};\n`)
  }
}
