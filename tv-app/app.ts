import './app.css'
import { loadCatalog, validateSource, type Source, type Channel, type Catalog } from './catalog'
import { readSource, storeSource } from './storage'
import { readProfiles, rememberProfile, removeProfile, forgetProfiles, sourceId, type SourceProfile } from './profiles'
import { keyAction, moveFocus, type Direction } from './remote'
import { type AVPlay, type Player, type State } from './player'
import { tvPlayer } from './adaptive-player'
import { channelCard, cardChannel, homeRows, cancelHomeRows } from './presentation'
import { loadCategories, loadCategory, basicDetails, loadTitleDetails, type TitleDetails, type Category, type MediaKind } from './xtream'
import { searchCatalog } from './search'
import { sortCatalog } from './sort'
import { TVLibrary, durationLabel, forgetLibraries, forgetLibrary } from './library'
import { channelId } from './library'
import { ProviderIndex } from './provider-index'
import { TVGuide, nowNext, timeRange, guideDate, type Programme } from './guide'
import { canReplay, replayChannel } from './catchup'
import { navigationIcons } from './icons'
import { LiveQueue, nextEpisode } from './playback-queue'
import { ACCENTS, LANGUAGES, DEFAULTS, readPreferences, savePreferences, normalizePreferences, applyPreferences, languageMatch } from './preferences'

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
type Screen = 'setup' | 'catalog' | 'playback' | 'resume' | 'about' | 'exit' | 'settings' | 'detail' | 'programme'
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
let detailInfo: TitleDetails | undefined, detailLoading: AbortController | undefined, episodePage = 0
let playbackReturn: 'catalog' | 'detail' | 'programme' = 'catalog'
let providerIndex: ProviderIndex | undefined, indexTimer: ReturnType<typeof setTimeout> | undefined
let browseCategory: Category | undefined, guide: TVGuide | undefined, guideChannel: Channel | undefined
let guideLoading: AbortController | undefined, guideTimer: ReturnType<typeof setTimeout> | undefined, guideItems: Programme[] = []
let preferences = readPreferences(null), preferenceStorage: Storage | null = null, trackPreferencesApplied = false
let lastFocusedCard: HTMLElement | undefined
let editingSource: Source | undefined
const liveQueue = new LiveQueue()
let zapDigits = '', zapTimer: ReturnType<typeof setTimeout> | undefined, playbackGuideLoading: AbortController | undefined
let playbackProgrammes: Programme[] = []
let contextCard: HTMLElement | undefined, contextChannel: Channel | undefined
let heldCard: HTMLElement | undefined, holdTimer: ReturnType<typeof setTimeout> | undefined, holdOpened = false
let nextTimer: ReturnType<typeof setTimeout> | undefined
let hasPlayed = false
let guidePage = 0, selectedProgramme: Programme | undefined, programmeChannel: Channel | undefined, replayLoading: AbortController | undefined
let currentGuideSlot: number | undefined
const knownLibraryChannels = new Map<string, Channel>()
const PAGE_SIZE = 24
const notice = (message: string) => { $('notice').textContent = message }
navigationIcons($('tv-nav'))
try { preferenceStorage = localStorage; preferences = readPreferences(localStorage) } catch { /* Session settings still work. */ }
applyPreferences(preferences)

function show(next: Screen) {
  if (next !== 'programme') { replayLoading?.abort(); replayLoading = undefined }
  $('card-menu').hidden = true
  if (next !== 'catalog') cancelGuide()
  if (next !== 'catalog') cancelHomeRows()
  if (!['detail', 'playback', 'resume'].includes(next)) cancelDetails()
  screen = next
  document.documentElement.dataset.screen = next
  for (const id of ['setup', 'catalog', 'playback', 'resume', 'about', 'exit', 'settings', 'detail', 'programme']) $(id).hidden = id !== next
  $('tv-nav').hidden = !activeSource || !['catalog', 'settings', 'detail'].includes(next)
  document.documentElement.classList.toggle('in-library', !$('tv-nav').hidden)
  $('player-surface').hidden = next !== 'playback'
  document.documentElement.classList.toggle('watching', next === 'playback')
  if (next !== 'playback') $('track-menu').hidden = true
  notice('')
  if (next === 'setup') renderProfiles()
  const focus = [...$(next).querySelectorAll<HTMLElement>('button:not(:disabled), input, select')].find(element => !element.closest('[hidden]'))
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
  for (const id of ['connect', 'source-name', 'source-kind', 'source-url', 'username', 'password', 'remember', 'forget', 'profile-new']) ( $(id) as HTMLInputElement).disabled = busy
  for (const item of $('profile-list').querySelectorAll<HTMLButtonElement>('button')) item.disabled = busy
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
    const catalog: Catalog = initialCategories ? { channels: [] as Channel[], skipped: 0 } : await loadCatalog(source, controller.signal, progress => {
      if (loading !== controller) return
      const megabytes = (progress.bytes / 1024 / 1024).toFixed(1)
      notice(`Loading ${megabytes} MB${progress.total ? ` of ${(progress.total / 1024 / 1024).toFixed(1)} MB` : ''} · ${progress.channels.toLocaleString()} streams found. You can cancel at any time.`)
    })
    if (loading !== controller) return
    channels = catalog.channels; page = 0; input('search').value = ''; libraryView = 'all'; browseView = 'home'
    providerCategories = initialCategories ? { live: initialCategories } : {}; detailInfo = undefined
    let storageMessage = '', persisted = false
    try { if (input('remember').checked) { rememberProfile(localStorage, source, input('source-name').value, editingSource); if (editingSource && sourceId(editingSource) !== sourceId(source)) forgetLibrary(localStorage, editingSource); persisted = true }; if (!input('remember').checked) { removeProfile(localStorage, source); forgetLibrary(localStorage, source); storeSource(localStorage, null) }; editingSource = source; renderProfiles() }
    catch (error) { storageMessage = ` ${error instanceof Error && error.message.startsWith('You can save') ? error.message : 'Your TV could not update saved settings. This session will still work.'}` }
    let storage: Storage | null = null
    try { if (persisted) storage = localStorage } catch { /* Session library. */ }
    if (JSON.stringify(activeSource) !== JSON.stringify(source) || !library) {
      knownLibraryChannels.clear()
      library = new TVLibrary(storage, source)
      for (const channel of library.bookmarkedChannels()) knownLibraryChannels.set(channelId(channel), channel)
    } else try { library.setStorage(storage) } catch { storageMessage += ' Library changes could not be saved.' }
    activeSource = source
    providerIndex?.pause(); clearTimeout(indexTimer); indexTimer = undefined
    providerIndex = source.kind === 'xtream' ? new ProviderIndex(source, initialCategories || []) : undefined
    guide?.clear(); guide = new TVGuide(source, catalog.epgUrl); guideChannel = undefined; browseCategory = undefined
    renderIndexStatus()
    $('library-note').textContent = persisted ? 'Favorites and recent streams are saved on this TV.' : 'Favorites and recent streams last for this session. Enable Remember this source to save them.'
    $('return-catalog').hidden = false
    // Credentials remain only in the form/session unless saving was explicitly chosen.
    updateGroups(); await filter(); goHome()
    startIndex()
    notice((catalog.skipped ? `${catalog.skipped} entries with invalid addresses were skipped.` : '') + storageMessage)
  } catch (error) { if (loading === controller) notice((error as Error).message) }
  finally { if (loading === controller) { loading = undefined; setBusy(false); if (screen === 'setup') button('connect').focus() } }
})
$('cancel-load').onclick = () => { cancelLoad(); notice('Loading cancelled.'); button('connect').focus() }
select('source-kind').onchange = sourceKind
input('remember').onchange = () => {
  if (input('remember').checked) return
  try {
    if (editingSource) { removeProfile(localStorage, editingSource); forgetLibrary(localStorage, editingSource); if (activeSource && sourceId(activeSource) === sourceId(editingSource)) library?.setStorage(null) }
    renderProfiles(); $('library-note').textContent = 'Favorites and recent streams last for this session.'
  }
  catch { notice('The TV could not remove saved settings. Try clearing app data in TV settings.') }
}
$('forget').onclick = () => {
  cancelGuide(); guide?.clear(); guide = undefined; guideChannel = undefined; guideItems = []
  providerIndex?.pause(); providerIndex = undefined; clearTimeout(indexTimer); indexTimer = undefined; cancelDetails(); detailInfo = undefined
  try { forgetProfiles(localStorage); forgetLibraries(localStorage); library = undefined; activeSource = undefined; editingSource = undefined; knownLibraryChannels.clear(); providerCategories = {}; channels = []; filtered = []; $('return-catalog').hidden = true; input('remember').checked = false; input('source-name').value = input('source-url').value = input('username').value = input('password').value = ''; renderProfiles(); notice('Saved sources, favorites, and history removed.'); input('source-url').focus() }
  catch { notice('The TV could not remove its saved settings. Try clearing app data in TV settings.') }
}

