// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { localeCode, setInterfaceLanguage, staticTranslations, tr, loadMessages } from '../tv-app/i18n'

afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); await setInterfaceLanguage('en', async () => ({})); delete window.LanternfinTranslations })
it('resolves device/region choices and falls back to English for unknown locales', () => {
  expect(localeCode('auto', 'fr-CA')).toBe('fr'); expect(localeCode('auto', 'pt-PT')).toBe('pt-BR')
  expect(localeCode('PT-br')).toBe('pt-BR'); expect(localeCode('__proto__')).toBe('en')
})
it('translates only captured static text and safely interpolates plain text', async () => {
  document.body.innerHTML = '<main><button><span aria-hidden="true">★</span> Favorites</button><input placeholder="Search"><div id="title"></div><p id="changed">Home</p></main>'
  const translate = staticTranslations(document.querySelector('main')!)
  document.getElementById('title')!.textContent = 'Home'
  document.getElementById('changed')!.textContent = 'Home'
  await setInterfaceLanguage('fr', async () => ({ Favorites: 'Favoris', Home: 'Accueil', Search: 'Rechercher', 'Play {title}': 'Lire {title}' })); translate()
  expect(document.querySelector('button')?.textContent).toBe('★ Favoris'); expect(document.querySelector('span')).not.toBeNull()
  expect(document.getElementById('title')?.textContent).toBe('Home'); expect(document.getElementById('changed')?.textContent).toBe('Home')
  expect(document.querySelector('input')?.placeholder).toBe('Rechercher')
  expect(tr('▶ Play {title}', { title: '<img src=x>' })).toBe('▶ Lire <img src=x>')
  expect(tr('New untranslated message')).toBe('New untranslated message')
  await setInterfaceLanguage('en', async () => ({})); translate(); expect(document.querySelector('button')?.textContent).toBe('★ Favorites')
})
it('ignores a late language response after switching back and exposes RTL direction', async () => {
  let finish!: (value: Record<string, string>) => void
  const pending = setInterfaceLanguage('fr', () => new Promise(resolve => finish = resolve))
  await setInterfaceLanguage('en', async () => ({})); finish({ Home: 'Accueil' }); expect(await pending).toBe(false); expect(tr('Home')).toBe('Home')
  await setInterfaceLanguage('ar', async () => ({ Home: 'الرئيسية' })); expect(document.documentElement.dir).toBe('rtl'); expect(document.documentElement.lang).toBe('ar')
})
it('loads only packaged locale names, bounds waiting and permits retry after failure', async () => {
  vi.useFakeTimers()
  await expect(loadMessages('../remote')).rejects.toThrow('Unsupported')
  const pending = loadMessages('es'), result = expect(pending).rejects.toThrow('could not be loaded')
  expect(document.querySelector('script')?.getAttribute('src')).toBe('locale-es.js')
  await vi.advanceTimersByTimeAsync(5000); await result; expect(document.querySelector('script')).toBeNull()
  const retry = loadMessages('es'); window.LanternfinTranslations = { es: { Home: 'Inicio' } }
  document.querySelector('script')?.dispatchEvent(new Event('load')); expect(await retry).toEqual({ Home: 'Inicio' })
})
