// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('uses visible provider memberships in search, saved lists, Home and guide without merging duplicate category names', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser'); vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async (address: string) => {
    const url = new URL(address), action = url.searchParams.get('action') || '', category = url.searchParams.get('category_id')
    const data = action.endsWith('_categories') ? action === 'get_series_categories' ? [] : [{ category_id:'1',category_name:'Everything' },{ category_id:'2',category_name:'Sports' },{ category_id:'3',category_name:'Sports' }]
      : ['get_live_streams','get_vod_streams'].includes(action) ? [{ stream_id: category === '3' ? '8' : '7', name: `${action === 'get_live_streams' ? 'Channel' : 'Movie'} ${category === '3' ? 'Eight' : 'Seven'}`, container_extension:'mp4' }]
      : {}
    return new Response(JSON.stringify(data))
  }))
  document.documentElement.innerHTML = readFileSync('tv-app/index.html','utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id) as T
  const click = async(id:string) => { el(id).focus(); el(id).click(); await vi.advanceTimersByTimeAsync(500) }
  const choose = async(selector:string) => { document.querySelector<HTMLElement>(selector)!.click(); await vi.advanceTimersByTimeAsync(500) }
  const change = async(id:string,value:string) => { el<HTMLSelectElement>(id).value=value; el(id).dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(500) }
  await change('source-kind','xtream'); el<HTMLInputElement>('source-url').value='https://provider.test'; el<HTMLInputElement>('username').value=el<HTMLInputElement>('password').value='demo'
  await click('connect'); await click('nav-movie'); await choose('#channels button'); await click('detail-favorite'); await click('detail-back')
  await click('nav-settings'); await click('settings-categories'); await choose('#visibility-list [data-category="1"]'); await choose('#visibility [data-kind="movie"]'); await choose('#visibility-list [data-category="1"]'); await click('visibility-save')
  await click('nav-home'); expect(el('home-rows').textContent).toContain('Movie Seven'); expect(el('home-rows').textContent).not.toContain('Everything')
  await click('nav-search')
  expect([...el<HTMLSelectElement>('group').options].map(option=>option.value)).toEqual(['','live:2','live:3','movie:2','movie:3'])
  expect(new Set([...el<HTMLSelectElement>('group').options].map(option=>option.text)).size).toBe(5)
  await change('group','live:2'); expect(el('channels').textContent).toContain('Channel Seven'); expect(el('channels').textContent).not.toContain('Eight'); expect(el('channels').textContent).not.toContain('Movie'); expect(el('channels').textContent).not.toContain('Everything')
  await change('group','live:3'); expect(el('channels').textContent).toContain('Channel Eight'); expect(el('channels').textContent).not.toContain('Seven')
  await change('group','movie:2'); expect(el('channels').textContent).toContain('Movie Seven')
  await click('view-favorites'); expect(el('channels').textContent).toContain('Movie Seven'); expect(el('channels').textContent).not.toContain('Everything')
  await click('nav-live'); expect(el('schedule-rows').textContent).toContain('Channel Seven'); expect(el('schedule-rows').textContent).toContain('Channel Eight')
  await click('schedule-category'); await choose('#schedule-category-list [data-category="2"]'); expect(el('schedule-rows').textContent).toContain('Channel Seven'); expect(el('schedule-rows').textContent).not.toContain('Channel Eight')
  vi.clearAllTimers()
})
