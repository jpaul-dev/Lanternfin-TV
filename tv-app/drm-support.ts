/** An explicit capability query only: no MediaKeys, sessions, media or licenses. */
export const DRM_SYSTEMS = { 'com.widevine.alpha': 'Widevine', 'com.microsoft.playready': 'PlayReady', 'org.w3.clearkey': 'Clear Key' } as const
export type DRMSystem = keyof typeof DRM_SYSTEMS
export type DRMStatus = 'available' | 'not-supported' | 'blocked' | 'unavailable' | 'timeout' | 'error'
export type DRMResult = { system: DRMSystem; status: DRMStatus }
export type DRMReport = { profile: 'mp4-avc-aac-temporary-no-persistence'; results: DRMResult[] }
type Request = Pick<Navigator, 'requestMediaKeySystemAccess'>

function configuration(): MediaKeySystemConfiguration {
  return { initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }], sessionTypes: ['temporary'], persistentState: 'not-allowed', distinctiveIdentifier: 'not-allowed' }
}
const cancelled = () => new Error('DRM check cancelled.')

export class DRMSupport {
  // EME has no abort API. Reuse unresolved requests after cancellation/timeout,
  // so repeated checks cannot accumulate more than three native operations.
  private pending = new Map<DRMSystem, Set<(status: DRMStatus) => void>>()
  constructor(private nav: Request = navigator) {}
  private watch(system: DRMSystem, listener: (status: DRMStatus) => void) {
    let listeners = this.pending.get(system)
    if (!listeners) {
      listeners = new Set(); this.pending.set(system, listeners)
      const current = listeners
      const work = Promise.resolve().then(async (): Promise<DRMStatus> => {
        try {
          if (typeof this.nav.requestMediaKeySystemAccess !== 'function') return 'unavailable'
          await this.nav.requestMediaKeySystemAccess(system, [configuration()])
          return 'available'
        } catch (error) {
          const name = error && typeof error === 'object' && 'name' in error ? error.name : ''
          return name === 'NotSupportedError' ? 'not-supported' : name === 'SecurityError' || name === 'NotAllowedError' ? 'blocked' : 'error'
        }
      })
      const publish = (status: DRMStatus) => { if (this.pending.get(system) === current) this.pending.delete(system); for (const callback of current) callback(status); current.clear() }
      void work.then(publish, () => publish('error'))
    }
    listeners.add(listener)
    // Remove cancelled/timed-out subscribers rather than accumulating Promise
    // handlers on a native request that may never settle.
    return () => { listeners.delete(listener) }
  }
  async check(signal: AbortSignal, update: (result: DRMResult) => void = () => {}): Promise<DRMReport> {
    if (signal.aborted) throw cancelled()
    const results = await Promise.all((Object.keys(DRM_SYSTEMS) as DRMSystem[]).map(system => new Promise<DRMResult>((resolve, reject) => {
      let finished = false, unwatch = () => {}
      const clean = () => { finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort); unwatch() }
      const finish = (status: DRMStatus) => { if (finished) return; clean(); const result = { system, status }; try { update(result); resolve(result) } catch (error) { reject(error) } }
      const abort = () => { if (!finished) { clean(); reject(cancelled()) } }
      const timer = setTimeout(() => finish('timeout'), 8000)
      signal.addEventListener('abort', abort, { once: true })
      unwatch = this.watch(system, finish)
    })))
    return { profile: 'mp4-avc-aac-temporary-no-persistence', results }
  }
}
