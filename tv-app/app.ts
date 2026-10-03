import './app.css'
import { loadCatalog, validateSource, type Source, type Channel } from './catalog'
import { readSource, storeSource } from './storage'
import { keyAction, moveFocus, type Direction } from './remote'
import { type AVPlay, type Player, type State } from './player'
import { tvPlayer } from './adaptive-player'
import { channelCard, homeRows, cancelHomeRows } from './presentation'
import { loadCategories, loadCategory, loadEpisodes, type Category, type MediaKind } from './xtream'
import { searchCatalog } from './search'
import { TVLibrary, durationLabel, forgetLibraries } from './library'
import { channelId } from './library'

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
type Screen = 'setup' | 'catalog' | 'playback' | 'resume' | 'about' | 'exit' | 'settings'
let screen: Screen = 'setup', previousScreen: Screen = 'setup'
let channels: Channel[] = [], filtered: Channel[] = [], page = 0, lastChannel = 0
let state: State = 'idle', player: Player | undefined, loading: AbortController | undefined
let controlsTimer: ReturnType<typeof setTimeout> | undefined
let searching: AbortController | undefined, searchTimer: ReturnType<typeof setTimeout> | undefined
let library: TVLibrary | undefined, activeSource: Source | undefined
let currentChannel: Channel | undefined, pendingChannel: Channel | undefined
let lastTimeline = { position: 0, duration: 0 }, lastSaved = 0
let libraryView: 'all' | 'favorites' | 'recent' = 'all'
let nativeSelectOpen = false
let browseView: 'home' | 'all' | 'search' | MediaKind = 'home'
let providerCategories: Partial<Record<MediaKind, Category[]>> = {}, providerLoading: AbortController | undefined
let seriesParent: { channels: Channel[]; series: Channel } | undefined
let lastFocusedCard: HTMLElement | undefined
const knownLibraryChannels = new Map<string, Channel>()
const PAGE_SIZE = 24
const notice = (message: string) => { $('notice').textContent = message }

function show(next: Screen) {
  if (next !== 'catalog') cancelHomeRows()
  screen = next
  for (const id of ['setup', 'catalog', 'playback', 'resume', 'about', 'exit', 'settings']) $(id).hidden = id !== next
  $('tv-nav').hidden = !activeSource || !['catalog', 'settings'].includes(next)
  document.documentElement.classList.toggle('in-library', !$('tv-nav').hidden)
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
  setBusy(true); notice('Opening your playlist…')
  try {
    const initialCategories = source.kind === 'xtream' ? await loadCategories(source, 'live', controller.signal) : undefined
    const catalog = initialCategories ? { channels: [] as Channel[], skipped: 0 } : await loadCatalog(source, controller.signal, progress => {
      if (loading !== controller) return
      const megabytes = (progress.bytes / 1024 / 1024).toFixed(1)
      notice(`Loading ${megabytes} MB${progress.total ? ` of ${(progress.total / 1024 / 1024).toFixed(1)} MB` : ''} · ${progress.channels.toLocaleString()} streams found. You can cancel at any time.`)
    })
    if (loading !== controller) return
    channels = catalog.channels; page = 0; input('search').value = ''; libraryView = 'all'; browseView = 'home'
    providerCategories = initialCategories ? { live: initialCategories } : {}; seriesParent = undefined
    let storageMessage = ''
    try { storeSource(localStorage, input('remember').checked ? source : null); $('forget').hidden = !input('remember').checked }
    catch { storageMessage = ' Your TV could not update saved settings. This session will still work.' }
    let storage: Storage | null = null
    try { if (input('remember').checked) storage = localStorage } catch { /* Session library. */ }
    if (JSON.stringify(activeSource) !== JSON.stringify(source) || !library) {
      knownLibraryChannels.clear()
      library = new TVLibrary(storage, source)
    } else try { library.setStorage(storage) } catch { storageMessage += ' Library changes could not be saved.' }
    activeSource = source
    $('library-note').textContent = input('remember').checked ? 'Favorites and recent streams are saved on this TV.' : 'Favorites and recent streams last for this session. Enable Remember this source to save them.'
    $('return-catalog').hidden = false
    // Credentials remain only in the form/session unless saving was explicitly chosen.
    updateGroups(); await filter(); goHome()
    notice((catalog.skipped ? `${catalog.skipped} entries with invalid addresses were skipped.` : '') + storageMessage)
  } catch (error) { if (loading === controller) notice((error as Error).message) }
  finally { if (loading === controller) { loading = undefined; setBusy(false); if (screen === 'setup') button('connect').focus() } }
})
$('cancel-load').onclick = () => { cancelLoad(); notice('Loading cancelled.'); button('connect').focus() }
select('source-kind').onchange = sourceKind
input('remember').onchange = () => {
  if (input('remember').checked) return
  try { library?.setStorage(null); storeSource(localStorage, null); forgetLibraries(localStorage); $('forget').hidden = true; $('library-note').textContent = 'Favorites and recent streams last for this session.' }
  catch { notice('The TV could not remove saved settings. Try clearing app data in TV settings.') }
}
$('forget').onclick = () => {
  try { storeSource(localStorage, null); forgetLibraries(localStorage); library = undefined; activeSource = undefined; knownLibraryChannels.clear(); providerCategories = {}; channels = []; filtered = []; $('return-catalog').hidden = true; input('remember').checked = false; $('forget').hidden = true; input('source-url').value = input('username').value = input('password').value = ''; notice('Saved source, favorites, and history removed.'); input('source-url').focus() }
  catch { notice('The TV could not remove its saved settings. Try clearing app data in TV settings.') }
}

