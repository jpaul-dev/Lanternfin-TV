// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { samsungPlayReady, samsungPlayReadyPlan, needsSamsungPlayReady } from '../tv-app/samsung-drm'
import { samsungPlayer, type AVPlay } from '../tv-app/player'
import { providerMedia, type Media } from '../tv-app/media'
import { createServer } from 'node:http'

const media = (drm: object = {}, headers: Record<string, string> = { 'User-Agent': 'media-agent', Cookie: 'media-cookie' }): Media => ({ url: 'https://media.example/movie.mpd', playback: { headers, drm: { system: 'com.microsoft.playready', licenseUrl: 'https://license.example/rights', headers: { Authorization: 'license-token' }, ...drm } } })
const tick = async () => { for (let count = 0; count < 40; count++) await Promise.resolve() }
function fixture(input = media()) {
  vi.useFakeTimers()
  const api = { setDrm: vi.fn() } as unknown as AVPlay, fail = vi.fn()
  const plan = samsungPlayReadyPlan(input)!
  const session = samsungPlayReady(api, plan, fail)
  session.configure()
  const challenge = (value = 'AAH/Ag==') => session.event('PLAYREADY', { name: 'Challenge', challenge: value, serverurl: 'https://untrusted.example/never-contact' })
  return { api, plan, session, fail, challenge }
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

it('routes only complete supported native-header PlayReady DASH configurations', () => {
  expect(needsSamsungPlayReady(media())).toBe(true)
  expect(needsSamsungPlayReady(media({}, {}))).toBe(false)
  expect(needsSamsungPlayReady(media({ headers: { Cookie: 'license-cookie' } }, {}))).toBe(true)
  for (const input of [media({ system: 'com.widevine.alpha' }), media({ system: 'org.w3.clearkey' }), media({ licenseUrl: undefined }), media({ clearKeys: {} }), media({ licenseUrl: 'file:///secret' }), media({ licenseUrl: 'https://user:pass@example.com' }), media({}, { Referer: 'https://example.com' }), media({}, { Authorization: 'media' }), media({ headers: { Cookie: 'license', Authorization: 'token' } }), media({ headers: { Cookie: 'license' }, format: { response: 'B' } }), media({ headers: { Origin: 'https://example.com' } }), media({ headers: { 'X-Bad': 'line\r\nbreak' } }), media({ headers: { Authorization: 'one', authorization: 'two' } }), media({ format: { request: 'R{SID}' } })]) expect(samsungPlayReadyPlan(input)).toBeUndefined()
  const hls = media(); hls.url = 'https://example.com/a.m3u8'; expect(samsungPlayReadyPlan(hls)).toBeUndefined()
  const extensionless = media(); extensionless.url = 'https://example.com/play'; extensionless.playback!.manifestType = 'mpd'; expect(samsungPlayReadyPlan(extensionless)).toBeDefined()
  extensionless.playback!.problem = 'Unsupported provider options'; expect(samsungPlayReadyPlan(extensionless)).toBeUndefined()
  const parsed = providerMedia({ url: 'https://example.com/a.mpd|User-Agent=media', drmScheme: 'playready', licenseKey: 'https://license.example/|Authorization=license|{"challenge":"b{SSM}"}|JBlicense' }, 'https://example.com')
  expect(needsSamsungPlayReady(parsed)).toBe(true); expect(samsungPlayReadyPlan(parsed)?.format).toEqual({ request: '{"challenge":"b{SSM}"}', response: 'JBlicense' })
})

it('lets native GetRights handle raw Cookie/User-Agent license requests without a browser request', () => {
  const request = vi.fn(); vi.stubGlobal('fetch', request)
  const h = fixture(media({ headers: { Cookie: 'license-cookie', 'User-Agent': 'license-agent' } }))
  expect(h.api.setDrm).toHaveBeenCalledWith('PLAYREADY', 'SetProperties', JSON.stringify({ DeleteLicenseAfterUse: true, LicenseServer: 'https://license.example/rights', Cookie: 'license-cookie', UserAgent: 'license-agent' }))
  expect(h.plan.challenge).toBe(false); expect(request).not.toHaveBeenCalled()
  h.challenge(); expect(h.fail).toHaveBeenCalledWith(expect.stringContaining('unexpected')); expect(request).not.toHaveBeenCalled()
  expect(samsungPlayReadyPlan(media({ headers: { 'User-Agent': 'license-only-agent' } }))?.properties).toMatchObject({ Cookie: '', UserAgent: 'license-only-agent' })
})

it('preserves raw binary challenges and licenses, separates authorization and ignores event-supplied URLs', async () => {
  const request = vi.fn(async () => new Response(Uint8Array.from([255, 0, 128, 1]))); vi.stubGlobal('fetch', request)
  const h = fixture(); h.challenge(); await tick()
  expect(h.api.setDrm).toHaveBeenNthCalledWith(1, 'PLAYREADY', 'SetProperties', '{"DeleteLicenseAfterUse":true,"GetChallenge":true}')
  const [url, options] = request.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('https://license.example/rights'); expect(options).toMatchObject({ method: 'POST', headers: { 'content-type': 'text/xml', authorization: 'license-token' }, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' })
  expect([...options.body as Uint8Array]).toEqual([0, 1, 255, 2]); expect(JSON.stringify(options)).not.toMatch(/media-agent|media-cookie/)
  expect(h.api.setDrm).toHaveBeenLastCalledWith('PLAYREADY', 'InstallLicense', '/wCAAQ=='); expect(h.fail).not.toHaveBeenCalled(); h.session.close()
})

it('applies existing bounded license wrappers only to the license exchange', async () => {
  const request = vi.fn(async () => new Response('{"license":"/wCAAQ=="}')); vi.stubGlobal('fetch', request)
  const h = fixture(media({ headers: { 'Content-Type': 'application/json', Authorization: 'wrapped-token' }, format: { request: '{"challenge":"b{SSM}"}', response: 'JBlicense' } }))
  h.challenge(); await tick()
  const options = request.mock.calls[0][1] as RequestInit
  expect(new TextDecoder().decode(options.body as Uint8Array)).toBe('{"challenge":"AAH/Ag=="}')
  expect(options.headers).toEqual({ 'content-type': 'application/json', authorization: 'wrapped-token' }); expect(h.api.setDrm).toHaveBeenLastCalledWith('PLAYREADY', 'InstallLicense', '/wCAAQ=='); h.session.close()
})

it('cancels a pending exchange and ignores late provider and native callbacks', async () => {
  let finish!: (value: Response) => void
  const request = vi.fn(() => new Promise<Response>(resolve => { finish = resolve })); vi.stubGlobal('fetch', request)
  const h = fixture(); h.challenge(); const signal = (request.mock.calls[0][1] as RequestInit).signal!
  h.session.close(); expect(signal.aborted).toBe(true)
  h.session.configure(); expect(h.api.setDrm).toHaveBeenCalledTimes(1)
  const cancel = vi.fn(); finish(new Response(new ReadableStream({ cancel }))); await tick()
  h.challenge('AQ=='); h.session.event('PLAYREADY', { name: 'DrmError', message: 'secret' })
  expect(cancel).toHaveBeenCalledOnce(); expect(h.api.setDrm).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledOnce(); expect(h.fail).not.toHaveBeenCalled()
})

it('times out nonresponsive license requests even if the transport ignores abort', async () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  const h = fixture(); h.challenge(); await vi.advanceTimersByTimeAsync(20000)
  expect(h.fail).toHaveBeenCalledOnce(); expect(h.fail).toHaveBeenCalledWith(expect.stringContaining('timed out')); expect(h.api.setDrm).toHaveBeenCalledTimes(1)
})

it('cancels stalled response reads and applies the deadline during response streaming', async () => {
  const cancel = vi.fn(); vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])) }, cancel }))))
  const h = fixture(); h.challenge(); await tick(); await vi.advanceTimersByTimeAsync(20000)
  expect(cancel).toHaveBeenCalledOnce(); expect(h.fail).toHaveBeenCalledOnce(); expect(h.api.setDrm).toHaveBeenCalledTimes(1)
})
it('reads many small license chunks cooperatively without losing bytes', async () => {
  let sent = 0
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ pull(controller) { if (sent === 1024) controller.close(); else controller.enqueue(new Uint8Array([sent++ % 256])) } }))))
  const h = fixture(); h.challenge(); await vi.advanceTimersByTimeAsync(10)
  expect(h.fail).not.toHaveBeenCalled(); expect(h.api.setDrm).toHaveBeenLastCalledWith('PLAYREADY', 'InstallLicense', Buffer.from(Uint8Array.from({ length: 1024 }, (_, index) => index % 256)).toString('base64')); h.session.close()
})
it('exchanges a wrapped binary challenge over actual HTTP before installing the returned license', async () => {
  let received: { url?: string; headers: Record<string, unknown>; body: string } | undefined
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk)
    received = { url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString('utf8') }
    response.setHeader('Content-Type', 'application/json'); response.end('{"license":"/wCAAQ=="}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const h = fixture(media({ licenseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/rights`, headers: { Authorization: 'local-test', 'Content-Type': 'application/json' }, format: { request: '{"challenge":"b{SSM}"}', response: 'JBlicense' } }))
  vi.useRealTimers()
  try {
    let finish!: (value: string) => void; const installed = new Promise<string>(resolve => { finish = resolve })
    vi.mocked(h.api.setDrm!).mockImplementation((_type, operation, value) => { if (operation === 'InstallLicense') finish(value) })
    h.challenge(); expect(await installed).toBe('/wCAAQ==')
    expect(received).toMatchObject({ url: '/rights', headers: { authorization: 'local-test', 'content-type': 'application/json' }, body: '{"challenge":"AAH/Ag=="}' })
    expect(received!.headers.cookie).toBeUndefined(); expect(received!.headers['user-agent']).not.toBe('media-agent'); expect(h.fail).not.toHaveBeenCalled()
  } finally { h.session.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

it('rejects malformed/oversized challenges before issuing a request', () => {
  const request = vi.fn(); vi.stubGlobal('fetch', request)
  for (const challenge of ['', 'not-base64!', 'A', 'A'.repeat(700000), {}, null]) {
    const h = fixture(); h.session.event('PLAYREADY', { name: 'Challenge', challenge }); expect(h.fail).toHaveBeenCalledOnce(); expect(h.api.setDrm).toHaveBeenCalledTimes(1)
  }
  expect(request).not.toHaveBeenCalled()
})

it('limits overlapping challenges, ignores duplicates and serializes renewals', async () => {
  const finish: Array<(value: Response) => void> = [], request = vi.fn(() => new Promise<Response>(resolve => finish.push(resolve))); vi.stubGlobal('fetch', request)
  const h = fixture(); h.challenge('AQ=='); h.challenge('AQ=='); h.challenge('Ag=='); h.challenge('Aw==')
  expect(request).toHaveBeenCalledOnce(); finish[0](new Response('one')); await tick(); expect(request).toHaveBeenCalledTimes(2)
  finish[1](new Response('two')); await tick(); expect(request).toHaveBeenCalledTimes(3)
  finish[2](new Response('three')); await tick(); expect(h.api.setDrm).toHaveBeenCalledTimes(4); expect(h.fail).not.toHaveBeenCalled(); h.session.close()
  const overloaded = fixture(); for (const challenge of ['AQ==', 'Ag==', 'Aw==', 'BA==', 'BQ==']) overloaded.challenge(challenge)
  expect(overloaded.fail).toHaveBeenCalledOnce(); expect(overloaded.fail).toHaveBeenCalledWith(expect.stringContaining('simultaneous'))
})

it('rejects HTTP failures and empty, excessive or invalid wrapped licenses without raw diagnostics', async () => {
  for (const response of [new Response('secret', { status: 403 }), new Response(), new Response('secret', { headers: { 'content-length': String(4 * 1024 * 1024 + 1) } }), new Response(new Uint8Array(4 * 1024 * 1024 + 1))]) {
    vi.stubGlobal('fetch', vi.fn(async () => response)); const h = fixture(); h.challenge(); await tick(); expect(h.api.setDrm).toHaveBeenCalledTimes(1); expect(h.fail).toHaveBeenCalledOnce(); expect(JSON.stringify(h.fail.mock.calls)).not.toMatch(/secret|example|license-token/)
  }
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"license":"invalid!!"}')))
  const h = fixture(media({ format: { response: 'JBlicense' } })); h.challenge(); await tick(); expect(h.fail).toHaveBeenCalledWith(expect.stringContaining('format')); expect(h.api.setDrm).toHaveBeenCalledTimes(1)
})

it('handles explicit native failures without exposing native data or installing later licenses', async () => {
  for (const failure of [false, 'FALSE']) {
    const h = fixture(); vi.mocked(h.api.setDrm!).mockReturnValue(failure); h.session.configure(); expect(h.fail).toHaveBeenCalledWith(expect.stringContaining('configure'))
  }
  vi.stubGlobal('fetch', vi.fn(async () => new Response('license')))
  const h = fixture(); vi.mocked(h.api.setDrm!).mockImplementation(() => { throw new Error('secret native message') }); h.challenge(); await tick(); expect(h.fail).toHaveBeenCalledWith(expect.stringContaining('rejected')); expect(JSON.stringify(h.fail.mock.calls)).not.toContain('secret')
  const event = fixture(); event.session.event('WIDEVINE_CDM', { name: 'DrmError' }); expect(event.fail).not.toHaveBeenCalled(); event.session.event('PLAYREADY', { name: 'DrmError', message: 'secret' }); expect(event.fail).toHaveBeenCalledOnce()
})

it('configures DRM before preparation, keeps media credentials native, and tears down on a DRM error', async () => {
  vi.useFakeTimers(); let state = 'NONE'; let listener: Record<string, (...args: any[]) => void> = {}, ready!: () => void
  const api: AVPlay = { open: vi.fn(() => { state = 'IDLE' }), close: vi.fn(() => { state = 'NONE' }), stop: vi.fn(), play: vi.fn(), pause: vi.fn(), getState: () => state, getDuration: () => 100000, getCurrentTime: () => 0, setDisplayRect: vi.fn(), setDisplayMethod: vi.fn(), setStreamingProperty: vi.fn(), setDrm: vi.fn(), setListener: value => { listener = value }, prepareAsync: vi.fn(success => { ready = success }), seekTo: vi.fn() }
  const report = vi.fn(), player = samsungPlayer(api, report); player.play(media())
  expect(api.setStreamingProperty).toHaveBeenCalledWith('USER_AGENT', 'media-agent'); expect(api.setStreamingProperty).toHaveBeenCalledWith('COOKIE', 'media-cookie')
  expect(vi.mocked(api.setDrm!).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.prepareAsync).mock.invocationCallOrder[0])
  const request = vi.fn(() => new Promise<Response>(() => {})); vi.stubGlobal('fetch', request)
  listener.ondrmevent('PLAYREADY', { name: 'Challenge', challenge: 'AQ==' }); listener.ondrmevent('PLAYREADY', { name: 'DrmError', message: 'native secret' }); ready()
  expect((request.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true); expect(api.getState()).toBe('NONE'); expect(api.play).not.toHaveBeenCalled(); expect(report).toHaveBeenLastCalledWith('error', expect.stringContaining('PlayReady failed')); await tick()
  player.play(media()); const old = listener; player.stop(); old.ondrmevent('PLAYREADY', { name: 'Challenge', challenge: 'AQ==' }); expect(request).toHaveBeenCalledOnce()
})
