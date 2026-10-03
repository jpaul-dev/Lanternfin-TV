import { httpUrl } from './catalog'
type XMLProgramme = { start: number; stop: number; title: string; desc: string }
type Reply = { id: number; error?: string; noFeed?: boolean; programmes?: XMLProgramme[] | Array<[string, XMLProgramme[]]>; channelNames?: Array<[string, string]> }
/** Reuses Android's streamed XMLTV worker and on-demand per-channel extraction. */
export class XMLTVGuide {
  private worker?: Worker
  private controller = new AbortController()
  private ready?: Promise<void>
  private sequence = 0
  private pending = new Map<number, { resolve(reply: Reply): void; reject(error: Error): void }>()
  private names = new Map<string, string>()
  private ids = new Set<string>()
  constructor(private url: string) {}
  close() {
    this.controller.abort(); this.worker?.terminate(); this.worker = undefined
    for (const request of this.pending.values()) request.reject(new Error('Guide loading cancelled.'))
    this.pending.clear()
  }
  private ask(message: Record<string, unknown>, signal: AbortSignal): Promise<Reply> {
    if (signal.aborted) return Promise.reject(new Error('Guide loading cancelled.'))
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); this.pending.delete(id) }
      const abort = () => { cleanup(); reject(new Error('Guide loading cancelled.')) }
      const timer = setTimeout(() => { cleanup(); this.close(); reject(new Error('The programme guide took too long to read. Reload the source with a smaller guide.')) }, 45000)
      this.pending.set(id, { resolve: reply => { cleanup(); reply.error || reply.noFeed ? reject(new Error('The XMLTV guide could not be read. Check its format and compression support.')) : resolve(reply) }, reject: error => { cleanup(); reject(error) } })
      signal.addEventListener('abort', abort, { once: true })
      try { if (!this.worker) throw new Error('The programme guide reader is unavailable. Refresh the guide to retry.'); this.worker.postMessage({ ...message, id }) }
      catch (error) { cleanup(); reject(error instanceof Error ? error : new Error('The programme guide reader is unavailable.')) }
    })
  }
  private async download() {
    this.worker = new Worker('epg-worker.js')
    this.worker.onmessage = event => { const reply = event.data as Reply; this.pending.get(reply.id)?.resolve(reply) }
    this.worker.onerror = () => { this.close(); this.ready = undefined }
    const signal = this.controller.signal
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: ReturnType<typeof setTimeout> | undefined
    const abortRead = () => { void reader?.cancel().catch(() => {}) }
    signal.addEventListener('abort', abortRead, { once: true })
    const idle = () => { clearTimeout(timer); timer = setTimeout(() => this.controller.abort(), 45000) }
    try {
      idle()
      const response = await fetch(httpUrl(this.url), { signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
      if (!response.ok || !response.body) throw new Error('The XMLTV guide could not be downloaded. Check the guide address and provider access.')
      reader = response.body.getReader(); let bytes = 0, begun = false, decompressed = false, prefix = new Uint8Array(0)
      while (true) {
        idle(); const next = await reader!.read(); clearTimeout(timer)
        if (signal.aborted) throw new Error('Guide loading cancelled.')
        if (next.done) break
        bytes += next.value.byteLength
        if (bytes > 64 * 1024 * 1024) throw new Error('The XMLTV feed exceeds the 64 MB guide budget. Use a smaller provider guide.')
        let chunk = next.value
        if (!begun) {
          const combined = new Uint8Array(prefix.length + chunk.length); combined.set(prefix); combined.set(chunk, prefix.length); chunk = combined
          if (chunk.length < 2) { prefix = new Uint8Array(chunk); continue }
          if (chunk[0] === 31 && chunk[1] === 139) {
            if (decompressed) throw new Error('The XMLTV guide has unsupported nested compression.')
            if (typeof DecompressionStream !== 'function') throw new Error('This TV cannot decompress this guide. Use an uncompressed XMLTV address from your provider.')
            const compressed: ReadableStreamDefaultReader<Uint8Array> = reader!, initial = new Uint8Array(chunk)
            const stream: ReadableStream<BufferSource> = new ReadableStream<BufferSource>({ start(controller) { controller.enqueue(initial) }, async pull(controller) { const next = await compressed.read(); if (next.done) controller.close(); else controller.enqueue(new Uint8Array(next.value)) }, cancel() { return compressed.cancel() } })
            reader = stream.pipeThrough(new DecompressionStream('gzip')).getReader(); bytes = 0; prefix = new Uint8Array(0); decompressed = true; continue
          }
          this.worker.postMessage({ type: 'begin', id: 0, feedId: 'playlist', mode: 'now-next', nowMs: Date.now(), gzip: false, maxChannels: 25000 }); begun = true
        }
        const buffer = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
        this.worker.postMessage({ type: 'chunk', id: 0, feedId: 'playlist', bytes: buffer }, [buffer])
      }
      if (!begun) throw new Error('The XMLTV guide was empty.')
      const result = await this.ask({ type: 'end', feedId: 'playlist' }, signal)
      for (const [id] of result.programmes as Array<[string, XMLProgramme[]]> || []) this.ids.add(id)
      for (const [id, name] of result.channelNames || []) this.names.set(name.trim().toLowerCase(), id)
    } catch (error) {
      this.worker?.terminate(); this.worker = undefined
      if (signal.aborted) throw new Error('Guide loading stopped or timed out. Reload this source to try again.')
      throw error instanceof Error && !/https?:|fetch/i.test(error.message) ? error : new Error('Cannot reach the XMLTV guide. Check the address, network, and provider cross-origin access.')
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abortRead); if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock() } }
  }
  async load(tvgId: string | undefined, name: string, signal: AbortSignal): Promise<XMLProgramme[]> {
    if (signal.aborted || this.controller.signal.aborted) throw new Error('Guide loading cancelled.')
    if (!this.ready) this.ready = this.download().catch(error => { this.ready = undefined; throw error })
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new Error('Guide loading cancelled.'))
      if (signal.aborted) { abort(); return }
      signal.addEventListener('abort', abort, { once: true })
      this.ready!.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
    if (signal.aborted) throw new Error('Guide loading cancelled.')
    const id = tvgId && this.ids.has(tvgId) ? tvgId : this.names.get(name.trim().toLowerCase()) || tvgId
    if (!id) return []
    const result = await this.ask({ type: 'programmesFor', feedId: 'playlist', tvgId: id, window: { fromMs: Date.now() - 86400000, toMs: Date.now() + 3 * 86400000 } }, signal)
    return (result.programmes as XMLProgramme[] || []).slice(0, 512)
  }
}
