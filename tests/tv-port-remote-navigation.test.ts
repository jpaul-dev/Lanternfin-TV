// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { moveFocus, nextFocus } from '../tv-app/remote'

let root: HTMLElement
const box = (left: number, top: number, width = 100, height = 60) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} })
function rect(el: HTMLElement, left: number, top: number, width = 100, height = 60) {
  el.getBoundingClientRect = () => box(left, top, width, height)
  el.getClientRects = () => [el.getBoundingClientRect()] as unknown as DOMRectList
  return el
}
function control(parent: HTMLElement, id: string, x: number, y: number, width = 100) {
  const el = document.createElement('button'); el.id = id; el.textContent = id; parent.append(el); return rect(el, x, y, width)
}
function rail(id: string, top: number, count = 4, offset = 0) {
  const row = document.createElement('section'); row.className = 'home-row'; row.dataset.row = id
  const strip = document.createElement('div'); strip.className = 'poster-rail'; rect(strip, 150, top, 350, 100); row.append(strip)
  document.getElementById('home-rows')!.append(row)
  const cards = Array.from({ length: count }, (_, i) => control(strip, `${id}-${i}`, 150 + i * 120 - offset, top))
  return { row, strip, cards }
}
beforeEach(() => {
  document.body.innerHTML = '<main id="app"><nav id="tv-nav"></nav><section id="catalog"><div id="home-content"><button id="hero-play">Play</button><div id="home-rows"></div><div class="home-shortcuts"></div></div></section></main>'
  document.documentElement.dir = 'ltr'; root = document.getElementById('app')!
  const nav = document.getElementById('tv-nav')!; rect(nav, 0, 0, 110, 800)
  control(nav, 'nav-home', 0, 20).setAttribute('aria-current', 'page'); control(nav, 'nav-movie', 0, 90); control(nav, 'nav-settings', 0, 160)
  rect(document.getElementById('hero-play')!, 150, 0, 200)
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { vi.restoreAllMocks(); document.documentElement.dir = 'ltr' })
const focused = () => document.activeElement?.id

it('stops Right at the end of a rail instead of jumping to an offscreen card in another row', () => {
  const first = rail('live', 100, 4, 180); rail('movies', 230, 6)
  first.cards[3].focus(); moveFocus('right', root); expect(focused()).toBe('live-3')
})
it('moves to the adjacent row, choosing a visible card and returning to the previous row selection', () => {
  const first = rail('live', 100, 4, 180); const next = rail('movies', 230, 10, 0)
  first.cards[3].focus(); moveFocus('down', root); expect(focused()).toBe('movies-1')
  moveFocus('right', root); expect(focused()).toBe('movies-2')
  moveFocus('up', root); expect(focused()).toBe('live-3')
  moveFocus('down', root); expect(focused()).toBe('movies-2')
  expect(next.cards[2].scrollIntoView).toHaveBeenCalled()
})
it('enters the selected sidebar item at a rail edge and restores the exact card with Right', () => {
  const row = rail('movies', 350)
  row.cards[0].focus(); moveFocus('left', root); expect(focused()).toBe('nav-home')
  moveFocus('down', root); expect(focused()).toBe('nav-movie')
  moveFocus('right', root); expect(focused()).toBe('movies-0')
})
it('does not return to a hidden or replaced content element from the sidebar', () => {
  const row = rail('movies', 350)
  row.cards[0].focus(); moveFocus('left', root); row.row.hidden = true
  moveFocus('right', root); expect(focused()).toBe('hero-play')
})
it('keeps vertical sidebar navigation ordered and clamps its ends', () => {
  document.getElementById('nav-home')!.focus(); moveFocus('up', root); expect(focused()).toBe('nav-home')
  moveFocus('down', root); moveFocus('down', root); moveFocus('down', root); expect(focused()).toBe('nav-settings')
})
it('moves through Settings rows by their full highlighted area and returns from the sidebar', () => {
  document.getElementById('catalog')!.hidden = true
  const settings = document.createElement('section'); settings.id = 'settings'; root.append(settings)
  const list = document.createElement('div'); list.className = 'settings-list'; settings.append(list)
  const first = control(list, 'first-setting', 150, 100, 750); first.className = 'settings-row'
  const label = document.createElement('label'); label.className = 'settings-row'; rect(label, 150, 175, 750); list.append(label)
  const select = document.createElement('select'); select.id = 'setting-value'; label.append(select); rect(select, 650, 175, 250)
  const third = control(list, 'third-setting', 150, 250, 750); third.className = 'settings-row'
  select.focus(); moveFocus('left', root); expect(focused()).toBe('nav-home')
  moveFocus('right', root); expect(focused()).toBe('setting-value')
  moveFocus('down', root); expect(focused()).toBe('third-setting')
  moveFocus('up', root); expect(focused()).toBe('setting-value')
  moveFocus('up', root); expect(focused()).toBe('first-setting')
})
it('keeps horizontal grid movement in its visual row, while vertical movement can enter a shorter row', () => {
  const boxes = [box(150, 100), box(270, 100), box(390, 100), box(150, 200)]
  expect(nextFocus(boxes[2], boxes, 'right')).toBe(-1)
  expect(nextFocus(boxes[2], boxes, 'down')).toBe(3)
  expect(nextFocus(boxes[3], boxes, 'right')).toBe(-1)
})
it('keeps category Up/Down inside its pane even beside a long channel list', () => {
  document.getElementById('home-content')!.hidden = true
  const side = document.createElement('aside'); side.id = 'category-sidebar'; root.querySelector('#catalog')!.append(side)
  const one = control(side, 'cat-one', 150, 100), two = control(side, 'cat-two', 150, 200)
  const channels = document.createElement('div'); channels.id = 'channels'; root.querySelector('#catalog')!.append(channels)
  control(channels, 'channel-one', 300, 100); control(channels, 'channel-two', 300, 350)
  two.focus(); moveFocus('down', root); expect(focused()).toBe('cat-two')
  moveFocus('up', root); expect(document.activeElement).toBe(one)
  moveFocus('right', root); expect(focused()).toBe('channel-one')
})
it('mirrors rail and sidebar edges for RTL without reversing Up/Down', () => {
  document.documentElement.dir = 'rtl'
  const row = rail('movies', 100, 3)
  rect(row.cards[0], 400, 100); rect(row.cards[1], 280, 100); rect(row.cards[2], 160, 100)
  row.cards[0].focus(); moveFocus('left', root); expect(focused()).toBe('movies-1')
  moveFocus('right', root); moveFocus('right', root); expect(focused()).toBe('nav-home')
  moveFocus('left', root); expect(focused()).toBe('movies-0')
})
it('does not allow modal navigation to escape to the main sidebar', () => {
  const dialog = document.createElement('div'); root.append(dialog)
  const button = control(dialog, 'dialog-choice', 150, 100)
  button.focus(); moveFocus('left', dialog); expect(document.activeElement).toBe(button)
})
