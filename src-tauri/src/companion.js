/* Local browser remote. No third-party requests, analytics, account passwords, or URL keys. */
(() => {
  const $ = id => document.getElementById(id)
  const storageKey = 'lanternfin.local.remote'
  let key = ''; try { key = localStorage.getItem(storageKey) || '' } catch {}
  let state = { state: 'idle', positionSeconds: 0 }
  let busy = false, scrubbing = false, stopArmed = false, pollBusy = false
  const clock = seconds => {
    const n = Math.max(0, Math.floor(seconds || 0)), h = Math.floor(n / 3600), m = Math.floor(n / 60) % 60
    return `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(n % 60).padStart(2, '0')}`
  }
  function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error) }
  function disconnect() {
    key = ''; try { localStorage.removeItem(storageKey) } catch {}
    $('remote').hidden = true; $('pair').hidden = false
  }
  async function request(path, body) {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-XT-Key': key },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) })
    if (response.status === 401) { disconnect(); throw new Error('Pair again using the code on your TV.') }
    if (!response.ok) throw new Error(response.status === 403 ? 'That code did not match. Check the TV.' : response.status === 429 ? 'Too many attempts. Wait a minute and try again.' : response.status === 409 ? 'The video or its tracks changed. Check the selection and try again.' : 'The TV could not complete that request.')
    return response.json()
  }
  const canSeek = () => !state.isLive && state.seekable !== false && state.durationSeconds > 0 && !['idle', 'error', 'loading'].includes(state.state)
  function renderTracks() {
    $('tracks').hidden = !state.companion
    for (const [kind, id] of [['text', 'subtitle-track'], ['audio', 'audio-track']]) {
      const select = $(id), tracks = (state.tracks || []).filter(track => track.kind === kind)
      const options = [['', tracks.length ? (kind === 'text' ? 'Subtitles off' : 'Automatic') :
        (kind === 'text' ? 'No subtitles in this video' : 'No audio tracks available')], ...tracks.map(track => [track.id, track.label])]
      const signature = JSON.stringify(options)
      if (select.dataset.options !== signature) {
        select.replaceChildren(...options.map(([value, label]) => new Option(label, value)))
        select.dataset.options = signature
      }
      select.disabled = busy || !tracks.length || !state.playbackId || state.tracksRevision === undefined || ['idle', 'loading', 'error', 'ended'].includes(state.state)
      select.value = kind === 'audio' && state.audioAutomatic ? '' : tracks.find(track => track.selected)?.id || ''
    }
  }
  function render() {
    renderTracks()
    $('pair').hidden = true; $('remote').hidden = false
    $('title').textContent = state.title || 'Ready when you are.'
    $('state').textContent = state.state === 'idle' ? 'Pick something on the TV or in the phone app.' : state.state === 'error' ? state.error || 'Playback needs attention on the TV.' : state.state === 'playing' ? 'Playing on your TV' : state.state === 'paused' ? 'Paused' : state.state === 'ended' ? 'Finished' : 'Loading…'
    $('toggle').textContent = state.state === 'paused' ? 'Play' : 'Pause'
    $('toggle').disabled = ['idle', 'ended', 'error'].includes(state.state)
    $('stop').disabled = state.state === 'idle'
    $('timeline').hidden = !!state.isLive
    for (const id of ['seek','go','time','back','forward']) $(id).disabled = !canSeek()
    if (!scrubbing) { $('seek').max = state.durationSeconds || 0; $('seek').value = state.positionSeconds; $('position').textContent = clock(state.positionSeconds) }
    $('duration').textContent = state.durationSeconds ? clock(state.durationSeconds) : '—'
    if (document.activeElement !== $('volume')) $('volume').value = state.volume ?? 1
    $('mute').textContent = state.muted ? 'Unmute' : 'Mute'
  }
  async function poll() {
    if (!key || pollBusy || document.hidden) return
    const requestKey = key
    pollBusy = true
    try { const next = await request('/state'); if (key !== requestKey) return; state = next; render(); message('') }
    catch (error) { message(error.message || 'TV unavailable. Keep Lanternfin open and check Wi-Fi.', true) }
    finally { pollBusy = false }
  }
  async function action(path, body = {}) {
    if (busy || !key) return
    busy = true; renderTracks()
    try { await request(path, body); await poll() } catch (error) { message(error.message, true) } finally { busy = false; renderTracks() }
  }
  $('pair-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return; busy = true
    try {
      const result = await request('/pair', { v: 1, code: $('code').value.trim(), deviceName: 'Phone browser' })
      key = result.key; try { localStorage.setItem(storageKey, key) } catch {}
      $('device').textContent = result.name || 'Your TV'; $('code').value = ''; await poll()
    } catch (error) { message(error.message, true) } finally { busy = false; renderTracks() }
  })
  const seek = seconds => { if (canSeek() && Number.isFinite(seconds)) void action('/seek', { seconds: Math.max(0, Math.min(state.durationSeconds, seconds)) }) }
  $('seek').addEventListener('pointerdown', () => { scrubbing = true })
  $('seek').addEventListener('input', () => { $('position').textContent = clock(Number($('seek').value)) })
  $('seek').addEventListener('change', () => { scrubbing = false; seek(Number($('seek').value)) })
  $('seek').addEventListener('pointercancel', () => { scrubbing = false })
  $('time-form').addEventListener('submit', event => {
    event.preventDefault(); const text = $('time').value.trim(), parts = text.split(':').map(Number)
    if (!/^\d{1,7}(?::\d{2}){0,2}$/.test(text) || parts.slice(1).some(n => n >= 60)) { message('Enter seconds, m:ss, or h:mm:ss.', true); return }
    const seconds = parts.reduce((n, v) => n * 60 + v, 0)
    if (!canSeek() || seconds > state.durationSeconds) { message('Choose a time within this video.', true); return }
    seek(seconds)
  })
  $('toggle').onclick = () => action(state.state === 'paused' ? '/resume' : '/pause')
  $('back').onclick = () => seek(state.positionSeconds - 30)
  $('forward').onclick = () => seek(state.positionSeconds + 30)
  $('volume').onchange = () => action('/volume', { level: Number($('volume').value), muted: false })
  $('mute').onclick = () => action('/volume', { level: state.volume ?? 1, muted: !state.muted })
  $('stop').onclick = () => {
    if (stopArmed) { stopArmed = false; $('stop').textContent = 'Stop playback'; void action('/stop'); return }
    stopArmed = true; $('stop').textContent = 'Tap again to stop on TV'
    setTimeout(() => { stopArmed = false; $('stop').textContent = 'Stop playback' }, 3000)
  }
  for (const [kind, id] of [['text', 'subtitle-track'], ['audio', 'audio-track']]) {
    $(id).onchange = () => {
      if ($(id).disabled || !state.playbackId || state.tracksRevision === undefined) return
      void action('/track', { playbackId: state.playbackId, tracksRevision: state.tracksRevision, kind, id: $(id).value || null })
    }
  }
  $('disconnect').onclick = () => { disconnect(); message('Disconnected. Playback continues on the TV.') }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void poll() })
  setInterval(poll, 2000); void poll()
})()
