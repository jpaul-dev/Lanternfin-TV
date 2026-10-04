// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { homeRows, cancelHomeRows } from '../tv-app/presentation'
import { TVLibrary } from '../tv-app/library'
import type { Channel } from '../tv-app/catalog'
afterEach(() => { cancelHomeRows(); vi.restoreAllMocks() })
const media = (id: number): Channel => ({ name: `Movie ${id}`, url: `https://example.test/${id}.mp4`, group: 'Movies', mediaKind: 'movie' })
function elements() { document.body.innerHTML = '<button id="outside">Navigation</button><div id="rows"></div>'; return { root: document.getElementById('rows')!, outside: document.getElementById('outside')! } }
it('keeps old cards during an asynchronous refresh and does not steal focus after the user leaves the rail', async () => {
  const { root, outside } = elements(); await homeRows(root, [media(1)], undefined, () => {})
  const old = root.querySelector('button')!; old.focus()
  let now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now += 20)
  const pending = homeRows(root, Array.from({ length: 2000 }, (_, i) => media(i)), undefined, () => {})
  expect(old.isConnected).toBe(true); expect(root.getAttribute('aria-busy')).toBe('true')
  outside.focus(); await pending
  expect(old.isConnected).toBe(false); expect(document.activeElement).toBe(outside); expect(root.getAttribute('aria-busy')).toBe('false')
})
it('preserves the focused row and its scroll when a title appears in multiple rails', async () => {
  const { root } = elements(), channel = media(1)
  const library = new TVLibrary(null, { kind: 'playlist', url: 'https://example.test/list', username: '', password: '' })
  library.toggleFavorite(channel); library.record(channel, 50, 500)
  await homeRows(root, [channel], library, () => {})
  const row = root.querySelector<HTMLElement>('[data-row="Your favorites"]')!, rail = row.querySelector<HTMLElement>('.poster-rail')!
  rail.scrollLeft = 120; row.querySelector('button')!.focus()
  await homeRows(root, [channel, media(2)], library, () => {})
  expect((document.activeElement?.closest('.home-row') as HTMLElement).dataset.row).toBe('Your favorites')
  expect(root.querySelector<HTMLElement>('[data-row="Your favorites"] .poster-rail')!.scrollLeft).toBe(120)
})
it('discards superseded rows and clears loading state without blanking existing content on cancellation', async () => {
  const { root } = elements(); await homeRows(root, [media(1)], undefined, () => {})
  let now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now += 20)
  const old = homeRows(root, Array.from({ length: 2000 }, (_, i) => media(i)), undefined, () => {})
  await homeRows(root, [media(9999)], undefined, () => {}); await old
  expect(root.textContent).toContain('Movie 9999'); expect(root.getAttribute('aria-busy')).toBe('false')
  const canceled = homeRows(root, Array.from({ length: 2000 }, (_, i) => media(i)), undefined, () => {})
  cancelHomeRows(); await canceled
  expect(root.textContent).toContain('Movie 9999'); expect(root.getAttribute('aria-busy')).toBe('false')
})
