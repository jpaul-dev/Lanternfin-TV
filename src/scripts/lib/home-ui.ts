import { connectHome, disconnectHome, homeConnection, homeEnabled, homeHosted, homeRequest, homeStatus, homeSync } from './home-client'

export function openHomeSettings(): void {
  if (document.getElementById('lanternfin-home-dialog')) return
  const dialog = document.createElement('dialog')
  dialog.id = 'lanternfin-home-dialog'
  dialog.setAttribute('aria-labelledby', 'lf-home-title')
  dialog.innerHTML = `<style>
  #lanternfin-home-dialog{margin:auto;width:620px;max-width:92vw;max-height:88vh;overflow:auto;background:#13242e;color:#edf8f8;border:1px solid #4c777c;border-radius:24px;padding:32px;font:18px/1.5 system-ui,sans-serif}
  #lanternfin-home-dialog::backdrop{background:#000b}#lanternfin-home-dialog h2{font-size:32px;line-height:1.2;margin:8px 0 16px}#lanternfin-home-dialog p{margin:12px 0;color:#bdd0d6}#lanternfin-home-dialog label{display:block;margin:18px 0 6px;font-size:15px}
  #lanternfin-home-dialog input{width:100%;padding:13px;background:#0c1a22;color:#fff;border:1px solid #7c989d;border-radius:10px;font:inherit}
  #lanternfin-home-dialog button{padding:12px 18px;margin:12px 8px 0 0;border:1px solid #6b9499;border-radius:12px;background:#223c47;color:#fff;font:inherit;cursor:pointer}#lanternfin-home-dialog button[data-connect]{background:#78dfce;color:#112a2b}#lanternfin-home-dialog :focus-visible{outline:3px solid #91f2df;outline-offset:4px}#lanternfin-home-dialog [hidden]{display:none}#lanternfin-home-dialog small{font-size:13px;color:#b5c8cd}#lanternfin-home-dialog [data-device]{font-size:14px}
  </style><small>LANTERNFIN · AT HOME</small><h2 id="lf-home-title">One library. Every screen.</h2>
  <p>Share your saved accounts and movie / episode progress with your household. Each app can still play on its own.</p>
  <div data-form><label for="lf-home-address">Home computer address</label><input id="lf-home-address" value="http://lanternfin.local" autocomplete="off" spellcheck="false"><label for="lf-home-code">Pairing code from start.bat / start.sh</label><input id="lf-home-code" inputmode="numeric" autocomplete="one-time-code" maxlength="12" placeholder="1234 5678"><p><small>Connecting shares this app’s saved Xtream accounts and online M3U playlists with paired household devices. Xtream movie and episode progress syncs across platforms. Local files and downloads stay on this device. Use this HTTP connection on a trusted home network.</small></p><button data-connect>Connect this app</button></div>
  <p data-status role="status"></p><p data-address></p><div data-devices></div>
  <div><button data-sync>Sync now</button><button data-disconnect>Disconnect this device</button><button data-close>Done</button></div>`
  document.body.appendChild(dialog)
  const q = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!
  const previous = document.activeElement as HTMLElement | null
  let busy = false
  function render() {
    q('[data-form]').hidden = homeEnabled()
    q('[data-sync]').hidden = q('[data-disconnect]').hidden = !homeEnabled()
    q('[data-address]').textContent = homeHosted() ? location.origin : homeConnection()?.url || ''
    q('[data-status]').textContent = homeStatus()
  }
  async function devices() {
    if (!homeEnabled()) return
    try {
      const data = await homeRequest('devices'), container = q('[data-devices]')
      container.replaceChildren()
      for (const device of data.devices) {
        const button = document.createElement('button'); button.dataset.device = ''
        button.textContent = `${device.name}${device.id === data.current ? ' (this device)' : ''} · Forget`
        button.onclick = () => void run(async () => { await homeRequest('revoke', { id: device.id }); if (device.id === data.current) { await disconnectHome(); location.reload() } else await devices() })
        container.append(button)
      }
    } catch { /* Sync status explains an unavailable home. */ }
  }
  async function run(action: () => Promise<void>) {
    if (busy) return
    busy = true
    try { await action(); render() } catch (error) { q('[data-status]').textContent = error instanceof Error ? error.message : 'Could not connect.' }
    finally { busy = false }
  }
  q('[data-connect]').onclick = () => void run(async () => { await connectHome(q<HTMLInputElement>('#lf-home-address').value, q<HTMLInputElement>('#lf-home-code').value); location.reload() })
  q('[data-sync]').onclick = () => void run(async () => { await homeSync(); await devices() })
  q('[data-disconnect]').onclick = () => void run(async () => { await disconnectHome(); location.reload() })
  const close = () => { document.removeEventListener('lf:home-changed', render); dialog.close(); dialog.remove(); previous?.focus() }
  q('[data-close]').onclick = close
  dialog.addEventListener('cancel', event => { event.preventDefault(); close() })
  // Predictable linear remote navigation, including on ports without the Android focus manager.
  dialog.addEventListener('keydown', event => {
    event.stopPropagation()
    if (event.key === 'Escape' || [10009, 461].includes(event.keyCode)) { event.preventDefault(); close(); return }
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button,input')).filter(el => !el.closest('[hidden]'))
    const index = focusable.indexOf(document.activeElement as HTMLElement)
    if (index < 0) return
    event.preventDefault(); event.stopPropagation()
    focusable[Math.max(0, Math.min(focusable.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))].focus()
  })
  document.addEventListener('lf:home-changed', render)
  render(); dialog.showModal(); void devices()
  q<HTMLElement>(homeEnabled() ? '[data-sync]' : '#lf-home-address').focus()
}