async function filter(resetPage = true) {
  searching?.abort(); clearTimeout(searchTimer)
  const controller = new AbortController(); searching = controller
  $('result-count').textContent = 'Searching your streams…'
  button('previous').disabled = button('next').disabled = true
  try {
    const include = (channel: Channel) => {
      const kind = select('media-filter').value
      if (['search', 'all'].includes(browseView) && kind && (kind === 'series' ? !['series', 'episode'].includes(channel.mediaKind || '') : (channel.mediaKind || 'live') !== kind)) return false
      if (input('hide-watched').checked && library?.lastPlayed(channel)?.completed) return false
      if (libraryView === 'favorites') return !!library?.isFavorite(channel)
      if (libraryView === 'recent') return !!library?.lastPlayed(channel)
      return !['live', 'movie', 'series'].includes(browseView) || (browseView === 'series' ? ['series', 'episode'].includes(channel.mediaKind || '') : (channel.mediaKind || 'live') === browseView)
    }
    const pool = activeSource?.kind === 'xtream' && (libraryView !== 'all' || ['search', 'all'].includes(browseView)) ? libraryPool() : channels
    const matches = await sortCatalog(await searchCatalog(pool, input('search').value, select('group').value, controller.signal, include), browseView === 'live' ? 'provider' : select('sort-order').value, controller.signal)
    if (searching !== controller) return
    if (libraryView === 'recent' && select('sort-order').value === 'provider') matches.sort((a, b) => (library?.lastPlayed(b)?.at || 0) - (library?.lastPlayed(a)?.at || 0))
    filtered = matches; page = resetPage ? 0 : Math.min(page, Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1)); render()
  } catch { /* Superseded searches do not replace current results. */ }
  finally { if (searching === controller) searching = undefined }
}
function render() {
  const grid = $('channels'), focused = grid.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.channel : undefined
  grid.textContent = ''
  const live = browseView === 'live' && libraryView === 'all'
  grid.classList.toggle('live-rows', live)
  filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach((channel, index) => {
    const item = channelCard(channel, () => { lastChannel = index; lastFocusedCard = item; watch(channel) }, library)
    if (live) { const number = document.createElement('span'); number.className = 'channel-number'; number.textContent = String(page * PAGE_SIZE + index + 1); item.prepend(number); item.onfocus = () => selectGuide(channel) }
    grid.append(item)
  })
  if (live && (!guideChannel || !filtered.includes(guideChannel))) selectGuide(filtered[page * PAGE_SIZE])
  if (guideChannel) button('guide-favorite').textContent = library?.isFavorite(guideChannel) ? '★ Favorited' : '☆ Favorite'
  $('result-count').textContent = `${filtered.length.toLocaleString()} ${filtered.length === 1 ? 'title' : 'titles'}${filtered.length ? '' : ' — try a different search or category'}${providerIndex && browseView === 'search' ? providerIndex.progress.complete ? ' · Entire library' : ' · Loaded titles; library is incomplete' : ''}`
  $('page-label').textContent = `Page ${page + 1} of ${Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}`
  button('previous').disabled = page === 0; button('next').disabled = (page + 1) * PAGE_SIZE >= filtered.length
  for (const view of ['all', 'favorites', 'recent']) button(`view-${view}`).setAttribute('aria-pressed', String(libraryView === view))
  $('clear-history').hidden = libraryView !== 'recent'
  if (focused) grid.querySelector<HTMLElement>(`[data-channel="${focused}"]`)?.focus({ preventScroll: true })
}
input('search').oninput = () => { searching?.abort(); searchTimer && clearTimeout(searchTimer); searchTimer = setTimeout(filter, 180) }
select('group').onchange = () => { void filter() }
for (const id of ['media-filter', 'sort-order', 'hide-watched']) $(id).onchange = () => { void filter() }
for (const [id, delta] of [['previous', -1], ['next', 1]] as const) $(id).onclick = () => { page += delta; render(); $('channels').querySelector('button')?.focus() }
$('change-source').onclick = () => { cancelProviderLoad(); show('setup') }
$('return-catalog').onclick = () => { cancelLoad(); show('catalog') }
for (const view of ['all', 'favorites', 'recent'] as const) $(`view-${view}`).onclick = () => { cancelProviderLoad(); libraryView = view; browseView = 'all'; input('search').value = ''; select('group').value = ''; browseLayout(view === 'all' ? 'All streams' : view === 'favorites' ? 'Favorites' : 'Recently watched'); void filter() }
$('clear-history').onclick = () => { try { library?.clearHistory(); void filter(); notice('Recent streams and saved playback positions cleared.') } catch { notice('History changed for this session, but could not be saved on the TV.') } }
$('refresh-catalog').onclick = () => {
  if (!activeSource) return
  let profile: SourceProfile | undefined
  try { profile = readProfiles(localStorage).find(item => item.id === sourceId(activeSource!)) } catch { /* Session-only refresh. */ }
  editingSource = activeSource; input('source-name').value = profile?.name || ''; input('remember').checked = !!profile
  select('source-kind').value = activeSource.kind; input('source-url').value = activeSource.url
  input('username').value = activeSource.username; input('password').value = activeSource.password; sourceKind()
  show('setup'); $('source-form').dispatchEvent(new Event('submit', { cancelable: true }))
}

function controls() {
  clearTimeout(controlsTimer); $('controls').hidden = false
  if (state === 'playing' && $('track-menu').hidden) controlsTimer = setTimeout(() => { if (screen === 'playback' && state === 'playing') $('controls').hidden = true }, 6500)
}
function report(next: State, detail?: string) {
  state = next
  $('player-status').textContent = detail || ({ loading: 'Opening stream…', playing: 'Playing', paused: 'Paused', buffering: 'Buffering…', ended: 'Stream ended', error: 'Playback unavailable', idle: '' })[next]
  button('toggle').textContent = next === 'paused' ? 'Resume' : 'Pause'
  button('toggle').disabled = !['playing', 'paused', 'buffering'].includes(next)
  button('forward').disabled = button('rewind').disabled = !['playing', 'paused'].includes(next)
  button('hide-controls').disabled = next !== 'playing'
  button('tracks-open').disabled = !['playing', 'paused'].includes(next)
  if (['error', 'ended', 'idle'].includes(next)) $('track-menu').hidden = true
  $('retry').hidden = !['error', 'ended'].includes(next)
  if (next === 'playing' && currentChannel) {
    hasPlayed = true
    saveProgress()
    if (!trackPreferencesApplied) { trackPreferencesApplied = true; applyTrackPreferences() }
  }
  if (next === 'ended' && currentChannel) { lastTimeline = { position: 0, duration: 0 }; saveProgress(true) }
  if (next === 'ended' && preferences.autoNext && nextEpisode(detailInfo?.episodes, currentChannel)) scheduleNextEpisode()
  else if (['error', 'idle'].includes(next)) cancelNextEpisode()
  if (screen === 'playback') { controls(); if (['error', 'ended'].includes(next)) button('stop').focus() }
}
function watch(channel: Channel) {
  if (channel.mediaKind === 'series' || channel.mediaKind === 'movie') { void openTitle(channel); return }
  playChannel(channel)
}

