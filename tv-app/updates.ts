const REPOSITORY = 'https://github.com/jpaul-dev/Lanternfin-TV'
const API = 'https://api.github.com/repos/jpaul-dev/Lanternfin-TV'
export const UPDATE_LINKS = { source: `${REPOSITORY}/tree/ports/webos-tizen`, releases: `${REPOSITORY}/releases`, guide: `${REPOSITORY}/blob/ports/webos-tizen/docs/TV_PORTS.md` }
export type TVRelease = { name: string; url: string; prerelease: boolean; targets: ('webos' | 'tizen')[] }
export type UpdateCheck = { commit?: string; releases?: TVRelease[]; errors: string[] }
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{40}$/.test(value)
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Only our own release pages, never server-supplied asset/CDN URLs or markup. */
export function tvReleases(value: unknown): TVRelease[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error('Invalid release list.')
  const result: TVRelease[] = []
  for (const entry of value) {
    const release = object(entry)
    if (release.draft !== false || typeof release.prerelease !== 'boolean' || typeof release.tag_name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(release.tag_name) || !Array.isArray(release.assets) || release.assets.length > 100) continue
    const url = `${REPOSITORY}/releases/tag/${encodeURIComponent(release.tag_name)}`
    if (release.html_url !== url) continue
    const targets = new Set<'webos' | 'tizen'>()
    for (const item of release.assets) {
      const asset = object(item)
      if (typeof asset.name !== 'string' || asset.state !== 'uploaded' || typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size <= 0) continue
      if (/^io\.github\.jpauldev\.lanternfin_\d+\.\d+\.\d+_all\.ipk$/.test(asset.name)) targets.add('webos')
      if (/^Lanternfin-TV-[A-Za-z0-9._-]{1,80}\.wgt$/.test(asset.name) && !/unsigned/i.test(asset.name)) targets.add('tizen')
    }
    if (targets.size) result.push({ name: typeof release.name === 'string' && release.name.trim() ? release.name.slice(0, 120) : release.tag_name, url, prerelease: release.prerelease, targets: [...targets] })
  }
  // Retain the bounded response so channel/TV filtering precedes the display limit.
  return result
}

async function read(path: string, signal: AbortSignal): Promise<unknown> {
  const controller = new AbortController(); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const abort = () => { controller.abort(); void reader?.cancel().catch(() => {}) }
  if (signal.aborted) throw new Error('Check canceled.')
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 15000)
  try {
    const response = await fetch(`${API}/${path}`, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/vnd.github+json' } })
    reader = response.body?.getReader()
    if (!response.ok || !reader || Number(response.headers.get('content-length')) > 1024 * 1024) throw new Error()
    let length = 0, text = ''; const decoder = new TextDecoder()
    while (true) {
      const next = await reader.read()
      if (controller.signal.aborted || signal.aborted) throw new Error()
      if (next.done) break
      length += next.value.byteLength; if (length > 1024 * 1024) throw new Error()
      text += decoder.decode(next.value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); abort() }
}
export async function checkUpdates(signal: AbortSignal): Promise<UpdateCheck> {
  // Source SHA only, not a full commit/diff containing unrelated file contents.
  const [source, releases] = await Promise.allSettled([read('git/ref/heads/ports/webos-tizen', signal), read('releases?per_page=20', signal)])
  if (signal.aborted) throw new Error('Check canceled.')
  const result: UpdateCheck = { errors: [] }
  const commit = source.status === 'fulfilled' ? object(object(source.value).object).sha : undefined
  if (sha(commit)) result.commit = commit
  else result.errors.push('The TV source revision could not be checked. GitHub may be unavailable or rate-limited.')
  try { if (releases.status !== 'fulfilled') throw new Error(); result.releases = tvReleases(releases.value) }
  catch { result.errors.push('Published TV packages could not be checked. Try again later.') }
  return result
}
