// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import * as search from '../tv-app/search'
import * as history from '../tv-app/browse-history'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('keeps the highlighted title across indexed pages, preserves page-number editing, and retains pending query resets', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser'); vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const releases = new Map<string, () => void>()
  vi.stubGlobal('fetch', vi.fn(async (address: string) => {
    const params = new URL(address).searchParams, action = params.get('action'), category = params.get('category_id') || '1'
    const data = action === 'get_vod_categories' ? ['1','2','3','4','5'].map(id => ({ category_id: id, category_name: 'Category ' + id }))
      : action?.endsWith('_categories') ? []
      : action === 'get_vod_streams' ? Array.from({ length: 48 }, (_, i) => ({ stream_id: Number(category) * 100 + i, name: `${['','Zebra','Alpha','Beta','Gamma','Delta'][Number(category)]} ${String(i + 1).padStart(2, '0')}`, container_extension: 'mp4' })) : {}
    if (action === 'get_vod_streams' && category !== '1') await new Promise<void>(done => releases.set(category, done))
    return new Response(JSON.stringify(data))
  }))
  const originalSearch = search.searchCatalog
  const originalResolve = history.resolveBrowseVisit
  let holdAnchor = false, releaseAnchor: (() => void) | undefined
  vi.spyOn(history, 'resolveBrowseVisit').mockImplementation(async (...args) => {
    if (holdAnchor && args[1].focus?.kind === 'title') { holdAnchor = false; await new Promise<void>(done => { releaseAnchor = done }) }
    return originalResolve(...args)
  })
  let delay = false
  const searches: Array<() => void> = []
  vi.spyOn(search, 'searchCatalog').mockImplementation(async (...args) => { if (delay) await new Promise<void>(done => searches.push(done)); return originalSearch(...args) })
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el(id).focus(); el(id).click(); await vi.advanceTimersByTimeAsync(500) }
  const cards = () => [...el('channels').querySelectorAll<HTMLButtonElement>('button')]
  el<HTMLSelectElement>('source-kind').value = 'xtream'; el('source-kind').dispatchEvent(new Event('change'))
  el<HTMLInputElement>('source-url').value = 'https://example.test'; el<HTMLInputElement>('username').value = el<HTMLInputElement>('password').value = 'demo'
  await click('connect'); await click('nav-movie')
  el<HTMLSelectElement>('sort-order').value = 'name-asc'; el('sort-order').dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(500)
  el<HTMLInputElement>('page-jump').value = '2'; await click('page-go'); cards()[1].focus()
  expect(document.activeElement?.textContent).toContain('Zebra 26')
  holdAnchor = true; releases.get('2')!(); await vi.advanceTimersByTimeAsync(500)
  expect(releaseAnchor).toBeTypeOf('function'); cards()[2].focus()
  releaseAnchor!(); await vi.advanceTimersByTimeAsync(500)
  expect(el('page-label').textContent).toBe('Page 4 of 4'); expect(document.activeElement?.textContent).toContain('Zebra 27')
  holdAnchor = true; releaseAnchor = undefined; releases.get('3')!(); await vi.advanceTimersByTimeAsync(500)
  expect(releaseAnchor).toBeTypeOf('function')
  await click('nav-home'); releaseAnchor!(); await vi.advanceTimersByTimeAsync(500); await click('nav-movie')
  expect(el('page-label').textContent).toBe('Page 6 of 6'); expect(document.activeElement?.textContent).toContain('Zebra 27')
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
  el('page-jump').focus(); el<HTMLInputElement>('page-jump').value = '3'
  delay = true; releases.get('4')!(); await vi.advanceTimersByTimeAsync(500)
  expect(document.activeElement?.id).toBe('page-jump'); expect(el<HTMLInputElement>('page-jump').value).toBe('3')
  expect(el<HTMLButtonElement>('page-go').disabled).toBe(false)
  await click('page-go'); expect(el('page-label').textContent).toBe('Page 3 of 6'); expect(document.activeElement?.textContent).toContain('Beta 01')
  el('page-jump').focus(); el<HTMLInputElement>('page-jump').value = '5'
  delay = false; searches.splice(0).forEach(done => done()); await vi.advanceTimersByTimeAsync(500)
  expect(el('page-label').textContent).toBe('Page 3 of 8'); expect(document.activeElement?.id).toBe('page-jump'); expect(el<HTMLInputElement>('page-jump').value).toBe('5')
  delay = true; el('search').focus(); el<HTMLInputElement>('search').value = 'Zebra'; el('search').dispatchEvent(new Event('input')); await vi.advanceTimersByTimeAsync(200)
  expect(searches).toHaveLength(1)
  releases.get('5')!(); await vi.advanceTimersByTimeAsync(500)
  expect(searches.length).toBeGreaterThan(1)
  delay = false; searches.splice(0).forEach(done => done()); await vi.advanceTimersByTimeAsync(500)
  expect(el('page-label').textContent).toBe('Page 1 of 2'); expect(cards()[0].textContent).toContain('Zebra 01'); expect(document.activeElement?.id).toBe('search')
  expect(el('channels').getAttribute('aria-busy')).toBe('false')
  vi.clearAllTimers()
})
