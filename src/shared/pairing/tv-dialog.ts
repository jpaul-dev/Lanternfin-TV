import qrCode from 'qrcode-generator'
import './tv-dialog.css'
import { PairingAPI, PairingError, TVPairing } from './client'
import { displayCode, type PairingAccount } from './protocol'

let closeActive: (() => void) | undefined
export function openPhonePairing(options: { origin: string; deviceName: string; onAccount: (account: PairingAccount, signal: AbortSignal) => Promise<void>; onSuccess?: () => void }): () => void {
  closeActive?.()
  const previousFocus = document.activeElement as HTMLElement | null, root = document.createElement('div')
  root.className = 'lf-pair-overlay'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Set up with your phone')
  root.innerHTML = `<div class="lf-pair-card"><div class="lf-pair-copy"><p class="lf-pair-eyebrow">A LITTLE HELP FROM YOUR PHONE</p><h2>Set up with your phone</h2><p data-pair="instructions">Scan the QR code with your phone’s camera. You’ll enter your provider details there.</p><div data-pair="manual" hidden><p class="lf-pair-label">Or open this address on your phone</p><p data-pair="address" class="lf-pair-address"></p><p class="lf-pair-label">And enter this TV code</p><p data-pair="code" class="lf-pair-code"></p></div><div data-pair="match" hidden><p class="lf-pair-label">Check that your phone shows these six digits</p><p data-pair="confirmation" class="lf-pair-confirmation"></p><p>If they match, approve your phone. If they don’t, cancel and start again.</p></div><p data-pair="status" class="lf-pair-status" role="status" aria-live="polite">Creating a private pairing session…</p><p data-pair="remaining" class="lf-pair-remaining"></p><div class="lf-pair-actions"><button data-pair="approve" class="lf-pair-primary" hidden>Approve phone</button><button data-pair="retry" hidden>New code</button><button data-pair="close">Cancel</button></div></div><div data-pair="visual" class="lf-pair-visual"><div data-pair="qr" role="img" aria-label="Scan this QR code to set up your TV" hidden></div><p>Same account.<br><strong>Much less typing.</strong></p><span>Your account details are encrypted during transfer.</span></div></div>`
  const el = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector<T>(`[data-pair="${name}"]`)!
  document.body.append(root)
  let controller = new AbortController(), session: TVPairing | undefined, generation = 0, timer: ReturnType<typeof setTimeout> | undefined, closed = false, approved = false, applying = false
  const status = (message: string) => { el('status').textContent = message }
  const setButton = (name: string, disabled: boolean) => { el<HTMLButtonElement>(name).disabled = disabled }

  function close(completed = false) {
    if (closed) return
    closed = true; generation++; clearTimeout(timer)
    const old = session; session = undefined
    // Cancel before aborting the request controller; cancellation remains best
    // effort, with the server expiry as the independent cleanup guarantee.
    if (!completed && old) void old.cancel().catch(() => {})
    controller.abort(); root.remove()
    window.removeEventListener('keydown', keydown, true); window.removeEventListener('pagehide', onPageHide)
    if (closeActive === close) closeActive = undefined
    if (previousFocus?.isConnected) previousFocus.focus()
  }
  function onPageHide() { close() }
  function keydown(event: KeyboardEvent) {
    if (closed) return
    if (['Escape', 'Backspace', 'BrowserBack'].includes(event.key) || [10009, 461].includes(event.keyCode)) { event.preventDefault(); event.stopImmediatePropagation(); close(); return }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter'].includes(event.key)) return
    event.preventDefault(); event.stopImmediatePropagation()
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')].filter(button => !button.hidden && !button.disabled)
    if (!buttons.length) return
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Enter') { if (!event.repeat) (buttons[index] || buttons[0]).click(); return }
    const direction = ['ArrowUp', 'ArrowLeft'].includes(event.key) || event.key === 'Tab' && event.shiftKey ? -1 : 1
    buttons[(index + direction + buttons.length) % buttons.length].focus()
  }
  function fail(error: unknown) {
    if (closed) return
    clearTimeout(timer); el('qr').hidden = el('manual').hidden = el('match').hidden = el('approve').hidden = true
    el('retry').hidden = false; el('remaining').textContent = ''
    status(error instanceof Error ? error.message : 'Phone setup could not continue.')
    el('retry').focus()
  }
  async function poll(token: number) {
    if (closed || token !== generation || !session || applying) return
    try {
      const result = await session.poll()
      if (closed || token !== generation) return
      const seconds = Math.max(0, Math.ceil((session.deadline - Date.now()) / 1000))
      el('remaining').textContent = `Expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
      if (result.status === 'claimed' && !approved) {
        const first = el('match').hidden
        el('manual').hidden = el('qr').hidden = true; el('match').hidden = el('approve').hidden = false
        el('confirmation').textContent = result.confirmation || ''
        el('instructions').textContent = 'Your phone is here. Check the code before sharing your account.'
        status('Approve only if the codes match on both screens.')
        if (first) el('approve').focus()
      } else if (result.status === 'offered' && result.account && approved) {
        applying = true; status('Opening your account on this TV…')
        await options.onAccount(result.account, controller.signal)
        if (closed || token !== generation) return
        await session.complete('accepted').catch(() => {})
        if (closed || token !== generation) return
        close(true); options.onSuccess?.(); return
      }
    } catch (error) {
      if (closed || token !== generation) return
      if (applying) { await session?.complete('failed').catch(() => {}); fail(error); return }
      if (error instanceof PairingError && !error.status) status(error.message + ' Retrying…')
      else { fail(error); return }
    }
    if (!closed && token === generation) timer = setTimeout(() => void poll(token), 3000)
  }
  async function start() {
    const token = ++generation
    clearTimeout(timer)
    const old = session; session = undefined; controller.abort(); controller = new AbortController()
    approved = false; applying = false
    if (old) void old.cancel().catch(() => {})
    if (closed || token !== generation) return
    el('retry').hidden = el('approve').hidden = el('match').hidden = el('manual').hidden = el('qr').hidden = true
    status('Creating a private pairing session…'); el('instructions').textContent = 'Scan the QR code with your phone’s camera. You’ll enter your provider details there.'
    try {
      if (!options.origin) throw new PairingError('Phone setup has not been connected to a pairing service in this build yet. You can still enter your account on the TV.', 503)
      const next = await TVPairing.create(new PairingAPI(options.origin, controller.signal), options.deviceName)
      if (closed || token !== generation) { void next.cancel().catch(() => {}); return }
      session = next
      const qr = qrCode(0, 'M'); qr.addData(next.link); qr.make()
      // Inline vector modules remain sharp and work with the TV's existing CSP.
      // Only library-generated QR geometry is inserted, never user HTML.
      el('qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 24, scalable: true })
      el('qr').hidden = el('manual').hidden = false; el('code').textContent = displayCode(next.code); el('address').textContent = next.api.origin
      status('Waiting for your phone.'); void poll(token)
    } catch (error) { if (token === generation) fail(error) }
  }
  el('approve').onclick = async () => {
    if (!session || closed || approved) return
    const token = generation; setButton('approve', true)
    try {
      await session.approve()
      if (closed || token !== generation) return
      approved = true; el('approve').hidden = true; el('match').hidden = true
      el('instructions').textContent = 'Finish signing in on your phone.'
      status('Choose The codes match on your phone, then enter your account. This TV will save it and open your library.'); el('close').focus()
    } catch (error) { if (token === generation) fail(error) }
    finally { setButton('approve', false) }
  }
  el('retry').onclick = () => void start(); el('close').onclick = () => close()
  window.addEventListener('keydown', keydown, true); window.addEventListener('pagehide', onPageHide)
  el('close').focus(); closeActive = close; void start()
  return close
}
