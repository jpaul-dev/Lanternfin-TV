/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const { create } = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../src/shared/pairing/client', async importOriginal => ({ ...await importOriginal<any>(), TVPairing: { create } }))
import { openPhonePairing } from '../src/shared/pairing/tv-dialog'

let close: (() => void) | undefined
const select = (name: string) => document.querySelector<HTMLElement>(`[data-pair="${name}"]`)!
const account = { version: 1, kind: 'm3u', name: 'Demo', url: 'https://provider.example/list.m3u', username: '', password: '', epgUrl: '' }
function session() {
  return { api: { origin: 'https://pair.example' }, code: 'ABCDEFGH', link: 'https://pair.example/#code=ABCDEFGH&key=public', deadline: Date.now() + 300000,
    poll: vi.fn().mockResolvedValue({ status: 'waiting' }), approve: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined), complete: vi.fn().mockResolvedValue(undefined) }
}
async function flush() { await vi.advanceTimersByTimeAsync(0) }
beforeEach(() => { vi.useFakeTimers(); create.mockReset(); document.body.innerHTML = '<button id="prior">Set up</button>'; document.getElementById('prior')!.focus() })
afterEach(() => { close?.(); close = undefined; vi.useRealTimers() })

it('renders an inline QR under the packaged CSP and traps the remote without activating background controls', async () => {
  const current = session(); create.mockResolvedValue(current)
  close = openPhonePairing({ origin: 'https://pair.example', deviceName: 'TV', onAccount: vi.fn() })
  await flush()
  expect(select('qr').querySelector('svg path')).not.toBeNull()
  expect(select('qr').querySelector('img')).toBeNull()
  expect(select('code').textContent).toBe('ABCD EFGH')
  const background = vi.fn(); window.addEventListener('keydown', background)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
  expect(background).not.toHaveBeenCalled(); expect(document.activeElement).toBe(select('close'))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(current.cancel).toHaveBeenCalledOnce()
  expect(document.activeElement?.id).toBe('prior'); window.removeEventListener('keydown', background)
})

it('requires TV approval and applies the received account exactly once before acknowledgement', async () => {
  const current = session(); current.poll.mockResolvedValue({ status: 'claimed', confirmation: '123456' }); create.mockResolvedValue(current)
  const apply = vi.fn().mockResolvedValue(undefined), success = vi.fn()
  close = openPhonePairing({ origin: 'https://pair.example', deviceName: 'TV', onAccount: apply, onSuccess: success })
  await flush(); expect(select('confirmation').textContent).toBe('123456'); expect(apply).not.toHaveBeenCalled()
  select('approve').click(); await flush()
  current.poll.mockResolvedValue({ status: 'offered', account })
  await vi.advanceTimersByTimeAsync(3000)
  expect(apply).toHaveBeenCalledOnce(); expect(current.complete).toHaveBeenCalledWith('accepted'); expect(success).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(9000); expect(apply).toHaveBeenCalledOnce(); expect(current.cancel).not.toHaveBeenCalled()
})

it('reports a failed TV account check to the phone and allows a fresh attempt', async () => {
  const current = session(); current.poll.mockResolvedValue({ status: 'claimed', confirmation: '123456' }); create.mockResolvedValue(current)
  close = openPhonePairing({ origin: 'https://pair.example', deviceName: 'TV', onAccount: vi.fn().mockRejectedValue(new Error('Provider rejected this account.')) })
  await flush(); select('approve').click(); await flush(); current.poll.mockResolvedValue({ status: 'offered', account })
  await vi.advanceTimersByTimeAsync(3000)
  expect(current.complete).toHaveBeenCalledWith('failed'); expect(select('status').textContent).toContain('Provider rejected')
  expect(select('retry').hidden).toBe(false)
  const next = session(); create.mockResolvedValue(next); select('retry').click(); await flush()
  expect(select('qr').hidden).toBe(false); expect(next.poll).toHaveBeenCalledOnce()
})

it('cancels a session that finishes creation after the dialog was closed', async () => {
  const current = session(); let resolve!: (value: unknown) => void
  create.mockReturnValue(new Promise(done => { resolve = done }))
  close = openPhonePairing({ origin: 'https://pair.example', deviceName: 'TV', onAccount: vi.fn() })
  await flush(); close(); resolve(current); await flush()
  expect(current.cancel).toHaveBeenCalledOnce(); expect(current.poll).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('does not navigate after cancellation while the completion acknowledgement is pending', async () => {
  const current = session(); current.poll.mockResolvedValue({ status: 'claimed', confirmation: '123456' }); create.mockResolvedValue(current)
  let acknowledge!: () => void
  current.complete.mockImplementation(() => new Promise<void>(resolve => { acknowledge = resolve }))
  const success = vi.fn()
  close = openPhonePairing({ origin: 'https://pair.example', deviceName: 'TV', onAccount: vi.fn().mockResolvedValue(undefined), onSuccess: success })
  await flush(); select('approve').click(); await flush(); current.poll.mockResolvedValue({ status: 'offered', account })
  await vi.advanceTimersByTimeAsync(3000); expect(current.complete).toHaveBeenCalled()
  close(); acknowledge(); await flush()
  expect(success).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull()
})
