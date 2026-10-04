import { afterAll, beforeAll, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { buildTranslations, validatePortableTranslations } from '../scripts/tv-translations.mjs'

let out = ''
beforeAll(async () => { out = await mkdtemp(join(tmpdir(), 'lanternfin-locales-')); await buildTranslations(process.cwd(), out) })
afterAll(async () => {
  if (!out) return
  if (!resolve(out).startsWith(resolve(tmpdir(), 'lanternfin-locales-'))) throw new Error('Unexpected translation test directory')
  await rm(out, { recursive: true, force: true })
})
it('packages every Settings label and every fork message for all fifteen non-English locales', async () => {
  const english = JSON.parse(await readFile('tv-app/locales/en.json', 'utf8'))
  const dom = new JSDOM(await readFile('tv-app/index.html', 'utf8')), root = dom.window.document.querySelector('#settings')!
  const walker = dom.window.document.createTreeWalker(root, dom.window.NodeFilter.SHOW_TEXT), labels: string[] = []
  while (walker.nextNode()) { const value = walker.currentNode.textContent!.trim(); if (value && !/^\d+(\.\d+)?%$/.test(value)) labels.push(value) }
  const files = await readdir(out); expect(files).toHaveLength(15)
  for (const file of files) {
    const code = file.slice(7, -3), context = { window: {} as { LanternfinTranslations?: Record<string, Record<string, string>> } }
    const script = await readFile(join(out, file), 'utf8'); runInNewContext(script, context)
    const messages = context.window.LanternfinTranslations![code]
    for (const key of [...Object.keys(english), ...labels, 'Automatic', 'Use device language', 'Device time zone', 'App default']) expect(messages[key], `${code}: ${key}`).toBeTypeOf('string')
    expect(messages['Estimated correction: {offset}. Based on programme coverage across {count} channels; check against a known broadcast.']).toContain('{offset}')
    expect(messages['About Lanternfin TV']).toContain('Lanternfin TV')
    expect(script).not.toContain('<')
  }
  dom.window.close()
})
it.each([
  {}, { 'Saved {count}': '' }, { 'Saved {count}': 'Enregistré' },
  { 'Saved {count}': 'Enregistré {other}' }, { 'Saved {count}': '{count} {count}' },
  { 'Saved {count}': '{count' }, { 'Saved {count}': '{count}\0' },
  { 'Saved {count}': '{count}', extra: 'extra' }, { 'Saved {count}': 1 }, [],
])('rejects incomplete or malformed portable translations: %j', invalid => {
  expect(() => validatePortableTranslations({ 'Saved {count}': 'Saved {count}' }, invalid, 'test')).toThrow()
})
it('accepts reordered placeholders and rejects a changed English source', () => {
  const text = '{count} programmes at {offset}'
  expect(() => validatePortableTranslations({ [text]: text }, { [text]: '{offset} · {count} programmes' }, 'fr')).not.toThrow()
  expect(() => validatePortableTranslations({ [text]: 'changed' }, { [text]: text }, 'en')).toThrow()
})
