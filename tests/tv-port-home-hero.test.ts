// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { homeHero } from '../tv-app/home-hero'
import { channelCard } from '../tv-app/presentation'
import { TVLibrary } from '../tv-app/library'
import type { Channel } from '../tv-app/catalog'
import type { Programme } from '../tv-app/guide'

let hero: ReturnType<typeof homeHero> | undefined
afterEach(() => { hero?.dispose(); hero = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
const movie = (id: number): Channel => ({ name: `Movie ${id}`, url: `https://example.test/${id}.mp4`, group: 'Drama', mediaKind: 'movie', logo: `https://example.test/${id}.jpg` })
function setup() {
  vi.useFakeTimers()
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const state = { active: true, reduced: false }
  const library = new TVLibrary(null, { kind: 'playlist', url: 'https://example.test/list.m3u' })
  const load = vi.fn<(channel: Channel, signal: AbortSignal) => Promise<Programme[]>>().mockResolvedValue([])
  const guide = { load }, activate = vi.fn(), browse = vi.fn()
  hero = homeHero(el('home-content'), { active: () => state.active, reducedMotion: () => state.reduced, library: () => library, guide: () => guide, clock: () => '0', activate, browse })
  function row(title: string, channels: Channel[], versions?: Channel[]) {
    const section = document.createElement('section'); section.className = 'home-row'
    const heading = document.createElement('h2'); heading.textContent = title; section.append(heading)
    const cards = channels.map(channel => channelCard(channel, () => {}, library, versions)); section.append(...cards); el('home-rows').append(section)
    return cards
  }
  return { el, state, library, load, activate, browse, row }
}

it('follows settled focus without moving it and preserves grouped versions and literal metadata', async () => {
  const { el, row, activate } = setup(), one = movie(1), two = { ...movie(2), name: '<b>Title</b>', description: '<script>inert</script>', year: 2026, rating: 8.5 }, versions = [two, movie(3)]
  const cards = row('Featured', [one, two], versions); hero!.refresh()
  expect(el('hero-title').textContent).toBe(one.name)
  cards[1].focus(); await vi.advanceTimersByTimeAsync(79); expect(el('hero-title').textContent).toBe(one.name)
  await vi.advanceTimersByTimeAsync(1)
  expect(el('hero-title').textContent).toBe(two.name); expect(el('hero-title').children).toHaveLength(0)
  expect(el('hero-description').textContent).toBe(two.description); expect(el('hero-description').children).toHaveLength(0)
  expect(el('hero-meta').textContent).toContain('2026 · 8.5 / 10'); expect(document.activeElement).toBe(cards[1])
  el('hero-play').focus(); el('hero-play').click(); expect(activate).toHaveBeenCalledWith(two, versions)
})

it('debounces rapid movement, pauses on rails, and retains the idle countdown across row refreshes', async () => {
  const { el, row } = setup(), [one, two, three] = [movie(1), movie(2), movie(3)]
  const cards = row('Movies', [one, two, three]); row('Favorites', [one]); hero!.refresh()
  cards[1].focus(); await vi.advanceTimersByTimeAsync(40); cards[2].focus(); await vi.advanceTimersByTimeAsync(79)
  expect(el('hero-title').textContent).toBe(one.name); await vi.advanceTimersByTimeAsync(1); expect(el('hero-title').textContent).toBe(three.name)
  await vi.advanceTimersByTimeAsync(30000); expect(el('hero-title').textContent).toBe(three.name)
  el('hero-play').focus(); await vi.advanceTimersByTimeAsync(6000); hero!.refresh(); await vi.advanceTimersByTimeAsync(4000)
  expect(el('hero-title').textContent).toBe(one.name); expect(document.activeElement).toBe(el('hero-play'))
  await vi.advanceTimersByTimeAsync(10000); expect(el('hero-title').textContent).toBe(two.name)
  await vi.advanceTimersByTimeAsync(10000); expect(el('hero-title').textContent).toBe(three.name)
})

it('stops work off Home, under reduced motion and on background, then starts a full idle interval', async () => {
  const { el, row, state } = setup(); row('Movies', [movie(1), movie(2)]); hero!.refresh()
  state.reduced = true; hero!.sync(); await vi.advanceTimersByTimeAsync(20000); expect(el('hero-title').textContent).toBe('Movie 1')
  state.reduced = false; state.active = false; hero!.sync(); expect(vi.getTimerCount()).toBe(0)
  state.active = true; hero!.sync(); await vi.advanceTimersByTimeAsync(9999); expect(el('hero-title').textContent).toBe('Movie 1')
  await vi.advanceTimersByTimeAsync(1); expect(el('hero-title').textContent).toBe('Movie 2')
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange'))
  expect(vi.getTimerCount()).toBe(0); await vi.advanceTimersByTimeAsync(10000); expect(el('hero-title').textContent).toBe('Movie 2')
})

it('uses the original low-memory gate while keeping focus-follow usable', async () => {
  vi.spyOn(navigator, 'hardwareConcurrency', 'get').mockReturnValue(2)
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Android TV')
  const { el, row } = setup(), cards = row('Movies', [movie(1), movie(2)]); hero!.refresh()
  expect(vi.getTimerCount()).toBe(0); cards[1].focus(); await vi.advanceTimersByTimeAsync(80)
  expect(el('hero-title').textContent).toBe('Movie 2')
})

it('cancels stale guide responses on focus/source/lifecycle changes and keeps progress current', async () => {
  const { el, row, load, state } = setup(), live: Channel = { ...movie(10), mediaKind: 'live' }
  let finish!: (items: Programme[]) => void
  load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const cards = row('Live and movies', [live, movie(2)]); hero!.refresh()
  expect(load).toHaveBeenCalledOnce(); const signal = load.mock.calls[0][1]
  cards[1].focus(); await vi.advanceTimersByTimeAsync(80); expect(signal.aborted).toBe(true)
  finish([{ title: 'Wrong programme', description: '', start: Date.now() - 1000, stop: Date.now() + 100000 }]); await vi.advanceTimersByTimeAsync(0)
  expect(el('hero-description').textContent).not.toContain('Wrong programme')
  load.mockResolvedValue([{ title: 'Current show', description: '', start: Date.now() - 30000, stop: Date.now() + 90000 }, { title: 'Next show', description: '', start: Date.now() + 90000, stop: Date.now() + 180000 }])
  cards[0].focus(); await vi.advanceTimersByTimeAsync(80)
  expect(el('hero-description').textContent).toContain('Current show · Next: Next show'); expect(el<HTMLProgressElement>('hero-progress').value).toBeGreaterThan(30000)
  state.active = false; hero!.sync(); expect(vi.getTimerCount()).toBe(0)
  const calls = load.mock.calls.length; await vi.advanceTimersByTimeAsync(120000); expect(load).toHaveBeenCalledTimes(calls)
  hero!.reset(); el('home-rows').replaceChildren(); state.active = true; hero!.refresh()
  expect(el('hero-title').textContent).toBe('Your evening starts here.'); expect(el('hero-art').hasAttribute('src')).toBe(false)
})

it('bounds rotation candidates, retains selected artwork on refresh and uses an actionable empty state', async () => {
  const { el, row, browse } = setup(), cards = row('Many titles', Array.from({ length: 245 }, (_, i) => movie(i)))
  hero!.refresh(); const image = el<HTMLImageElement>('hero-art'), src = image.getAttribute('src')
  image.dispatchEvent(new Event('error')); expect(image.hidden).toBe(true); hero!.refresh(); expect(image.hidden).toBe(true); expect(image.getAttribute('src')).toBe(src)
  cards[239].focus(); await vi.advanceTimersByTimeAsync(80); el('hero-play').focus(); await vi.advanceTimersByTimeAsync(10000)
  expect(el('hero-title').textContent).toBe('Movie 0')
  el('home-rows').replaceChildren(); hero!.refresh(); el('hero-play').click(); expect(browse).toHaveBeenCalledOnce(); expect(el('hero-progress').hidden).toBe(true)
})

it('refreshes resume progress and row labels while retaining the chosen title across replacements', async () => {
  const { el, row, library } = setup(), channel = movie(2)
  row('Movies', [movie(1), channel]); const favorite = row('Favorites', [channel])[0]; hero!.refresh()
  favorite.focus(); await vi.advanceTimersByTimeAsync(80); expect(el('hero-kicker').textContent).toBe('Favorites')
  library.record(channel, 125, 1800); hero!.refresh()
  expect(el('hero-meta').textContent).toContain('Continue from 2:05'); expect(el<HTMLProgressElement>('hero-progress').value).toBe(125)
  el('hero-play').focus(); el('home-rows').replaceChildren(); row('Updated collection', [{ ...channel, name: 'Updated title' }, movie(3)]); hero!.refresh()
  expect(el('hero-title').textContent).toBe('Updated title'); expect(el('hero-kicker').textContent).toBe('Updated collection')
  expect(document.activeElement).toBe(el('hero-play'))
})

it('honors changes to the system reduced-motion setting and detaches listeners when disposed', async () => {
  let listener: (() => void) | undefined
  const query = { matches: true, addEventListener: vi.fn((_event, fn) => { listener = fn }), removeEventListener: vi.fn() }
  vi.stubGlobal('matchMedia', () => query)
  const { el, row } = setup(); row('Movies', [movie(1), movie(2)]); hero!.refresh()
  await vi.advanceTimersByTimeAsync(10000); expect(el('hero-title').textContent).toBe('Movie 1')
  query.matches = false; listener!(); await vi.advanceTimersByTimeAsync(10000); expect(el('hero-title').textContent).toBe('Movie 2')
  hero!.dispose(); expect(query.removeEventListener).toHaveBeenCalledWith('change', listener); expect(vi.getTimerCount()).toBe(0)
})
