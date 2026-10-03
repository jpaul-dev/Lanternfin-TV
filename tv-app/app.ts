import './app.css'
import { loadCatalog, validateSource, type Source, type Channel } from './catalog'
import { readSource, storeSource } from './storage'
import { keyAction, moveFocus, type Direction } from './remote'
import { htmlPlayer, samsungPlayer, type AVPlay, type Player, type State } from './player'

declare const __TV_TARGET__: 'webos' | 'tizen' | 'browser'
declare global {
  interface Window {
    webapis?: { avplay?: AVPlay }
    tizen?: { tvinputdevice?: { registerKey(key: string): void }; application?: { getCurrentApplication(): { exit(): void } } }
  }
}
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const input = (id: string) => $<HTMLInputElement>(id)
const select = (id: string) => $<HTMLSelectElement>(id)
const button = (id: string) => $<HTMLButtonElement>(id)
type Screen = 'setup' | 'catalog' | 'playback' | 'about' | 'exit'
let screen: Screen = 'setup', previousScreen: Screen = 'setup'
let channels: Channel[] = [], filtered: Channel[] = [], page = 0, lastChannel = 0
let state: State = 'idle', player: Player | undefined, loading: AbortController | undefined
let controlsTimer: ReturnType<typeof setTimeout> | undefined
let nativeSelectOpen = false
const PAGE_SIZE = 24
const notice = (message: string) => { $('notice').textContent = message }

function show(next: Screen) {
  screen = next
  for (const id of ['setup', 'catalog', 'playback', 'about', 'exit']) $(id).hidden = id !== next
  $('player-surface').hidden = next !== 'playback'
  document.documentElement.classList.toggle('watching', next === 'playback')
  notice('')
  const focus = $(next).querySelector<HTMLElement>('button:not(:disabled), input, select')
  focus?.focus()
}
function sourceKind() {
  const kind = select('source-kind').value
  $('login-fields').hidden = kind !== 'xtream'
  input('username').required = input('password').required = kind === 'xtream'
  $('url-label').textContent = kind === 'xtream' ? 'Provider server address' : kind === 'direct' ? 'Stream address' : 'Playlist address'
  input('source-url').placeholder = kind === 'xtream' ? 'https://your-provider.example:443' : kind === 'direct' ? 'https://your-provider.example/video.m3u8' : 'https://your-provider.example/playlist.m3u'
}
function currentSource(): Source {
  return validateSource({ kind: select('source-kind').value, url: input('source-url').value, username: input('username').value, password: input('password').value })
}
function setBusy(busy: boolean) {
  for (const id of ['connect', 'source-kind', 'source-url', 'username', 'password', 'remember', 'forget']) ( $(id) as HTMLInputElement).disabled = busy
  $('cancel-load').hidden = !busy
  if (busy) button('cancel-load').focus()
}
function cancelLoad() { loading?.abort(); loading = undefined; setBusy(false) }

$('source-form').addEventListener('submit', async event => {
  event.preventDefault()
  if (loading) return
  let source: Source
  try { source = currentSource() } catch (error) { notice((error as Error).message); return }
  const controller = new AbortController(); loading = controller
  const timeout = setTimeout(() => controller.abort(), 20000)
  setBusy(true); notice('Opening your playlist…')
  try {
    const catalog = await loadCatalog(source, controller.signal)
    if (loading !== controller) return
    channels = catalog.channels; page = 0; input('search').value = ''
    let storageMessage = ''
    try { storeSource(localStorage, input('remember').checked ? source : null); $('forget').hidden = !input('remember').checked }
    catch { storageMessage = ' Your TV could not update saved settings. This session will still work.' }
    // Credentials remain only in the form/session unless saving was explicitly chosen.
    const group = select('group'); group.textContent = ''; group.add(new Option('All groups', ''))
    for (const name of Array.from(new Set(channels.map(channel => channel.group))).sort()) group.add(new Option(name, name))
    filter(); show('catalog')
    notice((catalog.skipped ? `${catalog.skipped} unsupported entries were skipped (DRM, custom headers, or invalid addresses).` : '') + storageMessage)
  } catch (error) { if (loading === controller) notice((error as Error).message) }
  finally { clearTimeout(timeout); if (loading === controller) { loading = undefined; setBusy(false); if (screen === 'setup') button('connect').focus() } }
})
$('cancel-load').onclick = () => { cancelLoad(); notice('Loading cancelled.'); button('connect').focus() }
select('source-kind').onchange = sourceKind
input('remember').onchange = () => {
  if (input('remember').checked) return
  try { storeSource(localStorage, null); $('forget').hidden = true }
  catch { notice('The TV could not remove saved settings. Try clearing app data in TV settings.') }
}
$('forget').onclick = () => {
  try { storeSource(localStorage, null); input('remember').checked = false; $('forget').hidden = true; input('source-url').value = input('username').value = input('password').value = ''; notice('Saved source removed.'); input('source-url').focus() }
  catch { notice('The TV could not remove its saved settings. Try clearing app data in TV settings.') }
}

