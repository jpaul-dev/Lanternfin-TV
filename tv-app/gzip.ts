import { Gunzip } from 'fflate'

/** Backpressured fallback for TV engines predating DecompressionStream. */
export function gunzipStream(stream: ReadableStream<Uint8Array>, maxBytes = 64 * 1024 * 1024): ReadableStream<Uint8Array> {
  const reader = stream.getReader()
  let chunk = new Uint8Array(0), offset = 0, raw = 0, decoded = 0, closed = false, produced = false
  let sink: ReadableStreamDefaultController<Uint8Array>
  const inflater = new Gunzip((bytes, final) => {
    decoded += bytes.length
    if (decoded > maxBytes) throw new Error('The XMLTV feed exceeds the 64 MB guide budget. Use a smaller provider guide.')
    if (bytes.length) { sink.enqueue(bytes); produced = true }
    if (final) { closed = true; sink.close() }
  })
  const release = async () => { try { await reader.cancel() } catch { /* Already failed. */ } finally { reader.releaseLock() } }
  return new ReadableStream<Uint8Array>({
    start(controller) { sink = controller },
    async pull() {
      if (closed) return
      produced = false; let started = performance.now()
      try {
        while (!produced && !closed) {
          if (offset >= chunk.length) {
            const next = await reader.read()
            if (closed) return
            if (next.done) { inflater.push(new Uint8Array(0), true); await release(); return }
            raw += next.value.length
            if (raw > maxBytes) throw new Error('The compressed XMLTV feed exceeds the guide download budget.')
            chunk = new Uint8Array(next.value); offset = 0
          }
          // Bound each expansion burst and yield when a header spans many chunks.
          const end = Math.min(offset + 1024, chunk.length); inflater.push(chunk.subarray(offset, end), false); offset = end
          if (!decoded && raw > 65536) throw new Error('The compressed guide has an unusually large or invalid header.')
          if (performance.now() - started > 10) { await new Promise<void>(resolve => setTimeout(resolve, 0)); started = performance.now() }
        }
      } catch (error) { if (!closed) { closed = true; sink.error(error) }; await release() }
    },
    async cancel() { closed = true; await release() },
  }, { highWaterMark: 1 })
}
