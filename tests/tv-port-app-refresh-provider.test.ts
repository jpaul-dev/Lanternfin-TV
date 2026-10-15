// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('preserves provider category browsing after a failed refresh and reloads it on retry', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser'); vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  HTMLDialogElement.prototype.showModal = function () { this.open = true }; HTMLDialogElement.prototype.close = function () { this.open = false }
  let fail = false, updated = false
  vi.stubGlobal('fetch', vi.fn(async (address: string) => {
    const url = new URL(address), action = url.searchParams.get('action') || ''
    if (fail && action === 'get_live_categories') return new Response('Unavailable', { status: 503 })
    return new Response(JSON.stringify(action.endsWith('_categories') ? [{ category_id:'1', category_name:'Provider movies' }] : action === 'get_vod_streams' ? Array.from({ length:70 }, (_, id) => ({ stream_id:id + 1, name:(updated ? 'Updated ' : '') + 'Movie ' + (id + 1), container_extension:'mp4' })) : []))
  }))
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el(id).focus(); el(id).click(); await vi.advanceTimersByTimeAsync(500) }
  el<HTMLSelectElement>('source-kind').value = 'xtream'; el('source-kind').dispatchEvent(new Event('change'))
  el<HTMLInputElement>('source-url').value = 'https://provider.test'; el<HTMLInputElement>('username').value = el<HTMLInputElement>('password').value = 'demo'
  await click('connect'); await click('nav-movie'); el('category-list').querySelector<HTMLButtonElement>('button')!.click(); await vi.advanceTimersByTimeAsync(500)
  el<HTMLInputElement>('page-jump').value = '2'; await click('page-go'); el('channels').querySelectorAll<HTMLButtonElement>('button')[3].focus()
  const selected = (document.activeElement as HTMLElement).dataset.channel, previous = el('channels').textContent
  fail = true; await click('refresh-catalog')
  expect(el<HTMLDialogElement>('library-refresh').open).toBe(true); expect(el('setup').hidden).toBe(true); expect(el('channels').textContent).toBe(previous)
  fail = false; updated = true; await click('library-refresh-retry')
  expect(el<HTMLDialogElement>('library-refresh').open).toBe(false); expect(el('section-title').textContent).toBe('Provider movies')
  expect(el('category-list').querySelector('button')?.getAttribute('aria-pressed')).toBe('true'); expect(el('page-label').textContent).toBe('Page 2 of 3')
  expect((document.activeElement as HTMLElement).dataset.channel).toBe(selected); expect(document.activeElement?.textContent).toContain('Updated Movie 28')
  vi.clearAllTimers()
})
