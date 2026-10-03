export type Direction = 'left' | 'right' | 'up' | 'down'
export type Box = { left: number; top: number; width: number; height: number }
export function nextFocus(origin: Box, boxes: Box[], direction: Direction): number {
  const x = origin.left + origin.width / 2, y = origin.top + origin.height / 2
  let best = -1, score = Infinity
  boxes.forEach((box, index) => {
    const dx = box.left + box.width / 2 - x, dy = box.top + box.height / 2 - y
    const forward = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy
    const cross = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx)
    if (forward <= 1) return
    const value = forward + cross * 3
    if (value < score) { best = index; score = value }
  })
  return best
}

export function moveFocus(direction: Direction, root: HTMLElement): void {
  const items = Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'))
    .filter(node => node.getClientRects().length && !node.closest('[hidden]'))
    .filter(node => !['up', 'down'].includes(direction) || !!node.closest('#tv-nav') === !!document.activeElement?.closest('#tv-nav'))
  const active = document.activeElement as HTMLElement
  if (!items.includes(active)) { items[0]?.focus(); return }
  const rect = (node: HTMLElement) => (node instanceof HTMLInputElement && node.type === 'checkbox' ? node.closest('label') || node : node).getBoundingClientRect()
  const next = nextFocus(rect(active), items.map(rect), direction)
  if (next >= 0) { items[next].focus(); items[next].scrollIntoView({ block: 'nearest', inline: 'nearest' }) }
}

export function keyAction(key: string, code: number): string {
  const actions: Record<number, string> = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 461: 'back', 10009: 'back', 27: 'back', 415: 'play', 19: 'pause', 10252: 'toggle', 413: 'stop', 412: 'rewind', 417: 'forward', 427: 'channel-up', 428: 'channel-down', 457: 'info', 10233: 'next-episode' }
  return actions[code] || ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Escape: 'back', GoBack: 'back', BrowserBack: 'back', MediaPlayPause: 'toggle', MediaStop: 'stop', ChannelUp: 'channel-up', ChannelDown: 'channel-down', PageUp: 'channel-up', PageDown: 'channel-down', Info: 'info', MediaTrackNext: 'next-episode' } as Record<string, string>)[key] || ''
}
