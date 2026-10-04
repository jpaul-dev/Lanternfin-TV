// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { buildInfo, capabilities, PlaybackDiagnostics, safeStats } from '../tv-app/diagnostics'
import { diagnosticsUI } from '../tv-app/diagnostics-ui'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('never exports provider URLs, titles, header names/values, key material or raw errors', () => {
  const log = new PlaybackDiagnostics(), secret = 'PRIVATE-CREDENTIAL'
  log.begin({ url: `https://provider.test/${secret}.mpd?token=${secret}`, mediaKind: secret as any, playback: { manifestType: secret, headers: { [secret]: secret }, drm: { system: secret, licenseUrl: `https://${secret}/license`, headers: { Authorization: secret }, clearKeys: { [secret]: secret }, format: { request: secret } } } }, secret)
  log.record('error', `URL=https://${secret} (code 6007) ${secret}`)
  log.sample({ engine: secret as any, width: 1920, height: Infinity, bandwidth: NaN, droppedFrames: -1, decodedFrames: 125, token: secret } as any)
  const data = log.snapshot(), text = JSON.stringify(data)
  expect(text).not.toContain(secret); expect(text).not.toContain('provider.test'); expect(text).not.toContain('Authorization')
  expect(data).toMatchObject({ stream: { source: 'unknown', kind: 'unknown', drm: 'other', format: 'mpd', mediaHeaders: 1, licenseHeaders: 1, licenseWrapper: true }, player: { width: 1920, decodedFrames: 125 } })
  expect(data.events.at(-1)).toMatchObject({ state: 'error', code: 6007 })
  expect(safeStats({ bufferedSeconds: 5.234, width: 1e20 })).toEqual({ bufferedSeconds: 5.2 })
})
it('bounds session events, deduplicates repeated states and clears collected data', () => {
  const log = new PlaybackDiagnostics()
  log.record('playing'); log.record('playing'); expect(log.snapshot().events).toHaveLength(1)
  for (let i = 0; i < 200; i++) log.record(i % 2 ? 'buffering' : 'playing')
  expect(log.snapshot().events).toHaveLength(80)
  const snapshot = log.snapshot(); snapshot.events[0].state = 'open'; expect(log.snapshot().events[0].state).not.toBe('open')
  log.clear(); expect(log.snapshot()).toEqual({ events: [], player: {} })
})
it('checks only local capability signals and tolerates broken device APIs', () => {
  const video = document.createElement('video'), request = vi.fn(), fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  vi.spyOn(video, 'canPlayType').mockImplementation(mime => { if (mime.includes('avc1')) return 'probably'; throw new Error('device detail') })
  const win = { isSecureContext: true, crypto: {}, MediaSource: { isTypeSupported: () => { throw new Error() } } } as any
  const result = capabilities(video, win, { onLine: true, requestMediaKeySystemAccess: request } as any)
  expect(result).toMatchObject({ mediaSource: true, encryptedMediaAPI: true, encryptedBackup: false })
  expect(result.codecs[0]).toEqual({ name: 'H.264 video', native: 'probably', mediaSource: false })
  expect(request).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  expect(buildInfo('webos')).toMatchObject({ target: 'webos', commit: 'development', modified: true })
})
it('shows a reviewable report, offers copy fallback and clears session details', async () => {
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  const log = new PlaybackDiagnostics(); log.begin({ url: 'https://example.com/a.m3u8' }, 'playlist'); log.record('error', 'Error (code 1001)')
  const report = () => ({ schema: 1 as const, app: buildInfo('browser'), capabilities: capabilities(document.createElement('video')), samsungPlayer: false, screenSaver: 'unavailable', playback: log.snapshot() })
  const root = document.getElementById('diagnostics')!, ui = diagnosticsUI(root, report, () => log.clear())
  ui.open(); expect(root.textContent).toContain('code 1001')
  const click = (id: string) => (root.querySelector(`#diagnostics-${id}`) as HTMLButtonElement).click()
  click('copy'); await Promise.resolve(); expect(root.querySelector<HTMLElement>('#diagnostics-report')!.hidden).toBe(false)
  expect(root.querySelector<HTMLTextAreaElement>('#diagnostics-text')!.value).not.toContain('example.com')
  click('clear'); expect(root.textContent).not.toContain('code 1001'); expect(root.textContent).toContain('No playback recorded')
  ui.close(); expect(root.querySelector<HTMLTextAreaElement>('#diagnostics-text')!.value).toBe('')
})
