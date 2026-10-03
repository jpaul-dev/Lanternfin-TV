const $ = id => document.getElementById(id)
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const docs = {
  lg: 'https://webostv.developer.lge.com/develop/getting-started/developer-mode-app',
  samsung: 'https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html',
  sdk: 'https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html',
  cert: 'https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html',
}
let token = location.hash.slice(1)
try {
  if (/^[a-f0-9]{64}$/.test(token)) sessionStorage.setItem('lanternfin.setup.token', token)
  else token = sessionStorage.getItem('lanternfin.setup.token') || ''
} catch { /* Current page still works without session storage. */ }
history.replaceState(null, '', location.pathname)
let state = { brand: 'lg', page: 'choose', ip: '', sdkRoot: '', profile: 'LanternfinTV', pcIp: '', checks: {}, launched: {} }
try { const saved = JSON.parse(sessionStorage.getItem('lanternfin.setup.progress') || '{}'); state = { ...state, ...saved, checks: saved.checks || {}, launched: {} } } catch { /* Fresh guide. */ }
let info = null, busy = false, lastJob = null, pollTimer, statusGeneration = 0
function remember() { try { const { launched, ...safe } = state; sessionStorage.setItem('lanternfin.setup.progress', JSON.stringify(safe)) } catch { /* optional */ } }
function key() { return `${state.brand}:${state.ip.trim()}` }
function paired() { return info?.linked.includes(key()) }
function installed() { return info?.installed.includes(key()) }
function signed() { return info?.sdk && info.signed.includes(`${info.sdk.root}|${state.profile}`) }
function steps() {
  return [['choose', 'Choose your TV'], ['tools', 'Computer tools'], ['developer', 'Developer Mode'], ['connect', 'Connect your TV'],
    ...(state.brand === 'samsung' ? [['certificate', 'Samsung certificate']] : []), ['install', 'Install Lanternfin'], ['watch', 'Start watching']]
}
async function api(path, data) {
  const response = await fetch('/api/' + path, { method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : JSON.stringify(data) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Setup could not complete the request.')
  return result
}
function problem(message) { $('offline').textContent = message; $('offline').hidden = false }
async function refresh(redraw = true) {
  const generation = ++statusGeneration
  try {
    const result = await api('status', { sdkRoot: state.sdkRoot })
    if (generation !== statusGeneration) return
    info = result
    if (!state.pcIp && result.addresses.length) state.pcIp = result.addresses[0].address
    $('offline').hidden = true
    if (redraw) render()
  } catch (error) { problem(error.message || 'Setup is no longer running. Reopen the desktop shortcut.'); }
}
const actionButton = (action, label, disabled = false, primary = false) => `<button class="${primary ? 'primary' : 'secondary'}" data-action="${action}" ${disabled || busy ? 'disabled' : ''}>${label}</button>`
const goButton = (page, label = 'Continue', disabled = false) => `<button class="primary" data-go="${page}" ${disabled || busy ? 'disabled' : ''}>${label} <span aria-hidden="true">→</span></button>`
const link = (href, text) => `<a class="secondary" href="${href}" target="_blank" rel="noopener noreferrer">${text} <span aria-hidden="true">↗</span></a>`
const heading = (eyebrow, title, description) => `<p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="lede">${description}</p>`
const pill = (good, yes = 'Ready', no = 'Needs setup') => `<span class="status-pill ${good ? '' : 'missing'}">${good ? '✓' : '○'} ${good ? yes : no}</span>`
const tvArt = brand => `<div class="tv-art ${brand === 'samsung' ? 'samsung-art' : ''}"><span class="art-label">${brand === 'lg' ? 'WEBOS' : 'TIZEN'}</span><div class="tv-frame"><div class="tv-screen"></div></div></div>`
function check(id, title, text = '') { return `<label class="check-row"><input type="checkbox" data-check="${id}" ${state.checks[id] ? 'checked' : ''} ${busy ? 'disabled' : ''}><span><strong>${title}</strong>${text}</span></label>` }
function instruction(number, title, description) { return `<div class="instruction"><span class="num">${number}</span><p><strong>${title}</strong>${description}</p></div>` }
function devReady() { return (state.brand === 'lg' ? ['lg-dev', 'lg-restarted', 'lg-key'] : ['samsung-dev', 'samsung-ip', 'samsung-restarted']).every(id => state.checks[id]) }
function certificateReady() { return ['cert-tv', 'cert-duid', 'cert-permit'].every(id => state.checks[id]) }
function field(model, label, placeholder, hint = '', type = 'text') { return `<div class="field"><label for="${model}">${label}</label><input id="${model}" data-model="${model}" type="${type}" value="${esc(state[model] || '')}" placeholder="${placeholder}" ${busy ? 'disabled' : ''} autocomplete="off" spellcheck="false" ${model === 'ip' ? 'maxlength="15" inputmode="decimal"' : 'maxlength="512"'}>${hint ? `<p class="muted">${hint}</p>` : ''}</div>` }
function toolRow(title, detail, ready, extra = '') { return `<div class="tool-row"><div><div class="tool-name">${title}</div><p class="muted">${detail}</p></div><div>${extra || pill(ready)}</div></div>` }
function trouble() {
  return `<details class="trouble"><summary>Something not connecting?</summary><ul><li>Keep the TV on and use the same home network. Guest Wi-Fi often blocks device-to-device connections.</li><li>Check the TV address again after a restart. It may have changed.</li><li>${state.brand === 'lg' ? 'Keep LG’s Key Server on while pairing. Reopen Developer Mode and use its current, case-sensitive passphrase.' : 'Confirm the computer address in Samsung’s Developer Mode screen matches the network you are using. Restart the TV after changing it.'}</li><li>If Windows asks about network access, allow the official TV tool on your private home network. You do not need to turn off the firewall.</li></ul></details>`
}
function render() {
  const focusedCheck = document.activeElement?.dataset?.check
  const list = steps(), index = Math.max(0, list.findIndex(([id]) => id === state.page))
  if (!list.some(([id]) => id === state.page)) state.page = 'choose'
  $('steps').innerHTML = list.map(([id, label], i) => `<button class="step-link ${id === state.page ? 'active' : ''} ${i < index ? 'complete' : ''}" data-go="${id}" ${busy ? 'disabled' : ''} ${id === state.page ? 'aria-current="step"' : ''}><span class="step-number">${i + 1}</span><span class="step-title">${label}</span></button>`).join('')
  $('breadcrumb').textContent = state.page === 'choose' ? 'Let’s get you watching' : `${state.brand === 'lg' ? 'LG webOS' : 'Samsung Tizen'}  /  ${list[index][1]}`
  $('help-link').href = docs[state.brand]
  $('quit').disabled = busy
  const content = $('content')
  if (state.page === 'choose') {
    content.innerHTML = heading('FROM YOUR COMPUTER TO YOUR COUCH', 'A new home for<br><em>your favorite streams.</em>', 'Let’s get Lanternfin running on your TV. Pick your screen and we’ll guide you through the rest—no commands to memorize.') +
      `<div class="brand-cards">${['lg', 'samsung'].map(brand => `<button class="tv-card" data-brand="${brand}">${tvArt(brand)}<div class="card-copy"><div class="card-title"><h2>${brand === 'lg' ? 'LG TV' : 'Samsung TV'}</h2><span class="arrow" aria-hidden="true">↗</span></div><p>${brand === 'lg' ? 'Pair your webOS TV, install the app,<br>and make yourself at home.' : 'Connect your Tizen TV, sign your app,<br>and bring it to the big screen.'}</p><span class="tag">${brand === 'lg' ? 'Developer Mode app · TV pairing code' : 'Tizen Studio · Samsung certificate'}</span></div></button>`).join('')}</div><div class="bottom-note"><span class="note-mark" aria-hidden="true">i</span><span>First preview for 2022 and newer TVs. Keep your TV and this computer on the same home network.<br>This guide runs locally. Your LG and Samsung account sign-ins stay in their official tools.</span></div>`
  } else if (state.page === 'tools') {
    const lgReady = info?.lgTools && (info?.lgPackage || info?.projectTools), samsungReady = info?.sdk && info?.projectTools
    content.innerHTML = heading('FIRST, A QUICK CHECK', 'Get your computer <em>ready.</em>', 'We’ll use the official TV tools behind the scenes. Here’s what’s already available and what needs a little setup.') +
      `<div class="panel"><div class="section-heading"><h2>Your toolkit</h2><button class="link-button small" data-refresh ${busy ? 'disabled' : ''}>Check again ↻</button></div>` +
      toolRow('Node.js', info ? `Version ${esc(info.node)} · runs this local companion` : 'Checking…', !!info) +
      (state.brand === 'lg' ? toolRow('LG webOS tools', 'Official LG command-line tools, installed just for this project.', info?.lgTools, info?.lgTools ? '' : actionButton('install-lg-tools', 'Install LG tools', !info)) :
        toolRow('Samsung Tizen Studio', info?.sdk ? esc(info.sdk.root) : 'Add Web CLI, Samsung TV Extension, and Samsung Certificate Extension in its Package Manager.', info?.sdk, info?.sdk ? '' : link(docs.sdk, 'Get Samsung tools'))) +
      toolRow('Lanternfin build tools', 'Build the current TV app from this fork.', info?.projectTools, info?.projectTools ? '' : actionButton('install-project-tools', 'Prepare build tools', !info)) +
      (state.brand === 'lg' ? toolRow('LG app package', 'Lanternfin TV · developer preview', info?.lgPackage, info?.lgPackage ? '' : actionButton('build-lg', 'Build app package', !info?.lgTools || !info?.projectTools)) : '') + `</div>` +
      (state.brand === 'samsung' ? `<div class="panel soft"><h3>Installed Tizen Studio somewhere else?</h3><p class="muted">Use its main folder—the one containing the tools folder. The default on Windows is C:\\tizen-studio.</p>${field('sdkRoot', 'Tizen Studio folder', 'C:\\tizen-studio')}<div class="actions"><button class="secondary" data-refresh ${busy ? 'disabled' : ''}>Find my Samsung tools</button>${info?.sdk?.gui?.includes('package-manager') ? actionButton('open-package-manager', 'Open Package Manager') : ''}</div></div>` : '') +
      `<div class="actions between"><button class="link-button" data-go="choose" ${busy ? 'disabled' : ''}>← Change TV</button>${goButton('developer', 'Set up the TV', !(state.brand === 'lg' ? lgReady : samsungReady))}</div>`
  } else if (state.page === 'developer') {
    const lg = state.brand === 'lg'
    content.innerHTML = heading('A FEW TAPS ON YOUR REMOTE', 'Open the door to <em>your app.</em>', 'Developer Mode lets your TV accept an app from your computer. Do these steps on the TV, then tick them off here.') +
      `<div class="split"><div class="panel"><h2>On your ${lg ? 'LG' : 'Samsung'} TV</h2>` + (lg ?
        instruction(1, 'Install Developer Mode', 'Find LG’s Developer Mode app in the TV app store. Open it and sign in with your LG developer account.') +
        instruction(2, 'Switch Dev Mode Status on', 'The TV will restart. Afterward, open Developer Mode again.') +
        instruction(3, 'Switch Key Server on', 'Leave this screen open. The six-character passphrase will be used in the next step.') :
        instruction(1, 'Open Apps → App Settings', 'With this screen open, enter <span class="keycap">12345</span> using the remote or on-screen number pad. On some models, enter it directly in Apps.') +
        instruction(2, 'Turn Developer Mode on', 'Enter this computer’s address shown alongside. This is the computer address, not the TV address.') +
        instruction(3, 'Restart the TV', 'After restarting, return to Apps and look for the Developer Mode label.')) +
      `<div class="actions">${link(docs[state.brand], 'Open illustrated guide')}</div></div><div>` +
      (lg ? `<div class="panel soft"><h3>Before you continue</h3><p class="muted">Find your TV’s IP address in its network settings. It usually starts with 192.168 or 10.</p><p class="muted">Your LG login belongs on the TV. This companion only needs the pairing code displayed there.</p></div>` :
      `<div class="panel soft"><p class="tiny-label">THIS COMPUTER’S NETWORK ADDRESS</p><div class="ip-readout" id="pc-readout">${esc(state.pcIp || 'Not detected')}</div><label for="pcIp">Network connection</label><select id="pcIp" data-model="pcIp">${(info?.addresses || []).map(item => `<option value="${esc(item.address)}" ${state.pcIp === item.address ? 'selected' : ''}>${esc(item.name)}${item.virtual ? ' (virtual / VPN)' : ''}</option>`).join('')}</select><p class="muted">Pick the connection on the same network as your TV. Avoid a VPN or virtual adapter.</p><button class="secondary small" data-copy-ip>Copy address</button></div>`) +
      `<div class="panel"><h3>Your progress</h3>` + (lg ? check('lg-dev', 'Developer Mode is on') + check('lg-restarted', 'The TV has restarted') + check('lg-key', 'Key Server is on') : check('samsung-dev', 'Developer Mode is on') + check('samsung-ip', 'I entered the computer address') + check('samsung-restarted', 'The TV has restarted')) + `</div></div></div>` +
      (lg ? `<div class="callout amber">LG development sessions expire. Use EXTEND in the TV’s Developer Mode app before its timer runs out; disabling Developer Mode can remove development apps.</div>` : '') +
      `<div class="actions between"><button class="link-button" data-go="tools">← Computer tools</button>${goButton('connect', 'Connect my TV', !devReady())}</div>`
  } else if (state.page === 'connect') {
    const lg = state.brand === 'lg'
    content.innerHTML = heading('SAY HELLO TO YOUR BIG SCREEN', 'Make the <em>connection.</em>', 'Enter the address from your TV’s network settings. We’ll check that the TV answers before installing anything.') +
      `<div class="split"><div class="panel"><div class="section-heading"><h2>${lg ? 'LG webOS' : 'Samsung Tizen'}</h2>${pill(paired(), 'Connected', 'Not checked')}</div>` +
      field('ip', 'TV IP address', '192.168.1.50', 'Use the TV’s address—not this computer’s.') +
      (lg ? `<div class="field"><label for="passphrase">Six-character pairing code</label><input id="passphrase" type="password" maxlength="6" placeholder="Shown on your TV" autocomplete="off" ${busy ? 'disabled' : ''}><p class="muted">Case-sensitive. LG’s official tools save the pairing key and its passphrase on this computer. This guide does not keep the code in its own settings or activity log.</p></div>` : '') +
      `<div class="actions">${actionButton(lg ? 'pair-lg' : 'connect-samsung', lg ? 'Pair my LG TV' : 'Connect my Samsung TV', !devReady() || (lg ? !info?.lgTools : !info?.sdk), true)}${lg ? actionButton('check-lg', 'Check existing pairing', !info?.lgTools) : ''}</div>${!devReady() ? '<p class="muted">Complete the Developer Mode checklist before pairing.</p>' : ''}</div>` +
      `<div class="panel soft"><h3>What happens here?</h3>${instruction(1, 'Choose one TV', 'We only connect to the address you enter. No network-wide scan.')}${instruction(2, lg ? 'Pair securely' : 'Check Developer Mode', lg ? 'The official LG tool requests the key from your TV and verifies the connection.' : 'Samsung’s connection tool checks that this TV accepts your computer.')}${instruction(3, 'You stay in control', 'The app is installed only when you choose Install Lanternfin.')}${trouble()}</div></div><div class="actions between"><button class="link-button" data-go="developer">← TV checklist</button>${goButton(lg ? 'install' : 'certificate', lg ? 'Continue to installation' : 'Set up signing', !paired())}</div>`
  } else if (state.page === 'certificate') {
    content.innerHTML = heading('SAMSUNG’S SEAL OF APPROVAL', 'Give your app a <em>signature.</em>', 'Samsung requires a certificate for development apps. Create it once in the official Certificate Manager, then this companion can sign the app for you.') +
      `<div class="split"><div class="panel"><h2>In Tizen Studio</h2>${instruction(1, 'Create a Samsung → TV profile', 'Open Tools → Certificate Manager. Add a Samsung TV profile and sign in with your Samsung developer account.')}${instruction(2, 'Include this TV’s DUID', 'Add your TV’s unique device ID to the distributor certificate. Back up your author certificate outside this project.')}${instruction(3, 'Permit app installation', 'In Device Manager, connect the TV. Right-click its device or filesystem entry and choose “Permit to install applications”.')}<div class="actions">${link(docs.cert, 'Certificate walkthrough')}</div></div>` +
      `<div class="panel"><h3>Ready to sign?</h3><div class="actions">${info?.sdk?.gui?.includes('certificate-manager') ? actionButton('open-certificate-manager', 'Open Certificate Manager') : ''}${info?.sdk?.gui?.includes('device-manager') ? actionButton('open-device-manager', 'Open Device Manager') : ''}</div>${check('cert-tv', 'I created a Samsung TV certificate')}${check('cert-duid', 'It includes this TV’s DUID')}${check('cert-permit', 'This TV permits app installation')}<div class="actions">${actionButton('profiles-samsung', 'Show my profiles', !info?.sdk)}</div><div class="field"><br>${field('profile', 'Certificate profile name', 'LanternfinTV', 'Use the exact profile name from Certificate Manager. No certificate password is entered here.')}</div>${lastJob?.result?.profiles ? `<details open><summary>Your certificate profiles</summary><pre>${esc(lastJob.result.profiles)}</pre></details>` : ''}<div class="actions">${actionButton('sign-samsung', 'Build & sign my app', !certificateReady() || !info?.sdk || !info?.projectTools, true)}</div></div></div>` +
      `<div class="callout">${signed() ? '✓ A newly signed Lanternfin package is ready for installation.' : 'The unsigned preview download cannot be installed directly. This step creates a fresh signed package using your chosen profile.'}</div><div class="actions between"><button class="link-button" data-go="connect">← TV connection</button>${goButton('install', 'Continue to installation', !signed() || !paired())}</div>`
  } else if (state.page === 'install') {
    const lg = state.brand === 'lg', ready = paired() && (lg ? info?.lgPackage : signed())
    content.innerHTML = heading('ALMOST ON THE COUCH', 'Meet your TV’s <em>new player.</em>', 'Install the Lanternfin preview on the TV you connected. Your streams are added inside the app after it opens.') +
      `<div class="split"><div class="panel"><div class="section-heading"><h2>Lanternfin TV</h2>${pill(installed(), 'Installed', 'Preview 0.1.0')}</div><p class="muted">Standalone playback · your own playlists · remote-friendly controls</p>` +
      toolRow('Destination', `${lg ? 'LG webOS' : 'Samsung Tizen'} · ${esc(state.ip || 'No TV address entered')}`, paired(), pill(paired(), 'Connected', 'Connect first')) +
      toolRow('App package', lg ? 'LG developer installer (.ipk)' : 'Samsung signed widget (.wgt)', lg ? info?.lgPackage : signed()) +
      `<div class="actions">${actionButton(lg ? 'install-lg' : 'install-samsung', installed() ? 'Reinstall Lanternfin' : 'Install Lanternfin', !ready, true)}${lg ? actionButton('build-lg', 'Build latest app', !info?.projectTools || !info?.lgTools) : ''}</div>${!ready ? '<p class="muted">Finish connection and package preparation before installing.</p>' : ''}</div>` +
      `<div class="panel soft">${tvArt(state.brand)}<div class="callout">Keep the TV awake and on the same network until installation finishes. This is a development preview; playback support still needs testing on your model.</div></div></div>` +
      `<div class="actions between"><button class="link-button" data-go="${lg ? 'connect' : 'certificate'}">← ${lg ? 'TV connection' : 'Samsung signing'}</button>${goButton('watch', 'Open it on my TV', !installed())}</div>`
  } else {
    const launched = state.launched[key()]
    content.innerHTML = heading('THE BEST PART', 'Make yourself <em>at home.</em>', 'Open Lanternfin, add your own playlist, and give your first stream a try. No phone or casting receiver needed.') +
      `<div class="done-hero"><span class="done-icon" aria-hidden="true">${launched ? '✓' : '▷'}</span><div><h2>${launched ? 'The launch command was accepted.' : installed() ? 'Lanternfin is installed.' : 'Your TV is almost ready.'}</h2><p class="muted">${launched ? 'Check your TV for the Lanternfin welcome screen.' : 'Use the button below to open the app on your TV.'}</p>${actionButton(state.brand === 'lg' ? 'launch-lg' : 'launch-samsung', launched ? 'Open Lanternfin again' : 'Launch on my TV', !installed(), true)}</div></div>` +
      `<div class="check-grid"><div class="panel"><h3>Your first watch</h3>${instruction(1, 'Add a source', 'Choose M3U playlist, Xtream playlist login, or a direct stream in Lanternfin.')}${instruction(2, 'Use your remote', 'Arrows move, OK selects, and Back returns. Try search and stream groups.')}${instruction(3, 'Test a stream', 'Start with H.264/AAC in HLS or MP4. Formats and provider access depend on your TV.')}</div><div class="panel soft"><h3>Check these before settling in</h3>${check('watch-home', 'I see Lanternfin on the TV')}${check('watch-play', 'Picture and sound are working')}${check('watch-back', 'Back and the remote work as expected')}<p class="muted">These are your checks on real hardware. A successful install alone does not confirm playback.</p>${trouble()}</div></div><div class="actions"><button class="secondary" data-go="choose">Set up another TV</button><button class="link-button" data-go="install">Back to installation</button></div>`
  }
  if (busy) content.querySelectorAll('button, input, select').forEach(node => { node.disabled = true })
  if (focusedCheck) content.querySelector(`[data-check="${CSS.escape(focusedCheck)}"]`)?.focus({ preventScroll: true })
  remember()
}
function navigate(page) { state.page = page; render(); $('content').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }) }
function showJob(job) {
  if (!job) return
  lastJob = job; busy = job.state === 'running'
  $('activity').hidden = false; $('activity').className = `activity ${job.state}`
  $('activity-message').textContent = job.message
  $('activity-symbol').textContent = busy ? '' : job.state === 'succeeded' ? '✓' : '!'
  $('activity-log').textContent = job.logs.join('\n') || 'No additional details.'
  $('cancel').hidden = !busy
  $('cancel').disabled = false
  $('activity-help').hidden = !['failed', 'cancelled'].includes(job.state)
  $('activity-help').textContent = job.state === 'cancelled' ? 'If an install had started, look at the TV before retrying.' : 'Review the details below. For connection problems, check the TV address, Developer Mode, and restart. For Samsung signing, check the profile name, target DUID, and installation permission.'
}
async function poll() {
  try {
    const { job } = await api('job')
    showJob(job)
    if (job?.state === 'running') pollTimer = setTimeout(poll, 650)
    else {
      if (job?.state === 'succeeded' && job.action.startsWith('launch-')) state.launched[key()] = true
      await refresh()
    }
  } catch (error) { busy = false; problem(error.message); render() }
}
async function runAction(action) {
  if (busy) return
  let passphrase = $('passphrase')?.value || ''
  const params = { ip: state.ip, sdkRoot: state.sdkRoot, profile: state.profile, devModeConfirmed: devReady(), certificateConfirmed: certificateReady(), ...(action === 'pair-lg' ? { passphrase } : {}) }
  if ($('passphrase')) $('passphrase').value = ''
  busy = true; render(); showJob({ action, state: 'running', message: 'Starting…', logs: [] })
  try { await api('actions', { action, params }); clearTimeout(pollTimer); await poll() }
  catch (error) { busy = false; showJob({ action, state: 'failed', message: error.message, logs: [] }); render() }
  finally { passphrase = ''; params.passphrase = '' }
}
document.addEventListener('click', async event => {
  const target = event.target.closest('button, .brand')
  if (!target || target.disabled) return
  if (target.classList.contains('brand')) { event.preventDefault(); if (!busy) navigate('choose') }
  else if (target.dataset.brand) { state.brand = target.dataset.brand; state.ip = ''; state.checks = {}; navigate('tools') }
  else if (target.dataset.go) navigate(target.dataset.go)
  else if (target.dataset.action) await runAction(target.dataset.action)
  else if (target.hasAttribute('data-refresh')) await refresh()
  else if (target.hasAttribute('data-copy-ip')) {
    try { await navigator.clipboard.writeText(state.pcIp); target.textContent = 'Address copied ✓' } catch { target.textContent = 'Select and copy the address above' }
  }
})
document.addEventListener('input', event => {
  const model = event.target.dataset.model
  if (model && ['ip', 'sdkRoot', 'profile', 'pcIp'].includes(model)) {
    state[model] = event.target.value; remember()
    if (model === 'pcIp') $('pc-readout').textContent = state.pcIp
    if (model === 'ip' && state.page === 'connect') {
      const status = $('content').querySelector('.section-heading .status-pill')
      if (status) status.outerHTML = pill(paired(), 'Connected', 'Not checked')
      $('content').querySelectorAll('[data-go="install"], [data-go="certificate"]').forEach(node => { node.disabled = !paired() })
    }
    if (model === 'profile' && state.page === 'certificate') {
      const status = $('content').querySelector('.callout'); if (status) status.textContent = signed() ? '✓ A newly signed Lanternfin package is ready for installation.' : 'Sign a fresh package using this profile before continuing.'
      $('content').querySelectorAll('[data-go="install"]').forEach(node => { node.disabled = !signed() || !paired() })
    }
  }
})
document.addEventListener('change', event => {
  if (event.target.dataset.check) { state.checks[event.target.dataset.check] = event.target.checked; render() }
  if (event.target.dataset.model === 'sdkRoot') refresh()
})
$('cancel').onclick = async () => { try { await api('cancel', {}); $('cancel').disabled = true } catch (error) { problem(error.message) } }
$('quit').onclick = async () => {
  try { await api('shutdown', {}); clearTimeout(pollTimer); $('content').innerHTML = heading('UNTIL NEXT TIME', 'See you on the <em>big screen.</em>', 'Setup is closed. You can close this tab and reopen the desktop shortcut whenever you need it.'); $('steps').innerHTML = ''; $('activity').hidden = true; $('quit').disabled = true; token = ''; sessionStorage.removeItem('lanternfin.setup.token') }
  catch (error) { problem(error.message) }
}
render()
if (!token) problem('Open this guide using the Lanternfin TV Setup shortcut. Each launch creates a private local session.')
else { await refresh(); const { job } = await api('job').catch(() => ({ job: null })); if (job) { showJob(job); render(); if (job.state === 'running') poll() } }
setInterval(() => { if (token && !document.hidden && !busy) refresh(false) }, 60000)
