// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { libraryRefresh } from '../tv-app/library-refresh'

it('contains remote focus, reports errors as text and consumes held keys across cancellation and publication', () => {
  document.body.innerHTML = '<button id="origin">Refresh</button>'
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  const origin = document.getElementById('origin')!, outside = vi.fn()
  const press = (key: string, repeat = false) => { const event = new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true }); document.activeElement!.dispatchEvent(event); return event }
  const release = (key: string) => document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }))
  const retry = vi.fn(), ui = libraryRefresh({ retry, cancel() { ui.close() } })
  const dialog = document.getElementById('library-refresh') as HTMLDialogElement
  document.addEventListener('keydown', outside)
  try {
    origin.focus(); expect(ui.open()).toBe(true); expect(document.activeElement?.id).toBe('library-refresh-cancel')
    ui.progress('18.4 MB · 120,000 titles'); expect(dialog.textContent).toContain('18.4 MB')
    ui.failed('<img src=x onerror=alert(1)>'); expect(dialog.querySelector('img')).toBeNull()
    expect(document.activeElement?.id).toBe('library-refresh-retry')
    press('Tab'); expect(document.activeElement?.id).toBe('library-refresh-cancel')
    press('ArrowLeft'); expect(document.activeElement?.id).toBe('library-refresh-retry')
    press('Enter'); press('Enter', true); release('Enter'); expect(retry).toHaveBeenCalledOnce()
    ui.open(); ui.applying(); expect(document.activeElement).toBe(dialog)
    press('Escape'); release('Escape'); expect(dialog.open).toBe(true)
    ui.close(); expect(document.activeElement).toBe(origin)
    ui.open(); press('Escape'); press('Escape', true); release('Escape')
    expect(dialog.open).toBe(false); expect(document.activeElement).toBe(origin); expect(outside).not.toHaveBeenCalled()
    HTMLDialogElement.prototype.showModal = () => { throw new Error('Unsupported') }
    expect(ui.open()).toBe(false); expect(document.activeElement).toBe(origin)
  } finally { ui.close(); document.removeEventListener('keydown', outside) }
})
