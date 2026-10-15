import type { Channel } from './catalog'
import { webAddress, type Media } from './media'

const ROOT = 'wgt-private/lanternfin-downloads'
const KEY = 'lanternfin.downloads.v1'
export const DOWNLOAD_FILE_LIMIT = 2 * 1024 ** 3, DOWNLOAD_TOTAL_LIMIT = 4 * 1024 ** 3
const MAX_ITEMS = 20, NAME = /^[a-f0-9]{32}\.(mp4|m4v|webm|mkv)$/
type NativeState = 'QUEUED' | 'DOWNLOADING' | 'PAUSED' | 'CANCELED' | 'COMPLETED' | 'FAILED'
type Request = { url: string; destination: string; fileName: string; httpHeader?: Record<string, string> }
export type DownloadListener = {
  onprogress(id: number, received: number, total: number): void; onpaused(id: number): void
  oncanceled(id: number): void; oncompleted(id: number, path: string): void; onfailed(id: number, error: unknown): void
}
export type DownloadPlatform = {
  systeminfo: { getCapability(name: string): unknown }
  DownloadRequest: new(url: string, destination: string, name: string, network: 'ALL', headers: Record<string, string>) => Request
  download: {
    start(request: Request, listener: DownloadListener): number; pause(id: number): void; resume(id: number): void; cancel(id: number): void
    getState(id: number): NativeState; getDownloadRequest(id: number): Request; setListener(id: number, listener: DownloadListener): void
  }
  filesystem: {
    isDirectory(path: string): boolean; isFile(path: string): boolean; pathExists(path: string): boolean; toURI(path: string): string
    createDirectory(path: string, parents: boolean, success: () => void, failure: () => void): void
    deleteFile(path: string, success: () => void, failure: () => void): void
    openFile(path: string, mode: 'r'): { seek(offset: number, origin: 'END'): number; close(): void }
  }
}
export type DownloadItem = { key: string; name: string; kind: 'movie' | 'episode'; file: string; id?: number; state: 'starting' | 'downloading' | 'paused' | 'canceling' | 'complete' | 'failed'; received: number; total: number; position: number; duration: number; note: string }
// A provider JSON object, imported backup or URL string cannot grant local-file access.
const localFiles = new WeakMap<Media, { url: string; key: string }>()
export const localDownload = (media: Media): string | undefined => { const entry = localFiles.get(media); return entry?.url === media.url ? entry.url : undefined }
const number = (n: unknown, max = DOWNLOAD_TOTAL_LIMIT): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= max
const terminal = (item: DownloadItem) => item.state === 'complete' || item.state === 'failed'
const active = (item: DownloadItem) => ['starting', 'downloading', 'canceling'].includes(item.state)
const failure = 'Download unavailable. Check provider access, free TV storage and app permissions. Remove this entry before trying again.'
const sizeFailure = 'This file exceeds the 2 GiB per-file or 4 GiB library limit. Canceling the download.'

