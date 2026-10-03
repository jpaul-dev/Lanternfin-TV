import type { DiagnosticReport } from './diagnostics'

export function diagnosticsUI(root: HTMLElement, report: () => DiagnosticReport, clear: () => void) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#diagnostics-${id}`)!
  let text = '', generation = 0
  const status = (value: string) => { el('status').textContent = value }
  const render = () => {
    const data = report(); text = JSON.stringify(data, null, 2); el<HTMLTextAreaElement>('text').value = text
    el('build').textContent = `${data.app.target === 'webos' ? 'LG webOS' : data.app.target === 'tizen' ? 'Samsung Tizen' : 'Browser'} · ${data.app.version} · ${data.app.commit.slice(0, 8)}${data.app.modified ? ' · local changes' : ''}`
    const facts = el('facts'); facts.replaceChildren()
    const rows = [
      ['Network', data.capabilities.online ? 'Device reports online' : 'Device reports offline'],
      ['Adaptive video', data.capabilities.mediaSource ? 'Media Source API available' : 'Media Source API unavailable'],
      ['Protected playback', data.capabilities.encryptedMediaAPI ? 'DRM API available · provider/device test needed' : 'DRM API unavailable in this environment'],
      ['Samsung player', data.samsungPlayer ? 'AVPlay available' : 'AVPlay unavailable'],
      ['Encrypted backups', data.capabilities.encryptedBackup ? 'Encryption API available' : 'Encryption API unavailable'],
      ['Screen saver', data.screenSaver === 'unavailable' ? 'Managed by this platform' : data.screenSaver === 'on' ? 'Enabled' : data.screenSaver === 'off' ? 'Disabled during playback' : data.screenSaver === 'failed' ? 'TV request failed' : 'Waiting for TV'],
    ]
    for (const [name, value] of rows) { const row = document.createElement('div'); row.className = 'account-row'; const label = document.createElement('dt'), detail = document.createElement('dd'); label.textContent = name; detail.textContent = value; row.append(label, detail); facts.append(row) }
    const codecs = el('codecs'); codecs.replaceChildren()
    for (const codec of data.capabilities.codecs) {
      const row = document.createElement('tr')
      for (const value of [codec.name, codec.native === 'not-reported' ? 'Not reported' : codec.native === 'probably' ? 'Likely' : 'Maybe', codec.mediaSource ? 'Reported' : 'Not reported']) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell) }
      codecs.append(row)
    }
    const stream = data.playback.stream, stats = data.playback.player, events = data.playback.events
    el('playback').textContent = stream ? `${stream.kind} · ${stream.format} · ${stats.engine || 'player not selected'} · ${stream.drm === 'none' ? 'Unprotected' : stream.drm} · ${stream.mediaHeaders} media headers · ${stream.licenseHeaders} license headers` : 'No playback recorded in this session.'
    el('stats').textContent = [stats.width && stats.height ? `${stats.width} × ${stats.height}` : '', stats.droppedFrames === undefined ? '' : `${stats.droppedFrames} dropped frames`, stats.bufferedSeconds === undefined ? '' : `${stats.bufferedSeconds}s buffered`, stats.bandwidth === undefined ? '' : `${(stats.bandwidth / 1e6).toFixed(1)} Mbps estimated`].filter(Boolean).join(' · ')
    el('events').textContent = events.slice(-12).map(event => `${event.seconds}s · ${event.state}${event.code === undefined ? '' : ` · code ${event.code}`}`).join('\n') || 'Playback events will appear here.'
  }
  el('refresh').onclick = () => { render(); status('Device report refreshed.') }
  el('clear').onclick = () => { clear(); render(); status('Session diagnostics cleared.') }
  el('show').onclick = () => { const show = el('report').hidden; el('report').hidden = !show; el('show').setAttribute('aria-expanded', String(show)); if (show) el('text').focus() }
  el('copy').onclick = async () => {
    const token = generation
    try { if (!navigator.clipboard?.writeText) throw new Error(); await navigator.clipboard.writeText(text); if (token === generation) status('Diagnostic report copied. You can review it before sharing.') }
    catch { if (token === generation) { el('report').hidden = false; el('show').setAttribute('aria-expanded', 'true'); el('text').focus(); status('Clipboard unavailable. Select the report with a keyboard, or use Save report where supported.') } }
  }
  el('save').onclick = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'Lanternfin-diagnostics.json'; anchor.hidden = true; root.append(anchor); anchor.click(); anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30000); status('Save requested. If this TV does not support file downloads, copy or view the report.')
  }
  return { open() { generation++; el('report').hidden = true; el('show').setAttribute('aria-expanded', 'false'); status(''); render() }, close() { generation++; text = ''; el<HTMLTextAreaElement>('text').value = '' } }
}