async function filter() {
  searching?.abort(); clearTimeout(searchTimer)
  const controller = new AbortController(); searching = controller
  $('result-count').textContent = 'Searching your streams…'
  button('previous').disabled = button('next').disabled = true
  try {
    const include = (channel: Channel) => {
      if (libraryView === 'favorites') return !!library?.isFavorite(channel)
      if (libraryView === 'recent') return !!library?.lastPlayed(channel)
      return !['live', 'movie', 'series'].includes(browseView) || (browseView === 'series' ? ['series', 'episode'].includes(channel.mediaKind || '') : (channel.mediaKind || 'live') === browseView)
    }
    const pool = activeSource?.kind === 'xtream' && libraryView !== 'all' ? libraryPool() : channels
    const matches = await searchCatalog(pool, input('search').value, select('group').value, controller.signal, include)
    if (searching !== controller) return
    if (libraryView === 'recent') matches.sort((a, b) => (library?.lastPlayed(b)?.at || 0) - (library?.lastPlayed(a)?.at || 0))
    filtered = matches; page = 0; render()
  } catch { /* Superseded searches do not replace current results. */ }
  finally { if (searching === controller) searching = undefined }
}
function render() {
  const grid = $('channels'); grid.textContent = ''
  filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach((channel, index) => {
    const item = channelCard(channel, () => { lastChannel = index; lastFocusedCard = item; watch(channel) }, library); grid.append(item)
  })
  $('result-count').textContent = `${filtered.length.toLocaleString()} ${filtered.length === 1 ? 'title' : 'titles'}${filtered.length ? '' : ' — try a different search or category'}${activeSource?.kind === 'xtream' && browseView === 'search' ? ' · Searching the open category' : ''}`
  $('page-label').textContent = `Page ${page + 1} of ${Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}`
  button('previous').disabled = page === 0; button('next').disabled = (page + 1) * PAGE_SIZE >= filtered.length
  for (const view of ['all', 'favorites', 'recent']) button(`view-${view}`).setAttribute('aria-pressed', String(libraryView === view))
  $('clear-history').hidden = libraryView !== 'recent'
}
input('search').oninput = () => { searching?.abort(); searchTimer && clearTimeout(searchTimer); searchTimer = setTimeout(filter, 180) }
select('group').onchange = () => { void filter() }
for (const [id, delta] of [['previous', -1], ['next', 1]] as const) $(id).onclick = () => { page += delta; render(); $('channels').querySelector('button')?.focus() }
$('change-source').onclick = () => { cancelProviderLoad(); show('setup') }
$('return-catalog').onclick = () => { cancelLoad(); show('catalog') }
for (const view of ['all', 'favorites', 'recent'] as const) $(`view-${view}`).onclick = () => { cancelProviderLoad(); libraryView = view; browseView = 'all'; input('search').value = ''; select('group').value = ''; browseLayout(view === 'all' ? 'All streams' : view === 'favorites' ? 'Favorites' : 'Recently watched'); void filter() }
$('clear-history').onclick = () => { try { library?.clearHistory(); void filter(); notice('Recent streams and saved playback positions cleared.') } catch { notice('History changed for this session, but could not be saved on the TV.') } }
$('refresh-catalog').onclick = () => {
  if (!activeSource) return
  select('source-kind').value = activeSource.kind; input('source-url').value = activeSource.url
  input('username').value = activeSource.username; input('password').value = activeSource.password; sourceKind()
  show('setup'); $('source-form').dispatchEvent(new Event('submit', { cancelable: true }))
}

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
  $('retry').hidden = !['error', 'ended'].includes(next)
  if (next === 'playing' && currentChannel) saveProgress()
  if (next === 'ended' && currentChannel) { lastTimeline = { position: 0, duration: 0 }; saveProgress(true) }
  if (screen === 'playback') { controls(); if (['error', 'ended'].includes(next)) button('stop').focus() }
}
function watch(channel: Channel) {
  if (channel.mediaKind === 'series') { void openSeries(channel); return }
  const recent = library?.lastPlayed(channel)
  if (recent?.position) {
    pendingChannel = channel; $('resume-title').textContent = channel.name
    $('resume-description').textContent = `Continue from ${durationLabel(recent.position)} of ${durationLabel(recent.duration)}?`
    show('resume'); return
  }
  startWatching(channel)
}
function startWatching(channel: Channel, position = 0) {
  if (__TV_TARGET__ === 'tizen' && !window.webapis?.avplay) { notice('Samsung AVPlay is unavailable. Install the signed TV package on a supported Samsung TV.'); return }
  if (!player) {
    const surface = $('player-surface')
    const video = document.createElement('video'); video.setAttribute('playsinline', ''); surface.append(video)
    if (__TV_TARGET__ === 'tizen') {
      const object = document.createElement('object'); object.type = 'application/avplayer'; surface.append(object)
      player = tvPlayer(video, report, { api: window.webapis!.avplay!, surface: object })
    } else player = tvPlayer(video, report)
  }
  currentChannel = channel; lastTimeline = { position, duration: library?.lastPlayed(channel)?.duration || 0 }; lastSaved = 0
  $('playing-title').textContent = channel.name; show('playback'); updateFavorite(); controls(); player.play(channel, position); button('stop').focus()
}
function updateFavorite() {
  const favorite = currentChannel && library?.isFavorite(currentChannel)
  button('favorite').textContent = favorite ? '★ Favorited' : '☆ Add favorite'
  button('favorite').setAttribute('aria-pressed', String(!!favorite))
}
function saveProgress(ended = false) {
  if (!currentChannel) return
  const timeline = player?.timeline()
  if (!ended && timeline && Number.isFinite(timeline.position) && timeline.position > 0) lastTimeline = timeline
  try { library?.record(currentChannel, lastTimeline.position, lastTimeline.duration, ended); rememberLibraryChannel(currentChannel); lastSaved = Date.now() }
  catch { $('library-note').textContent = 'TV storage is unavailable. Changes are kept for this session.' }
}
function stopWatching() {
  saveProgress(); currentChannel = undefined
  clearTimeout(controlsTimer); player?.stop(); render(); show('catalog')
  const items = $('channels').querySelectorAll('button'); (items[lastChannel] || button('change-source')).focus()
  if (browseView === 'home') { renderHome(); $('hero-play').focus() }
  else if (lastFocusedCard?.isConnected) lastFocusedCard.focus()
  if (libraryView !== 'all') void filter().then(() => { if (screen === 'catalog') ($('channels').querySelector('button') || button(`view-${libraryView}`)).focus() })
}
function toggle() { if (state === 'paused') player?.resume(); else if (state === 'playing' || state === 'buffering') player?.pause() }
$('toggle').onclick = toggle; $('stop').onclick = stopWatching
$('rewind').onclick = () => player?.seek(-10); $('forward').onclick = () => player?.seek(10)
$('hide-controls').onclick = () => { if (state === 'playing') $('controls').hidden = true }
$('favorite').onclick = () => { if (!currentChannel) return; try { library?.toggleFavorite(currentChannel); rememberLibraryChannel(currentChannel) } catch (error) { $('player-status').textContent = (error as Error).message } updateFavorite(); controls() }
$('retry').onclick = () => { if (currentChannel) startWatching(currentChannel, lastTimeline.position) }
$('resume-continue').onclick = () => { if (pendingChannel) startWatching(pendingChannel, library?.lastPlayed(pendingChannel)?.position || 0); pendingChannel = undefined }
$('resume-start').onclick = () => { if (pendingChannel) startWatching(pendingChannel); pendingChannel = undefined }
$('resume-back').onclick = () => { pendingChannel = undefined; show('catalog') }
setInterval(() => {
  if (screen !== 'playback') return
  const timeline = player?.timeline()
  $('playback-time').textContent = timeline && Number.isFinite(timeline.duration) && timeline.duration > 0 ? `${durationLabel(timeline.position)} / ${durationLabel(timeline.duration)}` : 'Live stream'
  if (['playing', 'paused', 'buffering'].includes(state) && Date.now() - lastSaved > 10000) saveProgress()
}, 1000)
$('player-surface').onclick = () => { controls(); button('stop').focus() }
$('about-open').onclick = () => { previousScreen = screen; show('about') }
$('about-back').onclick = () => show(previousScreen)
$('stay').onclick = () => show('setup')
$('leave').onclick = () => { if (__TV_TARGET__ === 'tizen') window.tizen?.application?.getCurrentApplication().exit(); else if (__TV_TARGET__ === 'webos') window.close(); else { show('setup'); notice('You can close this browser tab.'); } }
function back() {
  if (screen === 'playback') stopWatching()
  else if (screen === 'resume') { pendingChannel = undefined; show('catalog') }
  else if (screen === 'about') show(previousScreen)
  else if (screen === 'settings') goHome()
  else if (screen === 'catalog' && providerLoading) { cancelProviderLoad(); notice('Loading cancelled.') }
  else if (screen === 'catalog' && seriesParent) restoreSeries()
  else if (screen === 'catalog' && browseView !== 'home') goHome()
  else if (screen === 'catalog') show('exit')
  else if (screen === 'exit') activeSource ? goHome() : show('setup')
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
  if (document.hidden) { cancelLoad(); cancelProviderLoad(); if (screen === 'playback') { stopWatching(); notice('Playback stopped while the app was away. Select a stream to continue.'); } }
})
window.addEventListener('pagehide', () => { cancelLoad(); cancelProviderLoad(); saveProgress(); player?.stop() })
window.addEventListener('offline', () => { if (screen === 'playback') { saveProgress(); player?.stop(); report('error', 'The TV is offline. Reconnect to your network, then choose Retry stream.') } })
for (const key of ['MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop', 'MediaRewind', 'MediaFastForward']) {
  try { window.tizen?.tvinputdevice?.registerKey(key) } catch { /* not every remote has every key */ }
}
function updateGroups() {
  const group = select('group'); group.replaceChildren(new Option('All groups', ''))
  const groups = new Set<string>(); for (const channel of channels) groups.add(channel.group)
  for (const name of Array.from(groups).sort()) group.add(new Option(name, name))
}
function cancelProviderLoad() { providerLoading?.abort(); providerLoading = undefined; $('cancel-category').hidden = true }
function browseLayout(title: string) {
  cancelHomeRows()
  $('home-content').hidden = true; $('browse-content').hidden = false
  $('category-list').hidden = true; $('channels').hidden = $('pagination').hidden = false
  $('catalog').querySelector<HTMLElement>('.filters')!.hidden = false
  $('section-title').textContent = title; $('section-kicker').textContent = activeSource?.kind === 'xtream' ? 'YOUR PROVIDER LIBRARY' : 'YOUR LIBRARY'
  $('categories-back').hidden = activeSource?.kind !== 'xtream' || !['live', 'movie', 'series'].includes(browseView)
  $('episodes-back').hidden = !seriesParent
  show('catalog'); syncNav()
}
function syncNav() {
  for (const element of Array.from($('tv-nav').querySelectorAll('button'))) {
    const selected = element.id === `nav-${browseView}` && libraryView === 'all'
    if (selected) element.setAttribute('aria-current', 'page'); else element.removeAttribute('aria-current')
  }
}
function renderHome() {
  void homeRows($('home-rows'), activeSource?.kind === 'xtream' ? libraryPool() : channels, library, channel => { lastFocusedCard = document.activeElement as HTMLElement; watch(channel) })
  const featured = channels.find(channel => channel.logo) || channels[0]
  $('hero-title').textContent = featured?.name || 'Your evening starts here.'
  $('hero-meta').textContent = featured ? `${featured.group} · ${featured.mediaKind === 'movie' ? 'Movie' : featured.mediaKind === 'series' ? 'Series' : 'From your library'}` : 'Live television, movies, and series. All in one place.'
  $('hero-kicker').textContent = featured ? 'FROM YOUR LIBRARY' : 'MAKE YOURSELF AT HOME'
  const art = $<HTMLImageElement>('hero-art'); art.hidden = !featured?.logo
  if (featured?.logo) { art.src = featured.logo; art.referrerPolicy = 'no-referrer'; art.onerror = () => { art.hidden = true } } else art.removeAttribute('src')
  button('hero-play').textContent = featured ? featured.mediaKind === 'series' ? 'View episodes' : '▶ Watch now' : 'Browse Live TV'
  button('hero-play').onclick = () => featured ? watch(featured) : void browse('live')
}
function rememberLibraryChannel(channel: Channel) {
  if (activeSource?.kind !== 'xtream') return
  knownLibraryChannels.set(channelId(channel), channel)
  for (const [id, entry] of knownLibraryChannels) if (!library?.isFavorite(entry) && !library?.lastPlayed(entry)) knownLibraryChannels.delete(id)
}
function libraryPool(): Channel[] {
  if (!knownLibraryChannels.size) return channels
  const result = [...channels], ids = new Set(channels.map(channelId))
  for (const [id, channel] of knownLibraryChannels) if (!ids.has(id)) result.push(channel)
  return result
}
function goHome() {
  cancelProviderLoad(); searching?.abort(); clearTimeout(searchTimer); seriesParent = undefined; browseView = 'home'; libraryView = 'all'
  $('home-content').hidden = false; $('browse-content').hidden = true
  $('section-title').textContent = 'Home'; $('section-kicker').textContent = 'WELCOME BACK'
  renderHome(); show('catalog'); syncNav(); $('hero-play').focus()
}
async function browse(kind: 'search' | MediaKind) {
  cancelProviderLoad(); seriesParent = undefined; browseView = kind; libraryView = 'all'; input('search').value = ''; select('group').value = ''
  const title = { live: 'Live TV', movie: 'Movies', series: 'Series', search: 'Search' }[kind]
  browseLayout(title)
  if (activeSource?.kind !== 'xtream' || kind === 'search') { await filter(); if (kind === 'search') input('search').focus(); return }
  const controller = new AbortController(); providerLoading = controller; $('cancel-category').hidden = false
  $('channels').hidden = $('pagination').hidden = true; $('catalog').querySelector<HTMLElement>('.filters')!.hidden = true
  $('result-count').textContent = 'Loading categories…'
  try {
    const categories = providerCategories[kind] || await loadCategories(activeSource, kind, controller.signal)
    if (providerLoading !== controller) return
    providerCategories[kind] = categories
    const list = $('category-list'); list.replaceChildren(); list.hidden = false; $('categories-back').hidden = true
    for (const category of categories) {
      const item = document.createElement('button'); item.textContent = category.name; item.onclick = () => void openCategory(kind, category); list.append(item)
    }
    $('result-count').textContent = categories.length ? `${categories.length.toLocaleString()} categories · Choose one to browse` : 'Your provider returned no categories in this section.'
    list.querySelector('button')?.focus()
  } catch (error) { if (providerLoading === controller) { $('result-count').textContent = ''; notice((error as Error).message) } }
  finally { if (providerLoading === controller) { providerLoading = undefined; $('cancel-category').hidden = true } }
}
async function openCategory(kind: MediaKind, category: Category) {
  if (!activeSource) return
  cancelProviderLoad(); const controller = new AbortController(); providerLoading = controller
  $('cancel-category').hidden = false; notice('Loading this category…')
  try {
    const result = await loadCategory(activeSource, kind, category, controller.signal)
    if (providerLoading !== controller) return
    channels = result.channels; updateGroups(); browseLayout(category.name); await filter()
    $('channels').querySelector<HTMLElement>('button')?.focus()
    if (result.skipped) notice(`${result.skipped} invalid entries were skipped.`)
  } catch (error) { if (providerLoading === controller) notice((error as Error).message) }
  finally { if (providerLoading === controller) { providerLoading = undefined; $('cancel-category').hidden = true } }
}
async function openSeries(series: Channel) {
  if (!activeSource || activeSource.kind !== 'xtream') return
  cancelProviderLoad(); const controller = new AbortController(); providerLoading = controller
  $('cancel-category').hidden = false; notice('Loading episodes…')
  try {
    const result = await loadEpisodes(activeSource, series, controller.signal)
    if (providerLoading !== controller) return
    seriesParent = { channels, series }; channels = result.channels; browseView = 'series'; updateGroups(); input('search').value = ''
    browseLayout(series.name); await filter(); $('channels').querySelector<HTMLElement>('button')?.focus()
  } catch (error) { if (providerLoading === controller) notice((error as Error).message) }
  finally { if (providerLoading === controller) { providerLoading = undefined; $('cancel-category').hidden = true } }
}
function restoreSeries() {
  if (!seriesParent) return
  cancelProviderLoad(); channels = seriesParent.channels; seriesParent = undefined; updateGroups(); input('search').value = ''; browseView = 'series'
  browseLayout('Series'); void filter()
}
$('nav-home').onclick = goHome
for (const kind of ['live', 'movie', 'series', 'search'] as const) {
  $(`nav-${kind}`).onclick = () => void browse(kind)
  if (kind !== 'search') $(`home-${kind}`).onclick = () => void browse(kind)
}
$('nav-settings').onclick = () => { cancelProviderLoad(); show('settings') }
$('settings-back').onclick = goHome
$('settings-source').onclick = () => show('setup')
$('settings-about').onclick = () => { previousScreen = 'settings'; show('about') }
$('categories-back').onclick = () => { if (['live', 'movie', 'series'].includes(browseView)) void browse(browseView as MediaKind) }
$('episodes-back').onclick = restoreSeries
$('cancel-category').onclick = () => { cancelProviderLoad(); notice('Loading cancelled.') }
$('stay').onclick = () => activeSource ? goHome() : show('setup')
$('platform').textContent = (__TV_TARGET__ === 'webos' ? 'LG webOS' : __TV_TARGET__ === 'tizen' ? 'Samsung Tizen' : 'Browser') + ' · development build'
try {
  const saved = readSource(localStorage)
  if (saved) { select('source-kind').value = saved.kind; input('source-url').value = saved.url; input('username').value = saved.username; input('password').value = saved.password; input('remember').checked = true; $('forget').hidden = false }
} catch { /* session-only mode still works when storage is unavailable */ }
sourceKind(); show('setup')