export function downloadProblem(media: Media): string | undefined {
  if (!['movie', 'episode'].includes(media.mediaKind || '')) return 'Downloads are available for individual movies and episodes.'
  if (media.playback?.drm || media.playback?.problem || media.playback?.manifestType) return 'Protected and adaptive streams cannot be downloaded here.'
  try { if (!/\.(mp4|m4v|webm|mkv)$/i.test(new URL(webAddress(media.url)).pathname)) return 'This needs a single MP4, M4V, WebM or MKV file from your provider.' } catch { return 'The download address is invalid.' }
  const headers = Object.entries(media.playback?.headers || {})
  if (headers.length > 32 || headers.some(([key, value]) => !/^[!#$%&'*+.^_`|~\w-]{1,100}$/.test(key) || typeof value !== 'string' || value.length > 8192 || /[\r\n\0]/.test(value) || /^(host|content-length|connection|transfer-encoding|proxy-.*|sec-.*)$/i.test(key))) return 'The download uses unsupported request headers.'
}

/** Native transfer service; JS never buffers a movie. Only app-generated private paths are used. */
export class TVDownloads {
  private items: DownloadItem[] = []
  private loaded = false
  private storage?: Storage
  private lastSave = 0
  private background = false
  private busy = false
  private resetting = false
  onChange = () => {}
  message = ''
  constructor(private api?: DownloadPlatform, private getStorage: () => Storage = () => localStorage) {}
  get supported() { try { const a = this.api; return !!(a?.download && typeof a.DownloadRequest === 'function' && typeof a.filesystem?.openFile === 'function' && typeof a.filesystem?.toURI === 'function' && a.systeminfo?.getCapability('http://tizen.org/feature/download') === true) } catch { return false } }
  list() { return this.items.map(item => ({ ...item })) }
  private path(item: DownloadItem) { if (!NAME.test(item.file) || item.file.split('.')[0] !== item.key) throw new Error('Invalid saved download.'); return `${ROOT}/${item.file}` }
  private save(force = true) {
    if (!force && Date.now() - this.lastSave < 1500) { this.onChange(); return }
    try { if (!this.storage) throw new Error(); this.storage.setItem(KEY, JSON.stringify(this.items)); this.lastSave = Date.now() }
    catch { this.message = 'Download changes could not be saved. Free app storage before starting another download.'; this.onChange(); throw new Error(this.message) }
    this.onChange()
  }
  private changed(force = true) { try { this.save(force) } catch { this.suspend() } }
  private bytes(item: DownloadItem) {
    const fs = this.api!.filesystem, path = this.path(item)
    if (!fs.isFile(path)) throw new Error()
    const handle = fs.openFile(path, 'r')
    try { const bytes = handle.seek(0, 'END'); if (!number(bytes) || !bytes) throw new Error(); return bytes } finally { handle.close() }
  }
  private reserved(except?: DownloadItem) { return this.items.reduce((sum, item) => sum + (item === except ? 0 : Math.max(item.received, item.total, item.state === 'complete' ? 0 : DOWNLOAD_FILE_LIMIT)), 0) }
  private within(item: DownloadItem, bytes: number) { return bytes <= DOWNLOAD_FILE_LIMIT && this.reserved(item) + bytes <= DOWNLOAD_TOTAL_LIMIT }
  private ownership(item: DownloadItem): 'owned' | 'missing' | 'other' | 'unknown' {
    if (item.id === undefined) return 'missing'
    try { const request = this.api!.download.getDownloadRequest(item.id); return request.fileName === item.file && typeof request.destination === 'string' && this.api!.filesystem.toURI(`${request.destination}/${request.fileName}`) === this.api!.filesystem.toURI(this.path(item)) ? 'owned' : 'other' }
    catch (error) { return (error as { name?: string })?.name === 'NotFoundError' ? 'missing' : 'unknown' }
  }
  private owns(item: DownloadItem) { return this.ownership(item) === 'owned' }
  private complete(item: DownloadItem) {
    item.id = undefined
    try { const bytes = this.bytes(item); if (!this.within(item, bytes)) throw new Error(); item.received = item.total = bytes; item.state = 'complete'; item.note = 'Ready to watch offline.' }
    catch { item.state = 'failed'; item.note = 'The saved file is missing, empty or too large. Remove this entry and download it again.' }
    this.changed()
  }
  private listener(item: DownloadItem): DownloadListener {
    const current = (id: number) => this.items.includes(item) && item.id === id && !terminal(item)
    return {
      onprogress: (id, received, total) => {
        if (!current(id) || item.state === 'canceling') return
        if (!number(received) || !number(total) || !this.within(item, Math.max(received, total))) { this.cancel(item.key, sizeFailure); return }
        item.received = received; item.total = total
        if (item.state !== 'paused') item.state = 'downloading'
        this.changed(false)
      },
      onpaused: id => { if (current(id) && item.state !== 'canceling') { try { if (this.api!.download.getState(id) !== 'PAUSED') return } catch { return }; item.state = 'paused'; item.note = 'Paused. Resume when you are ready.'; this.changed() } },
      oncanceled: id => { if (current(id)) { item.id = undefined; item.state = 'failed'; item.note = item.note.startsWith('This file exceeds') ? 'File too large. Remove this entry to release any remaining space.' : 'Canceled. Remove this entry to release any remaining space.'; this.changed() } },
      onfailed: id => { if (current(id)) { item.id = undefined; item.state = 'failed'; item.note = failure; this.changed() } },
      oncompleted: id => { if (current(id)) this.complete(item) }, // Never trust a callback's path or filename.
    }
  }
  load() {
    if (this.loaded || !this.supported) return
    this.loaded = true
    try {
      this.storage = this.getStorage(); const raw = this.storage.getItem(KEY)
      if (!raw) return
      if (raw.length > 32000) throw new Error()
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed) || parsed.length > MAX_ITEMS) throw new Error()
      const seen = new Set<string>(), ids = new Set<number>()
      for (const item of parsed) {
        if (!item || typeof item !== 'object' || !/^[a-f0-9]{32}$/.test(item.key) || !NAME.test(item.file) || item.file.split('.')[0] !== item.key || seen.has(item.key) || !['movie', 'episode'].includes(item.kind) || typeof item.name !== 'string' || item.name.length > 160 || !number(item.received) || !number(item.total) || !['starting', 'downloading', 'paused', 'canceling', 'complete', 'failed'].includes(item.state) || (item.id !== undefined && (!number(item.id, 2147483647) || ids.has(item.id)))) throw new Error()
        seen.add(item.key); if (item.id !== undefined) ids.add(item.id)
      }
      // Copy allowed fields only; old/corrupt metadata cannot inject addresses, headers or UI markup.
      this.items = parsed.map(item => ({ key: item.key, file: item.file, name: item.name, kind: item.kind, id: item.id, state: item.state, received: item.received, total: item.total, position: number(item.position, 604800) ? item.position : 0, duration: number(item.duration, 604800) ? item.duration : 0, note: '' }))
      this.refresh(true)
    } catch { this.message = 'Saved download metadata could not be read. No files were changed.'; this.storage = undefined }
  }
  refresh(reopening = false) {
    if (!this.loaded) { this.load(); return }
    if (!this.supported) return
    for (const item of this.items) {
        if (item.state === 'complete') { this.complete(item); continue }
        if (item.state === 'failed') { item.id = undefined; item.note = failure; continue }
        const ownership = this.ownership(item)
        if (ownership === 'unknown') { item.note = 'The TV could not check this transfer. Choose Check transfers to retry.'; continue }
        if (ownership !== 'owned') { item.id = undefined; item.state = 'failed'; item.note = 'This download was interrupted. Remove it and start again from your library.'; continue }
        try {
          this.api!.download.setListener(item.id!, this.listener(item))
          const state = this.api!.download.getState(item.id!)
          if (state === 'COMPLETED') this.complete(item)
          else if (state === 'FAILED' || state === 'CANCELED') { item.id = undefined; item.state = 'failed'; item.note = failure }
          else if (item.state === 'canceling') this.cancel(item.key)
          else if (reopening || state === 'PAUSED') { if (state !== 'PAUSED') this.api!.download.pause(item.id!); item.state = 'paused'; item.note = 'Paused. Resume when you are ready.' }
          else { item.state = 'downloading'; item.note = 'Downloading to this TV.' }
        } catch { item.note = 'The TV could not update this transfer. Try Cancel download.' }
      }
    if (this.items.length) this.changed()
  }
  async start(channel: Channel) {
    this.load()
    const problem = downloadProblem(channel)
    if (problem) throw new Error(problem)
    if (!this.supported) throw new Error('Downloads require a Samsung TV with native download and private storage support.')
    if (this.background || this.busy || this.resetting || this.items.some(active)) throw new Error('Pause the current transfer before starting another download.')
    if (this.items.length >= MAX_ITEMS || this.reserved() + DOWNLOAD_FILE_LIMIT > DOWNLOAD_TOTAL_LIMIT) throw new Error('Remove saved downloads to make space. Up to 20 entries and 4 GiB are allowed.')
    if (!this.storage) throw new Error(this.message || 'Saved app storage is required for downloads.')
    this.busy = true
    try {
      const fs = this.api!.filesystem
      if (!fs.pathExists(ROOT)) await this.operation((ok, fail) => fs.createDirectory(ROOT, false, ok, fail))
      if (!fs.isDirectory(ROOT)) throw new Error()
      if (this.background) throw new Error('Download stopped while the app was away. Try again when you return.')
      const key = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
      const extension = new URL(channel.url).pathname.match(/\.(mp4|m4v|webm|mkv)$/i)![1].toLowerCase()
      const item: DownloadItem = { key, file: `${key}.${extension}`, name: channel.name.slice(0, 160), kind: channel.mediaKind as 'movie' | 'episode', state: 'starting', received: 0, total: 0, position: 0, duration: 0, note: 'Starting download…' }
      if (fs.pathExists(this.path(item))) throw new Error('The download filename is already in use. Try again.')
      this.items.push(item)
      try { this.save() } catch (error) { this.items.pop(); throw error }
      try {
        // Credentials stay in the OS transfer request, never in our saved metadata or backup.
        const request = new this.api!.DownloadRequest(webAddress(channel.url), ROOT, item.file, 'ALL', { ...channel.playback?.headers })
        item.id = this.api!.download.start(request, this.listener(item))
        if (!number(item.id, 2147483647)) { item.id = undefined; throw new Error() }
        item.state = 'downloading'; item.note = 'Downloading to this TV.'
        this.save()
      } catch {
        if (item.id !== undefined) { try { this.api!.download.cancel(item.id); item.state = 'canceling'; item.note = 'Stopping the transfer after a storage error.' } catch { item.note = 'The TV could not stop the transfer. Try Cancel download.' } }
        else { item.state = 'failed'; item.note = failure }
        this.changed(); throw new Error(failure)
      }
    } catch { throw new Error(failure) } finally { this.busy = false }
  }
  pause(key: string) {
    const item = this.items.find(item => item.key === key); if (!item || !['downloading', 'starting'].includes(item.state)) return
    try { if (!this.owns(item)) throw new Error(); this.api!.download.pause(item.id!); item.state = 'paused'; item.note = 'Paused. Resume when you are ready.'; this.changed() }
    catch { item.note = 'Pause failed. Try Cancel download.'; this.onChange() }
  }
  resume(key: string) {
    const item = this.items.find(item => item.key === key)
    if (!item || item.state !== 'paused') return
    if (this.background || this.resetting || this.items.some(active) || !this.within(item, Math.max(item.received, item.total, DOWNLOAD_FILE_LIMIT))) throw new Error('Pause other transfers or remove downloads before resuming.')
    if (!this.owns(item)) throw new Error('The transfer is no longer available. Remove it and start again from your library.')
    try { this.api!.download.resume(item.id!); item.state = 'downloading'; item.note = 'Downloading to this TV.'; this.changed() } catch { throw new Error(failure) }
  }
  cancel(key: string, note = 'Canceling download…') {
    const item = this.items.find(item => item.key === key); if (!item || terminal(item)) return
    try { if (!this.owns(item)) throw new Error(); item.state = 'canceling'; item.note = note; this.api!.download.cancel(item.id!); this.changed() }
    catch { item.note = 'The TV could not cancel this transfer. Reopen Downloads to check its state.'; this.onChange() }
  }
  suspend() {
    this.background = true
    for (const item of this.items) if (['starting', 'downloading'].includes(item.state)) { this.pause(item.key); if (item.state !== 'paused') this.cancel(item.key) }
  }
  foreground() { this.background = false }
  async removeAll() {
    if (this.busy || this.resetting) throw new Error('Wait for the current download operation to finish.')
    const storage = this.getStorage(), raw = storage.getItem(KEY)
    if (!this.supported) {
      if (raw && raw !== '[]') throw new Error('This device cannot remove saved download files.')
      storage.removeItem(KEY); if (storage.getItem(KEY) !== null) throw new Error('Download metadata could not be removed.'); return
    }
    this.load()
    if (!this.storage) throw new Error('Saved download metadata could not be read. No files were changed.')
    this.resetting = true
    try {
      const deadline = Date.now() + 12000, canceled = new Set<number>()
      // A cancellation request alone is not proof that the OS stopped writing.
      for (;;) {
        let waiting = false
        for (const item of this.items) {
          if (item.id === undefined) continue
          const owned = this.ownership(item)
          let stopped = owned === 'missing' || owned === 'other'
          if (owned === 'owned') {
            const state = this.api!.download.getState(item.id)
            stopped = ['CANCELED', 'FAILED', 'COMPLETED'].includes(state)
            if (!stopped && !canceled.has(item.id)) { canceled.add(item.id); this.cancel(item.key) }
          }
          if (stopped) { item.id = undefined; item.state = 'failed'; this.save() }
          else if (item.id !== undefined) waiting = true
        }
        if (!waiting) break
        if (Date.now() >= deadline) throw new Error('The TV could not confirm that all transfers stopped. No download files were removed.')
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      for (const item of [...this.items]) await this.remove(item.key)
      this.save(); storage.removeItem(KEY)
      if (storage.getItem(KEY) !== null) throw new Error('Download metadata could not be removed.')
    } finally { this.resetting = false }
  }
  async remove(key: string) {
    const item = this.items.find(item => item.key === key); if (!item || !terminal(item) || this.busy) throw new Error('Cancel the transfer before removing its file.')
    this.busy = true
    try {
      const fs = this.api!.filesystem, path = this.path(item)
      if (fs.pathExists(path)) { if (!fs.isFile(path)) throw new Error(); await this.operation((ok, fail) => fs.deleteFile(path, ok, fail)) }
      this.items = this.items.filter(entry => entry !== item); this.save()
    } catch { throw new Error('The saved file could not be removed. Check app storage and try again.') } finally { this.busy = false }
  }
  private operation(run: (ok: () => void, fail: () => void) => void) {
    return new Promise<void>((resolve, reject) => { const fail = () => { clearTimeout(timer); reject(new Error('TV storage did not respond.')) }; const timer = setTimeout(fail, 12000); try { run(() => { clearTimeout(timer); resolve() }, fail) } catch { fail() } })
  }
  channel(key: string): Channel {
    const item = this.items.find(item => item.key === key)
    try {
      if (!item || item.state !== 'complete' || this.bytes(item) !== item.received) throw new Error()
      const url = this.api!.filesystem.toURI(this.path(item)), address = new URL(url)
      if (address.protocol !== 'file:' || address.host || address.search || address.hash || !address.pathname.endsWith(`/${item.file}`)) throw new Error()
      const channel: Channel = { name: item.name, url, group: 'Downloads', mediaKind: item.kind }
      localFiles.set(channel, { url, key }); return channel
    } catch { throw new Error('This saved file is unavailable. Remove the entry and download it again.') }
  }
  progress(channel: Channel, position: number, duration: number, ended = false) {
    const entry = localFiles.get(channel), item = entry && this.items.find(item => item.key === entry.key)
    if (!item || !localDownload(channel)) return
    if (Number.isFinite(duration) && duration > 0 && duration <= 604800) item.duration = Math.floor(duration)
    if (Number.isFinite(position) && position >= 0 && position <= 604800) item.position = ended || item.duration && position >= item.duration - 10 ? 0 : Math.floor(position)
    this.changed()
  }
}
