export type Direction = 'left' | 'right' | 'up' | 'down'
export type Box = { left: number; top: number; width: number; height: number }
export function atPageEdge(boxes: Box[], index: number, direction: 'up' | 'down'): boolean {
  const current = boxes[index]
  return !!current && !boxes.some(box => direction === 'down' ? box.top > current.top + 4 : box.top < current.top - 4)
}
export function pageEntry(boxes: Box[], x: number, direction: 'up' | 'down'): number {
  if (!boxes.length) return -1
  const row = direction === 'down' ? Math.min(...boxes.map(box => box.top)) : Math.max(...boxes.map(box => box.top))
  let best = 0, distance = Infinity
  boxes.forEach((box, index) => { const dx = Math.abs(box.left + box.width / 2 - x); if (Math.abs(box.top - row) <= 4 && dx < distance) { best = index; distance = dx } })
  return best
}
export function nextFocus(origin: Box, boxes: Box[], direction: Direction): number {
  const x = origin.left + origin.width / 2, y = origin.top + origin.height / 2
  const horizontal = direction === 'left' || direction === 'right'
  let best = -1, score = Infinity, inBeam = false
  boxes.forEach((box, index) => {
    const dx = box.left + box.width / 2 - x, dy = box.top + box.height / 2 - y
    const forward = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy
    const cross = horizontal ? Math.abs(dy) : Math.abs(dx)
    const overlap = horizontal ? Math.min(origin.top + origin.height, box.top + box.height) - Math.max(origin.top, box.top) : Math.min(origin.left + origin.width, box.left + box.width) - Math.max(origin.left, box.left)
    const beam = overlap > 1
    // Left/Right must not wrap diagonally into another visual row. Up/Down can
    // enter a shorter grid row, but aligned controls take precedence.
    if (horizontal && !beam || inBeam && !beam) return
    if (forward <= 1) return
    const value = forward + cross * 3
    if (beam && !inBeam || value < score) { best = index; score = value; inBeam = beam }
  })
  return best
}

type FocusMemory = { returnTo?: HTMLElement; rows: WeakMap<HTMLElement, HTMLElement> }
const memories = new WeakMap<HTMLElement, FocusMemory>()
const focusable = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'
const available = (node: HTMLElement) => !!node.getClientRects().length && !node.closest('[hidden], [inert]') && !node.matches(':disabled, [aria-disabled="true"]')
const focusBox = (node: HTMLElement) => (node.closest('.settings-row') || (node instanceof HTMLInputElement && node.type === 'checkbox' ? node.closest('label') : undefined) || node).getBoundingClientRect()
function focusItem(node?: HTMLElement) {
  if (!node) return
  // Avoid native focus centering followed by a second, competing scroll.
  node.focus({ preventScroll: true }); node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
export function moveFocus(direction: Direction, root: HTMLElement): void {
  if (!['left', 'right', 'up', 'down'].includes(direction)) return
  let items = Array.from(root.querySelectorAll<HTMLElement>(focusable)).filter(available)
  const active = document.activeElement as HTMLElement
  if (!items.includes(active)) { focusItem(items[0]); return }
  let memory = memories.get(root); if (!memory) { memory = { rows: new WeakMap() }; memories.set(root, memory) }
  const vertical = direction === 'up' || direction === 'down', rtl = document.documentElement.dir === 'rtl'
  const towardNav = rtl ? 'right' : 'left', intoContent = rtl ? 'left' : 'right'
  const nav = root.querySelector<HTMLElement>('#tv-nav'), navItems = nav ? items.filter(node => nav.contains(node)) : []
  const enterNav = () => {
    if (!navItems.length) return
    memory!.returnTo = active
    focusItem(navItems.find(node => node.getAttribute('aria-current') === 'page' || node.getAttribute('aria-pressed') === 'true') || navItems[0])
  }
  if (nav?.contains(active)) {
    if (vertical) focusItem(navItems[Math.max(0, Math.min(navItems.length - 1, navItems.indexOf(active) + (direction === 'down' ? 1 : -1)))])
    else if (direction === intoContent) {
      const previous = memory.returnTo
      focusItem(previous && items.includes(previous) && !nav.contains(previous) ? previous : items.find(node => !nav.contains(node)))
    }
    return
  }
  items = items.filter(node => !nav?.contains(node))
  const rail = active.closest<HTMLElement>('.poster-rail'), row = active.closest<HTMLElement>('#home-rows .home-row')
  if (rail) {
    memory.rows.set(rail, active)
    if (!vertical) {
      const cards = items.filter(node => rail.contains(node)), index = cards.indexOf(active), next = index + (direction === intoContent ? 1 : -1)
      if (next >= 0 && next < cards.length) focusItem(cards[next])
      else if (direction === towardNav) enterNav()
      else if (row) focusItem(items.find(node => row.contains(node) && !rail.contains(node)))
      return
    }
  }
  if (row && vertical) {
    const rows = [...root.querySelectorAll<HTMLElement>('#home-rows .home-row')].filter(row => items.some(node => row.contains(node)))
    const adjacent = rows[rows.indexOf(row) + (direction === 'down' ? 1 : -1)]
    if (adjacent) {
      const nextRail = adjacent.querySelector<HTMLElement>('.poster-rail'), previous = nextRail && memory.rows.get(nextRail)
      const candidates = items.filter(node => adjacent.contains(node) && (!nextRail || nextRail.contains(node)))
      if (previous && candidates.includes(previous)) { focusItem(previous); return }
      // Offscreen cards in another horizontal scroller must not win a vertical move.
      const bounds = nextRail?.getBoundingClientRect(), visible = candidates.filter(node => { const box = focusBox(node); return !bounds || box.right > bounds.left + 1 && box.left < bounds.right - 1 })
      const choices = visible.length ? visible : candidates, x = focusBox(active).left + focusBox(active).width / 2
      choices.sort((a, b) => Math.abs(focusBox(a).left + focusBox(a).width / 2 - x) - Math.abs(focusBox(b).left + focusBox(b).width / 2 - x))
      focusItem(choices[0] || items.find(node => adjacent.contains(node))); return
    }
    if (direction === 'up') { focusItem(items.find(node => node.id === 'hero-play')); return }
    focusItem(items.find(node => !!node.closest('.home-shortcuts'))); return
  }
  if (row && !rail && !vertical) {
    if (direction === towardNav) { const card = items.filter(node => row.contains(node) && !!node.closest('.poster-rail')).pop(); if (card) focusItem(card); else enterNav() }
    return
  }
  // These panes have independent vertical scrolling. Leaving them takes Left/Right.
  const pane = vertical && active.closest('#category-sidebar, #guide-panel')
  if (pane) items = items.filter(node => pane.contains(node))
  const next = nextFocus(focusBox(active), items.map(focusBox), direction)
  if (next >= 0) focusItem(items[next])
  else if (direction === towardNav) enterNav()
}

export function keyAction(key: string, code: number): string {
  const actions: Record<number, string> = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 461: 'back', 10009: 'back', 27: 'back', 415: 'play', 19: 'pause', 10252: 'toggle', 413: 'stop', 412: 'rewind', 417: 'forward', 427: 'channel-up', 428: 'channel-down', 457: 'info', 10233: 'next-episode' }
  return actions[code] || ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Escape: 'back', GoBack: 'back', BrowserBack: 'back', MediaPlayPause: 'toggle', MediaStop: 'stop', ChannelUp: 'channel-up', ChannelDown: 'channel-down', PageUp: 'channel-up', PageDown: 'channel-down', Info: 'info', MediaTrackNext: 'next-episode' } as Record<string, string>)[key] || ''
}