function filter() {
  const query = input('search').value.trim().toLocaleLowerCase(), group = select('group').value
  filtered = channels.filter(channel => (!group || channel.group === group) && channel.name.toLocaleLowerCase().includes(query))
  page = 0; render()
}
function render() {
  const grid = $('channels'); grid.textContent = ''
  filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach((channel, index) => {
    const item = document.createElement('button'); item.className = 'channel'
    const name = document.createElement('span'); name.textContent = channel.name
    const group = document.createElement('small'); group.textContent = channel.group
    item.append(name, group); item.onclick = () => { lastChannel = index; watch(channel) }; grid.append(item)
  })
  $('result-count').textContent = `${filtered.length.toLocaleString()} ${filtered.length === 1 ? 'stream' : 'streams'}${filtered.length ? '' : ' — try a different search or group'}`
  $('page-label').textContent = `Page ${page + 1} of ${Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}`
  button('previous').disabled = page === 0; button('next').disabled = (page + 1) * PAGE_SIZE >= filtered.length
}
input('search').oninput = filter; select('group').onchange = filter
for (const [id, delta] of [['previous', -1], ['next', 1]] as const) $(id).onclick = () => { page += delta; render(); $('channels').querySelector('button')?.focus() }
$('change-source').onclick = () => show('setup')

