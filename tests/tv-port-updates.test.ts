import { afterEach, expect, it, vi } from 'vitest'
import { checkUpdates, tvReleases } from '../tv-app/updates'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const release = (names: string[], extra = {}) => ({ name: 'TV release', tag_name: 'tv-v0.2.0', html_url: 'https://github.com/jpaul-dev/Lanternfin-TV/releases/tag/tv-v0.2.0', draft: false, prerelease: true, assets: names.map(name => ({ name, state: 'uploaded', size: 10000 })), ...extra })
it('filters Android, unsigned widgets, drafts and foreign links and keeps only bounded plain release data', () => {
  const values = [release(['app.apk']), release(['Lanternfin-TV-0.1.0-tizen-UNSIGNED.wgt']), release(['io.github.jpauldev.lanternfin_0.2.0_all.ipk'], { draft: true }), release(['io.github.jpauldev.lanternfin_0.2.0_all.ipk'], { html_url: 'https://evil.test' }), release(['io.github.jpauldev.lanternfin_0.2.0_all.ipk', 'Lanternfin-TV-0.2.0-tizen.wgt'], { name: '<b>Untrusted</b>', body: 'ignored private text' })]
  expect(tvReleases(values)).toEqual([{ name: '<b>Untrusted</b>', url: values[4].html_url, prerelease: true, targets: ['webos', 'tizen'] }])
  expect(() => tvReleases(Array(21).fill(values[4]))).toThrow()
})
it('checks only fixed public endpoints without credentials or viewing data', async () => {
  const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/releases?') ? [] : { object: { sha: 'a'.repeat(40) } })))
  vi.stubGlobal('fetch', fetch)
  const result = await checkUpdates(new AbortController().signal)
  expect(result).toEqual({ commit: 'a'.repeat(40), releases: [], errors: [] })
  expect(fetch).toHaveBeenCalledTimes(2)
  for (const [url, options] of fetch.mock.calls as any[]) {
    expect(url).toMatch(/^https:\/\/api.github.com\/repos\/jpaul-dev\/Lanternfin-TV\//)
    expect(options.credentials).toBe('omit'); expect(options.referrerPolicy).toBe('no-referrer'); expect(options.redirect).toBe('error')
    expect(options.headers).toEqual({ Accept: 'application/vnd.github+json' }); expect(options.body).toBeUndefined()
  }
})
it('reports partial failures without declaring the app up to date or echoing server details', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/releases?') ? new Response('private token', { status: 403 }) : new Response(JSON.stringify({ object: { sha: 'a'.repeat(40) } }))))
  const result = await checkUpdates(new AbortController().signal)
  expect(result.commit).toHaveLength(40); expect(result.releases).toBeUndefined(); expect(result.errors).toHaveLength(1)
  expect(JSON.stringify(result)).not.toContain('private')
})
it('bounds oversized bodies and cancels stalled response reads after fifteen seconds', async () => {
  vi.useFakeTimers()
  const cancel = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/releases?') ? new Response('x'.repeat(1024 * 1024 + 1)) : new Response(new ReadableStream({ cancel }))))
  const pending = checkUpdates(new AbortController().signal)
  await vi.advanceTimersByTimeAsync(15000)
  const result = await pending; expect(result.errors).toHaveLength(2); expect(cancel).toHaveBeenCalled()
})
it('cancels a superseded check and never returns a late success', async () => {
  const cancel = vi.fn(), controller = new AbortController()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel }))))
  const pending = checkUpdates(controller.signal), assertion = expect(pending).rejects.toThrow('canceled')
  await Promise.resolve(); controller.abort(); await assertion
  expect(cancel).toHaveBeenCalledTimes(2)
})
