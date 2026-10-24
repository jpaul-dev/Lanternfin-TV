// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { beforeEach, expect, it, vi } from 'vitest'
import { resetUI } from '../tv-app/reset-ui'

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(`reset-${id}`) as T
beforeEach(() => { document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8') })
const check = (id: string) => { el<HTMLInputElement>(id).checked = true; el(id).dispatchEvent(new Event('change')) }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

it('requires explicit confirmation and leaves download removal off when opened or reopened', async () => {
  const run = vi.fn(async () => {}), restart = vi.fn(), flow = resetUI(document.getElementById('reset')!, run, restart)
  flow.open(); expect(el<HTMLButtonElement>('apply').disabled).toBe(true)
  expect(el<HTMLInputElement>('files').checked).toBe(false); expect(el('download-note').textContent).toContain('kept')
  el('apply').click(); expect(run).not.toHaveBeenCalled()
  check('confirm'); check('files'); flow.close(); flow.open()
  expect(el<HTMLInputElement>('confirm').checked).toBe(false); expect(el<HTMLInputElement>('files').checked).toBe(false)
  check('confirm'); el('apply').click(); await flush()
  expect(run).toHaveBeenCalledExactlyOnceWith(false); expect(restart).toHaveBeenCalledOnce()
})

it('locks review choices during reset and makes partial failure explicit without unlocking stale app state', async () => {
  let reject!: (error: Error) => void
  const run = vi.fn(() => new Promise<void>((_, fail) => { reject = fail })), restart = vi.fn(), flow = resetUI(document.getElementById('reset')!, run, restart)
  flow.open(); check('confirm'); check('files'); el('apply').click()
  expect(flow.locked).toBe(true); expect(run).toHaveBeenCalledWith(true)
  for (const id of ['apply', 'confirm', 'files', 'back', 'backup', 'downloads', 'restart']) expect(el<HTMLButtonElement>(id).disabled).toBe(true)
  el('apply').click(); expect(run).toHaveBeenCalledOnce()
  reject(new Error('private provider details')); await flush()
  expect(el('status').textContent).toContain('Some selected data may already'); expect(el('status').textContent).not.toContain('private provider')
  expect(restart).not.toHaveBeenCalled(); expect(el('apply').textContent).toBe('Retry reset'); expect(document.activeElement).toBe(el('apply'))
  expect(el<HTMLButtonElement>('files').disabled).toBe(true); expect(el<HTMLButtonElement>('back').disabled).toBe(true)
  el('restart').click(); expect(restart).toHaveBeenCalledOnce()
})

it('suppresses held OK across focus changes and accepts a fresh press after release', () => {
  const flow = resetUI(document.getElementById('reset')!, vi.fn(async () => {}), vi.fn()); flow.open()
  const press = (id: string, repeat = false) => { const event = new KeyboardEvent('keydown', { key: 'Enter', repeat, bubbles: true, cancelable: true }); el(id).dispatchEvent(event); return event.defaultPrevented }
  expect(press('confirm')).toBe(false); expect(press('apply')).toBe(true)
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  expect(press('apply', true)).toBe(true)
  expect(press('apply')).toBe(false)
})