function controls() {
  clearTimeout(controlsTimer); $('controls').hidden = false
  if (state === 'playing') controlsTimer = setTimeout(() => { if (screen === 'playback' && state === 'playing') $('controls').hidden = true }, 6500)
}
function report(next: State, detail?: string) {
  state = next
  $('player-status').textContent = detail || ({ loading: 'Opening stream…', playing: 'Playing', paused: 'Paused', buffering: 'Buffering…', ended: 'Stream ended', error: 'Playback unavailable', idle: '' })[next]
  button('toggle').textContent = next === 'paused' ? 'Resume' : 'Pause'
  button('toggle').disabled = !['playing', 'paused', 'buffering'].includes(next)
  button('forward').disabled = button('rewind').disabled = !['playing', 'paused'].includes(next)
  button('hide-controls').disabled = next !== 'playing'
  if (screen === 'playback') { controls(); if (['error', 'ended'].includes(next)) button('stop').focus() }
}
function watch(channel: Channel) {
  if (__TV_TARGET__ === 'tizen' && !window.webapis?.avplay) { notice('Samsung AVPlay is unavailable. Install the signed TV package on a supported Samsung TV.'); return }
  if (!player) {
    const surface = $('player-surface')
    if (__TV_TARGET__ === 'tizen') {
      const object = document.createElement('object'); object.type = 'application/avplayer'; surface.append(object)
      player = samsungPlayer(window.webapis!.avplay!, report)
    } else {
      const video = document.createElement('video'); video.setAttribute('playsinline', ''); surface.append(video)
      player = htmlPlayer(video, report)
    }
  }
  $('playing-title').textContent = channel.name; show('playback'); controls(); player.play(channel.url); button('stop').focus()
}
function stopWatching() {
  clearTimeout(controlsTimer); player?.stop(); show('catalog')
  const items = $('channels').querySelectorAll('button'); (items[lastChannel] || button('change-source')).focus()
}
function toggle() { if (state === 'paused') player?.resume(); else if (state === 'playing' || state === 'buffering') player?.pause() }
$('toggle').onclick = toggle; $('stop').onclick = stopWatching
$('rewind').onclick = () => player?.seek(-10); $('forward').onclick = () => player?.seek(10)
$('hide-controls').onclick = () => { if (state === 'playing') $('controls').hidden = true }
$('player-surface').onclick = () => { controls(); button('stop').focus() }
$('about-open').onclick = () => { previousScreen = screen; show('about') }
$('about-back').onclick = () => show(previousScreen)
$('stay').onclick = () => show('setup')
$('leave').onclick = () => { if (__TV_TARGET__ === 'tizen') window.tizen?.application?.getCurrentApplication().exit(); else if (__TV_TARGET__ === 'webos') window.close(); else { show('setup'); notice('You can close this browser tab.'); } }
function back() {
  if (screen === 'playback') stopWatching()
  else if (screen === 'about') show(previousScreen)
  else if (screen === 'catalog' || screen === 'exit') show('setup')
  else if (loading) { cancelLoad(); notice('Loading cancelled.'); button('connect').focus() }
  else show('exit')
}
document.addEventListener('keydown', event => {
  if (event.isComposing) return
  const active = document.activeElement
  if (active instanceof HTMLInputElement && active.type === 'checkbox' && (event.key === 'Enter' || event.keyCode === 13)) { event.preventDefault(); active.click(); return }
  if (active instanceof HTMLSelectElement && (event.key === 'Enter' || event.keyCode === 13)) { nativeSelectOpen = true; return }
  const action = keyAction(event.key, event.keyCode)
  if (!action) return
  if (active instanceof HTMLSelectElement && nativeSelectOpen) { if (action === 'back') nativeSelectOpen = false; return }
  if (action === 'back') { event.preventDefault(); back(); return }
  if (screen === 'playback') {
    const wasHidden = $('controls').hidden; controls()
    if (action === 'stop') stopWatching()
    else if (action === 'play') player?.resume()
    else if (action === 'pause') player?.pause()
    else if (action === 'toggle') toggle()
    else if (action === 'rewind' || action === 'forward') player?.seek(action === 'rewind' ? -10 : 10)
    else if (wasHidden) button('toggle').disabled ? button('stop').focus() : button('toggle').focus()
    else moveFocus(action as Direction, $('playback'))
    event.preventDefault(); return
  }
  if (!['left', 'right', 'up', 'down'].includes(action)) return
  // Preserve cursor editing and native TV select menus / on-screen keyboards.
  if (active instanceof HTMLInputElement && active.type !== 'checkbox' && ['left', 'right'].includes(action)) return
  event.preventDefault(); moveFocus(action as Direction, $('app'))
})
document.addEventListener('change', () => { nativeSelectOpen = false })
document.addEventListener('focusin', () => { nativeSelectOpen = false })
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelLoad(); if (screen === 'playback') { stopWatching(); notice('Playback stopped while the app was away. Select a stream to continue.'); } }
})
window.addEventListener('pagehide', () => { cancelLoad(); player?.stop() })
for (const key of ['MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop', 'MediaRewind', 'MediaFastForward']) {
  try { window.tizen?.tvinputdevice?.registerKey(key) } catch { /* not every remote has every key */ }
}
$('platform').textContent = (__TV_TARGET__ === 'webos' ? 'LG webOS' : __TV_TARGET__ === 'tizen' ? 'Samsung Tizen' : 'Browser') + ' · preview 0.1'
try {
  const saved = readSource(localStorage)
  if (saved) { select('source-kind').value = saved.kind; input('source-url').value = saved.url; input('username').value = saved.username; input('password').value = saved.password; input('remember').checked = true; $('forget').hidden = false }
} catch { /* session-only mode still works when storage is unavailable */ }
sourceKind(); show('setup')
