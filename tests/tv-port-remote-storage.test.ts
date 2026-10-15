// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest'
import { keyAction, nextFocus } from '../tv-app/remote'
import { readSource, storeSource } from '../tv-app/storage'
beforeEach(() => localStorage.clear())
it('recognizes both physical Back keys and transport keys', () => {
  expect(keyAction('', 461)).toBe('back'); expect(keyAction('', 10009)).toBe('back')
  expect(keyAction('MediaPlayPause', 0)).toBe('toggle'); expect(keyAction('', 413)).toBe('stop')
})
it('moves along a grid without jumping diagonally or wrapping across rows', () => {
  const box = (left: number, top: number) => ({ left, top, width: 100, height: 50 })
  const boxes = [box(0, 0), box(120, 0), box(0, 70), box(120, 70)]
  expect(nextFocus(boxes[0], boxes, 'right')).toBe(1)
  expect(nextFocus(boxes[0], boxes, 'down')).toBe(2)
  expect(nextFocus(boxes[0], boxes, 'left')).toBe(-1)
})
it('saves only a validated source, and forget removes the persisted credentials', () => {
  const source = { kind: 'xtream' as const, url: 'https://example.com/', username: 'user', password: 'secret' }
  expect(readSource(localStorage)).toBeNull(); storeSource(localStorage, source); expect(readSource(localStorage)).toEqual(source)
  storeSource(localStorage, null); expect(localStorage.length).toBe(0)
})
it('ignores corrupt, oversized, or unsafe saved sources', () => {
  for (const value of ['invalid JSON', JSON.stringify({ kind: 'direct', url: 'javascript:alert(1)', username: '', password: '' })]) {
    localStorage.setItem('lanternfin.tv.source.v1', value); expect(readSource(localStorage)).toBeNull()
  }
})