function fillProfile(profile: SourceProfile) {
  editingSource = profile.source
  select('source-kind').value = profile.source.kind; input('source-name').value = profile.name; input('source-url').value = profile.source.url
  input('username').value = profile.source.username; input('password').value = profile.source.password; input('remember').checked = true; sourceKind()
}
function renderProfiles() {
  let profiles: SourceProfile[] = []
  try { profiles = readProfiles(localStorage) } catch { /* Source entry remains usable without storage. */ }
  $('saved-sources').hidden = $('forget').hidden = !profiles.length
  const list = $('profile-list'); list.replaceChildren()
  for (const profile of profiles) {
    const row = document.createElement('div'); row.className = 'source-profile'
    const open = document.createElement('button'); open.className = 'profile-open'; open.textContent = profile.name
    const info = document.createElement('small'); info.textContent = `${profile.source.kind === 'xtream' ? 'Xtream' : profile.source.kind === 'playlist' ? 'M3U' : 'Stream'}${activeSource && sourceId(activeSource) === profile.id ? ' · Active' : ''}`; open.append(info)
    open.onclick = () => { fillProfile(profile); $('source-form').dispatchEvent(new Event('submit', { cancelable: true })) }
    const edit = document.createElement('button'); edit.textContent = 'Edit'; edit.setAttribute('aria-label', `Edit ${profile.name}`); edit.onclick = () => { fillProfile(profile); input('source-name').focus() }
    const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove ${profile.name}`)
    remove.onclick = () => {
      try { removeProfile(localStorage, profile.source); forgetLibrary(localStorage, profile.source); if (activeSource && sourceId(activeSource) === profile.id) library?.setStorage(null); if (editingSource && sourceId(editingSource) === profile.id) input('remember').checked = false; renderProfiles(); $('saved-sources').hidden ? input('source-name').focus() : button('profile-new').focus(); notice('Source removed from TV storage. An already open source stays available for this session.') }
      catch { notice('The TV could not remove this source. Try again or clear app data in TV settings.') }
    }
    row.append(open, edit, remove); list.append(row)
  }
}
$('profile-new').onclick = () => { editingSource = undefined; input('source-name').value = input('source-url').value = input('username').value = input('password').value = ''; input('remember').checked = false; select('source-kind').value = 'playlist'; sourceKind(); input('source-name').focus() }
function playChannel(channel: Channel) {
  playbackReturn = screen === 'detail' ? 'detail' : 'catalog'
  const recent = library?.lastPlayed(channel)
  if (recent?.position) {
    pendingChannel = channel; $('resume-title').textContent = channel.name
    $('resume-description').textContent = `Continue from ${durationLabel(recent.position)} of ${durationLabel(recent.duration)}?`
    show('resume'); return
  }
  startWatching(channel)
}
function startWatching(channel: Channel, position = 0) {
  cancelNextEpisode()
  if (__TV_TARGET__ === 'tizen' && !window.webapis?.avplay) { notice('Samsung AVPlay is unavailable. Install the signed TV package on a supported Samsung TV.'); return }
  if (!player) {
    const surface = $('player-surface')
    const video = document.createElement('video'); video.setAttribute('playsinline', ''); surface.append(video)
    if (__TV_TARGET__ === 'tizen') {
      const object = document.createElement('object'); object.type = 'application/avplayer'; surface.append(object)
      player = tvPlayer(video, report, { api: window.webapis!.avplay!, surface: object })
    } else player = tvPlayer(video, report)
  }
  if (screen !== 'playback' && channel.mediaKind === 'live') liveQueue.reset(browseView === 'live' && filtered.some(item => channelId(item) === channelId(channel)) ? filtered : libraryPool(), channel)
  cancelZap(); playbackGuideLoading?.abort(); playbackProgrammes = []
  currentChannel = channel; lastTimeline = { position, duration: library?.lastPlayed(channel)?.duration || 0 }; lastSaved = 0; trackPreferencesApplied = false; hasPlayed = false
  if (channel.mediaKind === 'episode' && detailInfo?.channel.mediaKind === 'series') { select('detail-season').value = channel.group; try { library?.setSeason(detailInfo.channel, channel.group) } catch { /* Session season remains selected. */ } }
  $('playing-title').textContent = channel.name; show('playback'); updateFavorite(); updatePlaybackContext(); controls(); player.play(channel, position); button('stop').focus()
  void loadPlaybackGuide()
}
function updatePlaybackContext() {
  const live = currentChannel?.mediaKind === 'live'
  $('playback-kind').textContent = live ? `LIVE TV · CHANNEL ${liveQueue.number}` : 'NOW WATCHING'
  button('stop').textContent = playbackReturn === 'detail' ? 'Back to details' : playbackReturn === 'programme' ? 'Back to programme' : 'Back to streams'
  $('channel-previous').hidden = $('channel-next').hidden = !live || liveQueue.length < 2
  $('rewind').hidden = $('forward').hidden = !!live
  const next = nextEpisode(detailInfo?.episodes, currentChannel)
  $('play-next').hidden = !next
  button('play-next').textContent = next ? `Next: ${next.name}` : 'Next episode'
  renderPlaybackGuide()
}
function cancelZap() { clearTimeout(zapTimer); zapDigits = ''; $('zap-number').hidden = true }
function tuneChannel(channel?: Channel) {
  if (!channel || screen !== 'playback') return
  saveProgress(); startWatching(channel)
}
function commitZap() {
  const digits = zapDigits, channel = liveQueue.tune(digits); cancelZap()
  if (channel) tuneChannel(channel)
  else { $('zap-number').textContent = `Channel ${digits} is not in this list`; $('zap-number').hidden = false; zapTimer = setTimeout(cancelZap, 2000) }
}
function stepChannel(delta: number) { if (currentChannel?.mediaKind === 'live') tuneChannel(liveQueue.step(delta)) }
function playNextEpisode() { const next = nextEpisode(detailInfo?.episodes, currentChannel); if (next) tuneChannel(next) }
function cancelNextEpisode() { clearTimeout(nextTimer); nextTimer = undefined; $('cancel-next').hidden = true }
function scheduleNextEpisode() {
  cancelNextEpisode(); const expected = currentChannel, deadline = Date.now() + 10000
  $('cancel-next').hidden = false
  const tick = () => {
    if (screen !== 'playback' || currentChannel !== expected || state !== 'ended') { cancelNextEpisode(); return }
    const seconds = Math.ceil((deadline - Date.now()) / 1000)
    if (seconds <= 0) { cancelNextEpisode(); playNextEpisode(); return }
    $('player-status').textContent = `Next episode starts in ${seconds} seconds`; nextTimer = setTimeout(tick, 1000)
  }
  tick()
}
$('cancel-next').onclick = () => { cancelNextEpisode(); $('player-status').textContent = 'Stream ended. Select Next episode when you are ready.'; button('play-next').focus() }
async function loadPlaybackGuide() {
  playbackGuideLoading?.abort()
  const channel = currentChannel
  if (channel?.mediaKind !== 'live' || !guide) return
  const controller = new AbortController(); playbackGuideLoading = controller
  try { const items = await guide.load(channel, controller.signal); if (playbackGuideLoading === controller && currentChannel === channel) { playbackProgrammes = items; renderPlaybackGuide() } }
  catch { /* Programme data is optional and never replaces a playback error. */ }
  finally { if (playbackGuideLoading === controller) playbackGuideLoading = undefined }
}
function renderPlaybackGuide() {
  const slot = nowNext(playbackProgrammes)
  $('playback-guide').hidden = !slot.current && !slot.next
  $('playing-programme').textContent = slot.current ? `${slot.current.title} · ${timeRange(slot.current, preferences.guideClock)}` : ''
  $('playing-next').textContent = slot.next ? `Up next: ${slot.next.title} · ${timeRange(slot.next, preferences.guideClock)}` : ''
  const progress = $<HTMLProgressElement>('playing-programme-progress'); progress.hidden = !slot.current
  if (slot.current) { progress.max = slot.current.stop - slot.current.start; progress.value = Math.max(0, Date.now() - slot.current.start) }
}
$('channel-previous').onclick = () => stepChannel(-1); $('channel-next').onclick = () => stepChannel(1); $('play-next').onclick = playNextEpisode
setInterval(() => { if (screen === 'playback' && currentChannel?.mediaKind === 'live') { renderPlaybackGuide(); void loadPlaybackGuide() } }, 60000)
function updateFavorite() {
  const favorite = currentChannel && library?.isFavorite(currentChannel)
  button('favorite').textContent = favorite ? '★ Favorited' : '☆ Add favorite'
  button('favorite').setAttribute('aria-pressed', String(!!favorite))
}
function saveProgress(ended = false) {
  if (!currentChannel || !hasPlayed) return
  const timeline = player?.timeline()
  if (!ended && timeline && Number.isFinite(timeline.position) && timeline.position > 0) lastTimeline = timeline
  try { library?.record(currentChannel, lastTimeline.position, lastTimeline.duration, ended || state === 'ended'); rememberLibraryChannel(currentChannel); lastSaved = Date.now() }
  catch { $('library-note').textContent = 'TV storage is unavailable. Changes are kept for this session.' }
}
function stopWatching() {
  cancelNextEpisode()
  cancelZap(); playbackGuideLoading?.abort(); playbackGuideLoading = undefined
  saveProgress(); currentChannel = undefined
  clearTimeout(controlsTimer); player?.stop()
  if (playbackReturn === 'programme' && selectedProgramme) { show('programme'); button('programme-back').focus(); return }
  if (playbackReturn === 'detail' && detailInfo) { renderDetails(); show('detail'); button('detail-play').focus(); return }
  render(); show('catalog')
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
$('resume-back').onclick = () => { pendingChannel = undefined; show(playbackReturn) }
setInterval(() => {
  if (screen !== 'playback') return
  const timeline = player?.timeline()
  $('playback-time').textContent = timeline && Number.isFinite(timeline.duration) && timeline.duration > 0 ? `${durationLabel(timeline.position)} / ${durationLabel(timeline.duration)}` : currentChannel?.mediaKind === 'live' ? 'Live stream' : state === 'ended' ? 'Finished' : ''
  if (['playing', 'paused', 'buffering'].includes(state) && Date.now() - lastSaved > 10000) saveProgress()
}, 1000)
$('player-surface').onclick = () => { controls(); if (!$('track-menu').hidden) button('tracks-close').focus(); else button('stop').focus() }
$('about-open').onclick = () => { previousScreen = screen; show('about') }
$('about-back').onclick = () => show(previousScreen)
$('stay').onclick = () => show('setup')
$('leave').onclick = () => { if (__TV_TARGET__ === 'tizen') window.tizen?.application?.getCurrentApplication().exit(); else if (__TV_TARGET__ === 'webos') window.close(); else { show('setup'); notice('You can close this browser tab.'); } }
function back() {
  if (!$('card-menu').hidden) closeCardMenu()
  else if (screen === 'playback' && !$('track-menu').hidden) closeTracks()
  else if (screen === 'playback') stopWatching()
  else if (screen === 'resume') { pendingChannel = undefined; show(playbackReturn) }
  else if (screen === 'detail') returnFromDetails()
  else if (screen === 'programme') returnFromProgramme()
  else if (screen === 'about') show(previousScreen)
  else if (screen === 'settings') goHome()
  else if (screen === 'catalog' && providerLoading) { cancelProviderLoad(); notice('Loading cancelled.') }
  else if (screen === 'catalog' && browseView !== 'home') goHome()
  else if (screen === 'catalog') show('exit')
  else if (screen === 'exit') activeSource ? goHome() : show('setup')
  else if (loading) { cancelLoad(); notice('Loading cancelled.'); button('connect').focus() }
  else show('exit')
}
document.addEventListener('keydown', event => {
  if (event.isComposing) return
  const active = document.activeElement
  if (!$('card-menu').hidden) {
    if (holdOpened && (event.key === 'Enter' || event.keyCode === 13)) { event.preventDefault(); return }
    const action = keyAction(event.key, event.keyCode)
    if (action === 'back') { event.preventDefault(); closeCardMenu() }
    else if (['left', 'right', 'up', 'down'].includes(action)) { event.preventDefault(); moveFocus(action as Direction, $('card-menu')) }
    else if (event.key === 'Tab') { const items = [...$('card-menu').querySelectorAll<HTMLElement>('button:not([hidden])')]; event.preventDefault(); items[(items.indexOf(active as HTMLElement) + (event.shiftKey ? -1 : 1) + items.length) % items.length]?.focus() }
    return
  }
  if (['catalog', 'detail'].includes(screen) && active instanceof HTMLElement && cardChannel(active)) {
    if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10' || keyAction(event.key, event.keyCode) === 'info') { event.preventDefault(); openCardMenu(active); return }
    if (event.key === 'Enter' || event.keyCode === 13) {
      event.preventDefault()
      if (!event.repeat && !heldCard) { heldCard = active; holdOpened = false; holdTimer = setTimeout(() => { if (heldCard === document.activeElement) { holdOpened = true; openCardMenu(heldCard) } }, 600) }
      return
    }
  }
  if (screen === 'playback' && currentChannel?.mediaKind === 'live' && $('track-menu').hidden) {
    const digit = /^\d$/.test(event.key) ? event.key : event.keyCode >= 48 && event.keyCode <= 57 ? String(event.keyCode - 48) : ''
    if (digit && !event.ctrlKey && !event.altKey && !event.metaKey) { event.preventDefault(); zapDigits = (zapDigits + digit).slice(-6); clearTimeout(zapTimer); $('zap-number').textContent = zapDigits; $('zap-number').hidden = false; zapTimer = setTimeout(commitZap, 1000); return }
    if (zapDigits && (event.key === 'Enter' || event.keyCode === 13)) { event.preventDefault(); commitZap(); return }
    if (zapDigits && keyAction(event.key, event.keyCode) === 'back') { event.preventDefault(); cancelZap(); return }
  }
  if (!$('track-menu').hidden && event.key === 'Tab') {
    const items = [...$('track-menu').querySelectorAll<HTMLElement>('select:not(:disabled), button')]
    const index = items.indexOf(active as HTMLElement); event.preventDefault(); items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length]?.focus(); return
  }
  if (active instanceof HTMLInputElement && active.type === 'checkbox' && (event.key === 'Enter' || event.keyCode === 13)) { event.preventDefault(); active.click(); return }
  if (active instanceof HTMLSelectElement && (event.key === 'Enter' || event.keyCode === 13)) { nativeSelectOpen = true; return }
  const action = keyAction(event.key, event.keyCode)
  if (!action) return
  if (['detail-description', 'programme-description', 'guide-programmes'].some(id => active === $(id)) && ['up', 'down'].includes(action)) {
    const description = active as HTMLElement, remaining = description.scrollHeight - description.clientHeight - description.scrollTop
    if ((action === 'down' && remaining > 1) || (action === 'up' && description.scrollTop > 0)) { event.preventDefault(); description.scrollTop += action === 'down' ? 60 : -60; return }
  }
  if (active instanceof HTMLSelectElement && nativeSelectOpen) { if (action === 'back') nativeSelectOpen = false; return }
  if (action === 'back') { event.preventDefault(); back(); return }
  if (screen === 'catalog' && browseView === 'live' && active?.closest('#channels') && ['up', 'down'].includes(action)) {
    const items = [...$('channels').querySelectorAll<HTMLElement>('button')], index = items.indexOf(active as HTMLElement)
    if ((action === 'down' && index === items.length - 1 && (page + 1) * PAGE_SIZE < filtered.length) || (action === 'up' && index === 0 && page > 0)) {
      event.preventDefault(); page += action === 'down' ? 1 : -1; render()
      const next = $('channels').querySelectorAll<HTMLElement>('button'); next[action === 'down' ? 0 : next.length - 1]?.focus(); return
    }
  }
  if (screen === 'playback') {
    if (['channel-up', 'channel-down', 'next-episode'].includes(action)) { if ($('track-menu').hidden) { if (action === 'next-episode') playNextEpisode(); else stepChannel(action === 'channel-up' ? 1 : -1) }; event.preventDefault(); return }
    const wasHidden = $('controls').hidden; controls()
    if (action === 'stop') stopWatching()
    else if (action === 'play') player?.resume()
    else if (action === 'pause') player?.pause()
    else if (action === 'toggle') toggle()
    else if (action === 'rewind' || action === 'forward') player?.seek(action === 'rewind' ? -10 : 10)
    else if (wasHidden || action === 'info') button('toggle').disabled ? button('stop').focus() : button('toggle').focus()
    else moveFocus(action as Direction, !$('track-menu').hidden ? $('track-menu') : $('playback'))
    event.preventDefault(); return
  }
  if (!['left', 'right', 'up', 'down'].includes(action)) return
  // Preserve cursor editing and native TV select menus / on-screen keyboards.
  if (active instanceof HTMLInputElement && active.type !== 'checkbox' && ['left', 'right'].includes(action)) return
  event.preventDefault(); moveFocus(action as Direction, $('app'))
})
document.addEventListener('keyup', event => {
  if (!heldCard || event.key !== 'Enter' && event.keyCode !== 13) return
  event.preventDefault(); clearTimeout(holdTimer)
  const card = heldCard, activate = !holdOpened && document.activeElement === card; heldCard = undefined; holdOpened = false
  if (activate) card.click()
})
document.addEventListener('contextmenu', event => { const card = (event.target as HTMLElement)?.closest<HTMLElement>('.channel'); if (card && cardChannel(card)) { event.preventDefault(); openCardMenu(card) } })
function openCardMenu(card: HTMLElement) {
  contextChannel = cardChannel(card); if (!contextChannel) return
  contextCard = card; $('card-menu-title').textContent = contextChannel.name
  button('card-menu-play').textContent = ['movie', 'series'].includes(contextChannel.mediaKind || '') ? 'View details' : 'Watch'
  button('card-menu-favorite').textContent = library?.isFavorite(contextChannel) ? 'Remove favorite' : 'Add favorite'
  $('card-menu-history').hidden = !library?.lastPlayed(contextChannel)
  $('card-menu-watched').hidden = !['movie', 'episode'].includes(contextChannel.mediaKind || '')
  button('card-menu-watched').textContent = library?.lastPlayed(contextChannel)?.completed ? 'Mark as unwatched' : 'Mark as watched'
  $('card-menu-note').textContent = ''; $('card-menu').hidden = false; button('card-menu-play').focus()
}
function closeCardMenu() {
  $('card-menu').hidden = true
  const matches = contextChannel ? [...document.querySelectorAll<HTMLElement>(`[data-channel="${channelId(contextChannel)}"]`)] : []
  const restored = contextCard?.isConnected && !contextCard.closest('[hidden]') ? contextCard : matches.find(element => !element.closest('[hidden]'))
  const fallback = [...$(screen).querySelectorAll<HTMLElement>('button:not(:disabled)')].find(element => !element.closest('[hidden]') && element.getClientRects().length)
  ;(restored || fallback)?.focus()
}
async function refreshCards() {
  if (screen === 'detail') renderDetails()
  else if (browseView === 'home') await homeRows($('home-rows'), activeSource?.kind === 'xtream' ? libraryPool() : channels, library, watch)
  else await filter(false)
}
$('card-menu-close').onclick = closeCardMenu
$('card-menu-play').onclick = () => { const channel = contextChannel; closeCardMenu(); if (channel) { lastFocusedCard = contextCard; watch(channel) } }
for (const [id, history] of [['card-menu-favorite', false], ['card-menu-history', true]] as const) $(id).onclick = async () => {
  if (!contextChannel) return
  try { if (history) library?.removeRecent(contextChannel); else library?.toggleFavorite(contextChannel); rememberLibraryChannel(contextChannel); await refreshCards(); closeCardMenu() }
  catch (error) { $('card-menu-note').textContent = (error as Error).message }
}
$('card-menu-watched').onclick = async () => {
  if (!contextChannel) return
  try { if (library?.lastPlayed(contextChannel)?.completed) library.removeRecent(contextChannel); else library?.record(contextChannel, 0, 0, true); rememberLibraryChannel(contextChannel); await refreshCards(); closeCardMenu() }
  catch { $('card-menu-note').textContent = 'This change could not be saved to TV storage.' }
}
document.addEventListener('change', () => { nativeSelectOpen = false })
document.addEventListener('focusin', () => { nativeSelectOpen = false; if (heldCard && !holdOpened && heldCard !== document.activeElement) { clearTimeout(holdTimer); heldCard = undefined } })
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelLoad(); cancelProviderLoad(); if (screen === 'playback') { stopWatching(); notice('Playback stopped while the app was away. Select a stream to continue.'); } }
})
window.addEventListener('pagehide', () => { cancelLoad(); cancelProviderLoad(); cancelGuide(); guide?.clear(); providerIndex?.pause(); saveProgress(); player?.stop() })
window.addEventListener('offline', () => { if (screen === 'playback') { saveProgress(); player?.stop(); report('error', 'The TV is offline. Reconnect to your network, then choose Retry stream.') } })
for (const key of ['MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop', 'MediaRewind', 'MediaFastForward', 'MediaTrackNext', 'ChannelUp', 'ChannelDown', 'Info', ...'0123456789']) {
  try { window.tizen?.tvinputdevice?.registerKey(key) } catch { /* not every remote has every key */ }
}
function updateGroups() {
  const selected = select('group').value
  const group = select('group'); group.replaceChildren(new Option('All groups', ''))
  const pool = providerIndex && ['search', 'all'].includes(browseView) ? libraryPool() : channels
  const groups = new Set<string>(); for (const channel of pool) groups.add(channel.group)
  for (const name of Array.from(groups).sort()) group.add(new Option(name, name))
  if ([...group.options].some(option => option.value === selected)) group.value = selected
}
function cancelGuide() { clearTimeout(guideTimer); guideLoading?.abort(); guideLoading = undefined }
function selectGuide(channel?: Channel, refresh = false) {
  cancelGuide(); guideChannel = channel; guideItems = []; guidePage = 0
  $('guide-title').textContent = channel?.name || 'Choose a channel'
  $('guide-programmes').replaceChildren(); $('guide-description').textContent = ''
  button('guide-watch').disabled = button('guide-favorite').disabled = !channel
  button('guide-favorite').textContent = channel && library?.isFavorite(channel) ? '★ Favorited' : '☆ Favorite'
  $('guide-status').textContent = channel ? 'Loading programme guide…' : ''
  if (!channel) return
  guideTimer = setTimeout(async () => {
    const controller = new AbortController(); guideLoading = controller
    try {
      const items = await guide?.load(channel, controller.signal, refresh, selectedGuideWindow()) || []
      if (guideLoading !== controller) return
      guideItems = items; renderGuide()
    } catch (error) { if (guideLoading === controller) $('guide-status').textContent = (error as Error).message }
    finally { if (guideLoading === controller) guideLoading = undefined }
  }, 180)
}
function renderGuide() {
  const slot = nowNext(guideItems), window = selectedGuideWindow()
  currentGuideSlot = slot.current?.start
  const upcoming = guideItems.filter(item => !window ? item.stop > Date.now() : item.stop > window.fromMs && item.start < window.toMs)
  $('guide-status').textContent = slot.current ? `On now · ${timeRange(slot.current, preferences.guideClock)}` : upcoming.length ? 'Coming up' : 'No programme guide for this channel.'
  $('guide-description').textContent = slot.current?.description || ''
  const list = $('guide-programmes'), scroll = list.scrollTop, focused = list.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.programme : undefined; list.replaceChildren()
  guidePage = Math.min(guidePage, Math.max(0, Math.ceil(upcoming.length / 24) - 1))
  for (const item of upcoming.slice(guidePage * 24, (guidePage + 1) * 24)) {
    const entry = document.createElement('button'), title = document.createElement('h3'), time = document.createElement('p')
    entry.className = 'programme-entry'; entry.dataset.programme = String(item.start); entry.onclick = () => openProgramme(item)
    title.textContent = item.title; time.textContent = timeRange(item, preferences.guideClock); entry.append(time, title)
    if (item === slot.current) { const progress = document.createElement('progress'); progress.max = item.stop - item.start; progress.value = Math.max(0, Date.now() - item.start); progress.setAttribute('aria-label', 'Programme progress'); entry.append(progress); entry.classList.add('on-now') }
    if (activeSource && guideChannel && canReplay(activeSource, guideChannel, item)) { const badge = document.createElement('small'); badge.textContent = '↶ Replay available'; entry.append(badge) }
    list.append(entry)
  }
  list.scrollTop = scroll
  if (focused) list.querySelector<HTMLElement>(`[data-programme="${focused}"]`)?.focus({ preventScroll: true })
  button('guide-previous').disabled = guidePage === 0; button('guide-next').disabled = (guidePage + 1) * 24 >= upcoming.length
  $('guide-page').textContent = upcoming.length ? `${guidePage + 1} / ${Math.ceil(upcoming.length / 24)}` : 'No listings'
}
function syncGuideDays() {
  const selected = select('guide-day').value, picker = select('guide-day'); picker.replaceChildren(new Option('Now & next', 'now'))
  for (let delta = -7; delta <= 2; delta++) {
    const fixed = preferences.guideClock !== 'auto', offset = fixed ? Number(preferences.guideClock) * 60000 : 0, date = new Date(Date.now() + offset)
    if (fixed) { date.setUTCDate(date.getUTCDate() + delta); date.setUTCHours(0, 0, 0, 0) } else { date.setDate(date.getDate() + delta); date.setHours(0, 0, 0, 0) }
    const from = date.getTime() - offset, label = guideDate(from, preferences.guideClock)
    picker.add(new Option(delta === 0 ? `Today · ${label}` : label, String(from)))
  }
  if ([...picker.options].some(option => option.value === selected)) picker.value = selected
}
function selectedGuideWindow() {
  const raw = select('guide-day').value; if (!raw || raw === 'now') return
  const fromMs = Number(raw), end = new Date(fromMs)
  if (preferences.guideClock === 'auto') end.setDate(end.getDate() + 1); else end.setTime(fromMs + 86400000)
  return { fromMs, toMs: end.getTime() }
}
syncGuideDays()
select('guide-day').onchange = () => { guidePage = 0; selectGuide(guideChannel) }
for (const [id, delta] of [['guide-previous', -1], ['guide-next', 1]] as const) $(id).onclick = () => { guidePage += delta; renderGuide(); $('guide-programmes').querySelector<HTMLElement>('button')?.focus() }
function openProgramme(programme: Programme) {
  if (!guideChannel || !activeSource) return
  selectedProgramme = programme; programmeChannel = guideChannel
  $('programme-title').textContent = programme.title
  $('programme-meta').textContent = `${guideChannel.name} · ${guideDate(programme.start, preferences.guideClock)} · ${timeRange(programme, preferences.guideClock)}`
  $('programme-description').textContent = programme.description || 'Your provider has no description for this programme.'
  const replay = canReplay(activeSource, guideChannel, programme)
  $('programme-replay').hidden = $('replay-options').hidden = !replay
  button('programme-replay').disabled = false; button('programme-replay').textContent = programme.stop > Date.now() ? 'Watch from beginning' : 'Watch replay'
  $('programme-note').textContent = replay ? 'Available within your provider’s archive. Format and playback support depend on this TV.' : programme.start > Date.now() ? 'This programme has not started yet.' : 'Your provider does not advertise a replay for this programme.'
  show('programme')
}
function returnFromProgramme() { show('catalog'); (selectedProgramme && $('guide-programmes').querySelector<HTMLElement>(`[data-programme="${selectedProgramme.start}"]`) || button('guide-watch')).focus() }
$('programme-back').onclick = returnFromProgramme
$('programme-live').onclick = () => { if (programmeChannel) { playbackReturn = 'programme'; liveQueue.reset(libraryPool(), programmeChannel); startWatching(programmeChannel) } }
$('programme-replay').onclick = async () => {
  if (!activeSource || !programmeChannel || !selectedProgramme || replayLoading) return
  const controller = new AbortController(); replayLoading = controller; button('programme-replay').disabled = true; $('programme-note').textContent = 'Opening the provider archive…'
  try {
    const media = await replayChannel(activeSource, programmeChannel, selectedProgramme, controller.signal, { format: select('replay-format').value as 'hls' | 'ts' | 'legacy', ...(select('replay-clock').value !== 'provider' ? { offset: Number(select('replay-clock').value) } : {}) })
    if (replayLoading !== controller) return
    replayLoading = undefined; $('programme-note').textContent = 'Replay uses the selected provider clock and archive format.'; playbackReturn = 'programme'; startWatching(media)
  } catch (error) { if (replayLoading === controller) $('programme-note').textContent = (error as Error).message }
  finally { if (replayLoading === controller) replayLoading = undefined; button('programme-replay').disabled = false }
}
setInterval(() => {
  if (screen !== 'catalog' || browseView !== 'live' || !guideItems.length) return
  const current = nowNext(guideItems).current
  if (currentGuideSlot !== current?.start) renderGuide()
  else { const progress = $('guide-programmes').querySelector<HTMLProgressElement>('progress'); if (progress && current) progress.value = Math.max(0, Date.now() - current.start) }
}, 30000)
$('guide-watch').onclick = () => { if (guideChannel) playChannel(guideChannel) }
$('guide-favorite').onclick = () => { if (!guideChannel) return; try { library?.toggleFavorite(guideChannel); rememberLibraryChannel(guideChannel); button('guide-favorite').textContent = library?.isFavorite(guideChannel) ? '★ Favorited' : '☆ Favorite'; render() } catch (error) { $('guide-status').textContent = (error as Error).message } }
$('guide-refresh').onclick = () => selectGuide(guideChannel, true)
function cancelProviderLoad() { providerLoading?.abort(); providerLoading = undefined; $('cancel-category').hidden = true }
function browseLayout(title: string) {
  document.documentElement.dataset.browse = browseView
  cancelHomeRows()
  $('home-content').hidden = true; $('browse-content').hidden = false
  $('category-list').hidden = !['live', 'movie', 'series'].includes(browseView); $('channels').hidden = $('pagination').hidden = false
  $('category-sidebar').hidden = !['live', 'movie', 'series'].includes(browseView)
  $('guide-panel').hidden = browseView !== 'live' || libraryView !== 'all'
  $('browse-columns').classList.toggle('has-categories', !$('category-sidebar').hidden)
  $('browse-columns').classList.toggle('has-guide', !$('guide-panel').hidden)
  $('group-field').hidden = !$('category-sidebar').hidden
  $('kind-field').hidden = !['search', 'all'].includes(browseView)
  $('browse-options').hidden = browseView === 'live'
  $('catalog').querySelector<HTMLElement>('.filters')!.hidden = false
  $('section-title').textContent = title; $('section-kicker').textContent = activeSource?.kind === 'xtream' ? 'YOUR PROVIDER LIBRARY' : 'YOUR LIBRARY'
  $('categories-back').hidden = activeSource?.kind !== 'xtream' || !['live', 'movie', 'series'].includes(browseView)
  show('catalog'); syncNav()
}
function syncNav() {
  for (const element of Array.from($('tv-nav').querySelectorAll('button'))) {
    const selected = screen === 'settings' ? element.id === 'nav-settings' : element.id === `nav-${browseView}` && libraryView === 'all'
    if (selected) element.setAttribute('aria-current', 'page'); else element.removeAttribute('aria-current')
  }
}
function renderHome() {
  void homeRows($('home-rows'), activeSource?.kind === 'xtream' ? libraryPool() : channels, library, channel => { lastFocusedCard = document.activeElement as HTMLElement; watch(channel) })
  const pool = providerIndex?.items.length ? providerIndex.items : channels
  const featured = [...knownLibraryChannels.values()].find(channel => library?.isFavorite(channel)) || pool.find(channel => channel.mediaKind === 'movie' && channel.logo) || pool.find(channel => channel.logo) || pool[0]
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
  const base = providerIndex?.items.length ? providerIndex.items : channels
  if (base === channels && !knownLibraryChannels.size) return channels
  const result = [...base], ids = new Set(base.map(channelId))
  if (base !== channels) for (const channel of channels) if (!ids.has(channelId(channel))) { result.push(channel); ids.add(channelId(channel)) }
  for (const [id, channel] of knownLibraryChannels) if (!ids.has(id)) result.push(channel)
  return result
}
function renderIndexStatus() {
  const progress = providerIndex?.progress
  $('library-loading').hidden = !progress
  if (!progress) return
  $('index-status').textContent = progress.complete ? `${progress.titles.toLocaleString()} titles · Library ready` : `${progress.running ? 'Loading library' : 'Library paused'} · ${progress.titles.toLocaleString()} titles · ${progress.loaded}/${progress.total} categories${progress.failed ? ` · ${progress.failed} unavailable` : ''}`
  $('index-message').textContent = progress.message
  button('index-toggle').hidden = progress.complete
  button('index-toggle').textContent = progress.running ? 'Pause loading' : 'Continue loading'
}
function startIndex() {
  const index = providerIndex
  if (!index) return
  void index.start(() => {
    if (index !== providerIndex) return
    renderIndexStatus()
    if (indexTimer) return
    indexTimer = setTimeout(() => {
      indexTimer = undefined
      if (index !== providerIndex || screen !== 'catalog') return
      if (browseView === 'home') renderHome()
      else if (['search', 'all'].includes(browseView)) { if (!nativeSelectOpen) updateGroups(); void filter(false) }
      else if (['live', 'movie', 'series'].includes(browseView) && !browseCategory) { channels = index.items.filter(channel => channel.mediaKind === browseView); void filter(false) }
    }, 200)
  })
}
$('index-toggle').onclick = () => { if (providerIndex?.progress.running) { providerIndex.pause(); renderIndexStatus() } else startIndex() }
function goHome() {
  cancelProviderLoad(); cancelGuide(); searching?.abort(); clearTimeout(searchTimer); browseView = 'home'; libraryView = 'all'
  document.documentElement.dataset.browse = 'home'
  $('home-content').hidden = false; $('browse-content').hidden = true
  $('section-title').textContent = 'Home'; $('section-kicker').textContent = 'WELCOME BACK'
  renderHome(); show('catalog'); syncNav(); $('hero-play').focus()
}
async function browse(kind: 'search' | MediaKind) {
  cancelProviderLoad(); cancelGuide(); browseCategory = undefined; browseView = kind; libraryView = 'all'; input('search').value = ''; select('group').value = ''
  const title = { live: 'Live TV', movie: 'Movies', series: 'Series', search: 'Search' }[kind]
  browseLayout(title)
  if (activeSource?.kind !== 'xtream' || kind === 'search') {
    updateGroups(); await filter()
    if (kind === 'search') input('search').focus()
    else {
      const list = $('category-list'); list.replaceChildren()
      for (const group of new Set(channels.filter(channel => (channel.mediaKind || 'live') === kind).map(channel => channel.group))) { const item = document.createElement('button'); item.textContent = group; item.onclick = () => { select('group').value = group; void filter() }; list.append(item) }
      $('categories-back').hidden = false
    }
    return
  }
  const controller = new AbortController(); providerLoading = controller; $('cancel-category').hidden = false
  channels = providerIndex?.items.filter(channel => channel.mediaKind === kind) || []; updateGroups(); await filter()
  $('result-count').textContent = 'Loading categories…'
  try {
    const categories = providerIndex?.categories[kind] || providerCategories[kind] || await loadCategories(activeSource, kind, controller.signal)
    if (providerLoading !== controller) return
    providerCategories[kind] = categories
    const list = $('category-list'); list.replaceChildren(); list.hidden = false; $('categories-back').hidden = false
    for (const category of categories) {
      const item = document.createElement('button'); item.textContent = category.name; item.onclick = () => void openCategory(kind, category); list.append(item)
    }
    if (!filtered.length) $('result-count').textContent = categories.length ? 'Choose a category, or wait for your library to load.' : 'Your provider returned no categories in this section.'
    else render()
    list.querySelector('button')?.focus()
  } catch (error) { if (providerLoading === controller) { $('result-count').textContent = ''; notice((error as Error).message) } }
  finally { if (providerLoading === controller) { providerLoading = undefined; $('cancel-category').hidden = true } }
}
async function openCategory(kind: MediaKind, category: Category) {
  if (!activeSource) return
  cancelProviderLoad(); const controller = new AbortController(); providerLoading = controller
  $('cancel-category').hidden = false; notice('Loading this category…')
  try {
    const result = providerIndex?.cached(kind, category) || await loadCategory(activeSource, kind, category, controller.signal)
    if (providerLoading !== controller) return
    browseCategory = category; channels = result.channels; updateGroups(); browseLayout(category.name); await filter()
    $('channels').querySelector<HTMLElement>('button')?.focus()
    if (result.skipped) notice(`${result.skipped} invalid entries were skipped.`)
  } catch (error) { if (providerLoading === controller) notice((error as Error).message) }
  finally { if (providerLoading === controller) { providerLoading = undefined; $('cancel-category').hidden = true } }
}
function cancelDetails() { detailLoading?.abort(); detailLoading = undefined }
async function openTitle(channel: Channel) {
  if (!activeSource) return
  cancelProviderLoad(); cancelDetails(); searching?.abort()
  detailInfo = basicDetails(channel); episodePage = 0; select('detail-season').replaceChildren()
  renderDetails(); show('detail'); button('detail-play').focus()
  const controller = new AbortController(); detailLoading = controller
  $('detail-status').textContent = 'Loading details…'; $('detail-retry').hidden = true
  try {
    const result = await loadTitleDetails(activeSource, channel, controller.signal)
    if (detailLoading !== controller) return
    detailLoading = undefined; detailInfo = result; renderDetails(); $('detail-status').textContent = ''
  } catch (error) { if (detailLoading === controller) { $('detail-status').textContent = (error as Error).message; $('detail-retry').hidden = false } }
  finally { if (detailLoading === controller) { detailLoading = undefined; renderEpisodes() } }
}
function renderDetails() {
  if (!detailInfo) return
  const info = detailInfo, series = info.channel.mediaKind === 'series'
  $('detail-title').textContent = info.channel.name; $('detail-kind').textContent = series ? 'SERIES' : 'MOVIE'
  $('detail-meta').textContent = info.metadata.join(' · ')
  $('detail-description').textContent = info.description || 'No description is available for this title.'
  $('detail-credits').textContent = [info.director ? `Director: ${info.director}` : '', info.cast ? `Cast: ${info.cast}` : ''].filter(Boolean).join(' · ')
  for (const [id, url] of [['detail-poster', info.poster], ['detail-backdrop', info.backdrop]] as const) {
    const img = $<HTMLImageElement>(id); img.hidden = !url; img.referrerPolicy = 'no-referrer'
    if (url) { img.src = url; img.onerror = () => { img.hidden = true } } else img.removeAttribute('src')
  }
  const favorite = !!library?.isFavorite(info.channel)
  button('detail-favorite').textContent = favorite ? '★ Favorited' : '☆ Add favorite'
  button('detail-favorite').setAttribute('aria-pressed', String(favorite))
  button('detail-play').disabled = series && !info.episodes?.length
  button('detail-play').textContent = series ? '▶ Play first episode' : library?.lastPlayed(info.channel)?.position ? '▶ Continue watching' : '▶ Play movie'
  $('detail-episodes').hidden = !series
  const seasons = select('detail-season'), selected = seasons.value || library?.season(info.channel) || ''; seasons.replaceChildren()
  for (const season of new Set(info.episodes?.map(episode => episode.group))) seasons.add(new Option(season, season))
  if ([...seasons.options].some(option => option.value === selected)) seasons.value = selected
  renderEpisodes()
}
function renderEpisodes() {
  const episodes = (detailInfo?.episodes || []).filter(episode => episode.group === select('detail-season').value)
  const grid = $('episode-grid'); grid.replaceChildren()
  episodePage = Math.min(episodePage, Math.max(0, Math.ceil(episodes.length / PAGE_SIZE) - 1))
  for (const episode of episodes.slice(episodePage * PAGE_SIZE, (episodePage + 1) * PAGE_SIZE)) grid.append(channelCard(episode, () => playChannel(episode), library))
  $('episode-page').textContent = episodes.length ? `Page ${episodePage + 1} of ${Math.ceil(episodes.length / PAGE_SIZE)}` : detailLoading ? 'Loading episodes…' : 'No episodes available'
  button('episode-previous').disabled = episodePage === 0; button('episode-next').disabled = (episodePage + 1) * PAGE_SIZE >= episodes.length
  if (detailInfo?.channel.mediaKind === 'series') { button('detail-play').disabled = !episodes.length; button('detail-play').textContent = episodes.some(episode => library?.lastPlayed(episode)?.position) ? '▶ Continue watching' : `▶ Play ${select('detail-season').value.toLowerCase() || 'series'}` }
}
function returnFromDetails() {
  cancelDetails(); show('catalog')
  if (browseView === 'home') { renderHome(); $('hero-play').focus() }
  else { render(); ($('channels').querySelectorAll<HTMLElement>('button')[lastChannel] || button('view-all')).focus(); if (libraryView !== 'all') void filter() }
}
$('detail-back').onclick = returnFromDetails
$('detail-play').onclick = () => {
  const episodes = detailInfo?.episodes?.filter(episode => episode.group === select('detail-season').value) || []
  const resumable = episodes.filter(episode => library?.lastPlayed(episode)?.position).sort((a, b) => (library?.lastPlayed(b)?.at || 0) - (library?.lastPlayed(a)?.at || 0))
  const channel = detailInfo?.channel.mediaKind === 'series' ? resumable[0] || episodes[0] : detailInfo?.channel; if (channel) playChannel(channel)
}
$('detail-favorite').onclick = () => { if (!detailInfo) return; try { library?.toggleFavorite(detailInfo.channel); rememberLibraryChannel(detailInfo.channel); renderDetails() } catch (error) { $('detail-status').textContent = (error as Error).message } }
$('detail-retry').onclick = () => { if (detailInfo) void openTitle(detailInfo.channel) }
select('detail-season').onchange = () => { episodePage = 0; if (detailInfo) try { library?.setSeason(detailInfo.channel, select('detail-season').value) } catch { $('detail-status').textContent = 'Season selection applies for this session.' }; renderEpisodes() }
for (const [id, delta] of [['episode-previous', -1], ['episode-next', 1]] as const) $(id).onclick = () => { episodePage += delta; renderEpisodes(); $('episode-grid').querySelector<HTMLElement>('button')?.focus() }
$('nav-home').onclick = goHome
for (const kind of ['live', 'movie', 'series', 'search'] as const) {
  $(`nav-${kind}`).onclick = () => void browse(kind)
  if (kind !== 'search') $(`home-${kind}`).onclick = () => void browse(kind)
}
$('nav-settings').onclick = () => { cancelProviderLoad(); show('settings'); syncNav() }
$('settings-back').onclick = goHome
$('settings-source').onclick = () => show('setup')
$('settings-refresh').onclick = () => button('refresh-catalog').click()
$('settings-reset').onclick = () => { preferences = { ...DEFAULTS }; syncPreferences(); persistPreferences() }
function syncPreferences() {
  for (const [id, value] of Object.entries({ theme: preferences.theme, accent: preferences.accent, scale: preferences.scale, overscan: preferences.overscan, motion: preferences.reducedMotion, audio: preferences.audio, subtitles: preferences.subtitles, clock: preferences.guideClock, autonext: preferences.autoNext })) select(`pref-${id}`).value = String(value)
}
function persistPreferences() {
  applyPreferences(preferences)
  syncGuideDays()
  try { savePreferences(preferenceStorage, preferences); $('settings-note').textContent = preferenceStorage ? 'Preferences saved. Language choices apply when the next stream starts.' : 'Preferences apply for this session.' }
  catch { $('settings-note').textContent = 'TV storage is unavailable. Preferences apply for this session.' }
}
for (const accent of Object.keys(ACCENTS)) select('pref-accent').add(new Option(accent[0].toUpperCase() + accent.slice(1), accent))
for (let value = 0; value <= 8; value++) select('pref-overscan').add(new Option(value ? `${value}%` : 'Off', String(value)))
select('pref-subtitles').add(new Option('Off', 'off'))
for (const [code, label] of Object.entries(LANGUAGES)) { select('pref-audio').add(new Option(label, code)); select('pref-subtitles').add(new Option(label, code)) }
select('pref-clock').add(new Option('Device time zone', 'auto'))
for (let offset = -720; offset <= 840; offset += 30) select('pref-clock').add(new Option(`UTC${offset < 0 ? '−' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`, String(offset)))
for (const option of select('pref-clock').options) if (option.value !== 'auto') select('replay-clock').add(new Option(option.text, option.value))
for (const element of $('settings').querySelectorAll<HTMLSelectElement>('select')) element.onchange = () => {
  preferences = normalizePreferences({ theme: select('pref-theme').value, accent: select('pref-accent').value, scale: Number(select('pref-scale').value), overscan: Number(select('pref-overscan').value), reducedMotion: select('pref-motion').value === 'true', audio: select('pref-audio').value, subtitles: select('pref-subtitles').value, guideClock: select('pref-clock').value, autoNext: select('pref-autonext').value === 'true' })
  persistPreferences()
}
syncPreferences()
window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => applyPreferences(preferences))
function applyTrackPreferences() {
  const tracks = player?.tracks?.() || [], audioLanguage = preferences.audio === 'auto' ? navigator.language : preferences.audio
  const audio = tracks.find(track => track.kind === 'audio' && !track.disabled && languageMatch(track.language, audioLanguage))
  if (audio) player?.selectTrack?.('audio', audio.id)
  if (preferences.subtitles === 'off') player?.selectTrack?.('subtitle', 'off')
  else {
    const subtitle = tracks.find(track => track.kind === 'subtitle' && languageMatch(track.language, preferences.subtitles === 'auto' ? audioLanguage : preferences.subtitles))
    if (subtitle) player?.selectTrack?.('subtitle', subtitle.id)
  }
}
$('settings-about').onclick = () => { previousScreen = 'settings'; show('about') }
$('categories-back').onclick = () => { if (['live', 'movie', 'series'].includes(browseView)) void browse(browseView as MediaKind) }
$('cancel-category').onclick = () => { cancelProviderLoad(); notice('Loading cancelled.') }
function refreshTracks() {
  const tracks = player?.tracks?.() || []
  for (const kind of ['audio', 'subtitle'] as const) {
    const list = select(`${kind}-track`), available = tracks.filter(track => track.kind === kind)
    list.replaceChildren()
    if (kind === 'subtitle') list.add(new Option('Off', 'off', false, !available.some(track => track.active)))
    else if (!available.some(track => track.active)) { const current = new Option(available.length ? 'Current audio' : 'No alternate audio available', ''); current.disabled = true; current.selected = true; list.add(current) }
    for (const track of available) { const option = new Option(track.label, track.id, false, track.active); option.disabled = !!track.disabled; list.add(option) }
    list.disabled = !available.length || available.every(track => track.disabled)
  }
  $('track-status').textContent = tracks.some(track => track.kind === 'audio' && track.disabled) ? 'Resume playback to change audio on this TV.' : !tracks.length ? 'This stream or player does not expose alternate tracks.' : ''
}
function closeTracks() { $('track-menu').hidden = true; controls(); button('tracks-open').focus() }
$('tracks-open').onclick = () => { $('track-menu').hidden = false; refreshTracks(); clearTimeout(controlsTimer); ($('track-menu').querySelector<HTMLElement>('select:not(:disabled)') || button('tracks-close')).focus() }
$('tracks-close').onclick = closeTracks
for (const kind of ['audio', 'subtitle'] as const) select(`${kind}-track`).onchange = () => {
  const success = player?.selectTrack?.(kind, select(`${kind}-track`).value)
  if (!success) { refreshTracks(); $('track-status').textContent = 'This track could not be selected. Resume playback and try again.' }
  else $('track-status').textContent = kind === 'audio' ? 'Audio selection applied.' : select('subtitle-track').value === 'off' ? 'Subtitles off.' : 'Subtitle selection applied.'
}
$('stay').onclick = () => activeSource ? goHome() : show('setup')
$('platform').textContent = (__TV_TARGET__ === 'webos' ? 'LG webOS' : __TV_TARGET__ === 'tizen' ? 'Samsung Tizen' : 'Browser') + ' · development build'
try {
  const saved = readSource(localStorage)
  if (saved) fillProfile(readProfiles(localStorage).find(profile => profile.id === sourceId(saved)) || { id: sourceId(saved), name: '', source: saved })
} catch { /* session-only mode still works when storage is unavailable */ }
sourceKind(); show('setup')
