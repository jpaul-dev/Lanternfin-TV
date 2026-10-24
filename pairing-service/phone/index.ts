import './phone.css'
import { PairingAPI, PairingError, PhonePairing } from '../../src/shared/pairing/client'
import { CODE_PATTERN, normalizeCode, validateAccount } from '../../src/shared/pairing/protocol'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const input = (id: string) => $<HTMLInputElement>(id)
let controller = new AbortController(), session: PhonePairing | undefined, timer: ReturnType<typeof setTimeout> | undefined, busy = false, generation = 0, phase = 'join'
function status(message: string) { $('status').textContent = message }
function screen(name: string) {
  phase = name
  for (const panel of ['join', 'match', 'account', 'sending', 'done', 'ended']) $(`${panel}-panel`).hidden = panel !== name
  for (const step of ['match', 'account', 'watch']) $(`step-${step}`).removeAttribute('aria-current')
  $(`step-${name === 'account' ? 'account' : ['sending', 'done'].includes(name) ? 'watch' : 'match'}`).setAttribute('aria-current', 'step')
  status('')
  $('remaining').hidden = ['join', 'done', 'ended'].includes(name)
}
function lock(value: boolean) { busy = value; for (const id of ['join', 'send', 'confirm-match']) $<HTMLButtonElement>(id).disabled = value }
function clearAccount() { for (const id of ['name', 'url', 'username', 'password', 'epg']) input(id).value = ''; input('password').type = 'password'; $('show-password').textContent = 'Show' }
function end(title: string, message: string) { generation++; controller.abort(); clearTimeout(timer); clearAccount(); session = undefined; lock(false); screen('ended'); $('ended-title').textContent = title; $('ended-copy').textContent = message }
function reset() { generation++; controller.abort(); controller = new AbortController(); clearTimeout(timer); session = undefined; clearAccount(); lock(false); screen('join'); input('code').value = ''; input('code').focus() }

async function join(code: string, expectedKey = '') {
  if (busy) return
  lock(true); status('Finding your TV…'); const token = generation
  try {
    const joined = await PhonePairing.join(new PairingAPI(location.origin, controller.signal), code, expectedKey)
    if (token !== generation) return
    session = joined
    screen('match'); $('tv-name').textContent = joined.deviceName; $('confirmation').textContent = joined.confirmation
    $('confirm-match').focus(); void poll(token)
  } catch (error) { if (token === generation) status((error as Error).message) }
  finally { if (token === generation) lock(false) }
}
async function poll(token: number) {
  if (!session || token !== generation) return
  if (Date.now() >= session.deadline) { end('Your code expired', 'Get a new code from your TV and try again. Nothing was saved by this page.'); return }
  const seconds = Math.max(0, Math.ceil((session.deadline - Date.now()) / 1000))
  $('remaining').textContent = `Session expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  try {
    const result = await session.status()
    if (token !== generation) return
    if (result === 'accepted') { generation++; controller.abort(); clearAccount(); session = undefined; lock(false); screen('done'); $('done-panel').setAttribute('tabindex', '-1'); $('done-panel').focus(); return }
    if (result === 'rejected') { end('Pairing declined on the TV', 'Start a new code on your TV when you’re ready.'); return }
    if (result === 'failed') { end('Your TV needs a little help', 'The TV could not finish opening the account. Check the message on your TV and correct the provider details there, or start again with a new pairing code.'); return }
  } catch (error) {
    if (token !== generation) return
    if (error instanceof PairingError && [401, 410].includes(error.status)) { end('This session ended', 'Open a new pairing code on your TV to try again.'); return }
    status('Waiting for the TV. Check your connection if this continues.')
  }
  if (token === generation && session) timer = setTimeout(() => void poll(token), 4000)
}
$('join-form').addEventListener('submit', event => { event.preventDefault(); void join(input('code').value) })
$('confirm-match').onclick = async () => {
  if (busy || !session) return
  lock(true); const token = generation
  try {
    await session.confirmCodesMatch()
    if (token !== generation) return
    screen('account'); input('url').focus()
  } catch (error) { if (token === generation) status((error as Error).message) }
  finally { if (token === generation) lock(false) }
}
$('account-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !session || phase !== 'account') return
  lock(true); const token = generation
  try {
    const account = validateAccount({ version: 1, kind: input('kind').value, name: input('name').value, url: input('url').value, username: input('username').value, password: input('password').value, epgUrl: input('epg').value })
    await session.send(account)
    if (token !== generation) return
    clearAccount(); screen('sending')
  } catch (error) { if (token === generation) status((error as Error).message) }
  finally { if (token === generation) lock(false) }
})
$('kind').onchange = () => {
  const xtream = input('kind').value === 'xtream'
  $('credentials').hidden = !xtream
  $('url-label').textContent = xtream ? 'Provider server address' : 'Playlist address'
  $('url-help').textContent = xtream ? 'A complete provider link works here too.' : 'Use the full M3U link supplied by your provider.'
}
$('show-password').onclick = () => { const show = input('password').type === 'password'; input('password').type = show ? 'text' : 'password'; $('show-password').textContent = show ? 'Hide' : 'Show'; $('show-password').setAttribute('aria-label', show ? 'Hide password' : 'Show password') }
$('restart').onclick = reset
window.addEventListener('pagehide', () => { generation++; controller.abort(); clearTimeout(timer); clearAccount(); session = undefined })
window.addEventListener('pageshow', event => { if (event.persisted) reset() })
const fragment = new URLSearchParams(location.hash.slice(1)), code = normalizeCode(fragment.get('code') || ''), key = fragment.get('key') || ''
if (location.hash) history.replaceState(null, '', location.pathname)
if (CODE_PATTERN.test(code)) { input('code').value = code; void join(code, key) }
