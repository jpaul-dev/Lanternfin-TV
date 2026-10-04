const stopped = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError') }

/** Some TV transports can leave a fetch/body promise pending after abort. */
function untilAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new DOMException('Cancelled', 'AbortError')) }
    if (signal.aborted) { void promise.catch(() => {}); abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
  })
}

export async function fetchSubtitleResponse(url: string, init: RequestInit & { signal: AbortSignal }): Promise<Response> {
  stopped(init.signal)
  const pending = fetch(url, init)
  // If cancellation wins the race, a later response must not keep downloading.
  void pending.then(response => { if (init.signal.aborted) cancelSubtitleResponse(response) }, () => {})
  const response = await untilAbort(pending, init.signal)
  if (init.signal.aborted) { cancelSubtitleResponse(response); stopped(init.signal) }
  return response
}

export function cancelSubtitleResponse(response?: Response) {
  if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {})
}

/** Keep one bounded buffer, not a list of arbitrarily many incoming chunk views. */
export async function readSubtitleBytes(body: ReadableStream<Uint8Array>, limit: number, signal: AbortSignal, tooLarge: () => Error): Promise<Uint8Array> {
  stopped(signal)
  const reader = body.getReader()
  try {
    const bytes = new Uint8Array(limit); let size = 0, reads = 0, turn = performance.now()
    while (true) {
      const part = await untilAbort(reader.read(), signal); stopped(signal)
      if (part.done) break
      if (part.value.byteLength > limit - size) throw tooLarge()
      bytes.set(part.value, size); size += part.value.byteLength
      // Yield even for empty or immediately resolved chunks so Back and deadlines run.
      if (++reads % 256 === 0 || performance.now() - turn >= 10) {
        await untilAbort(new Promise<void>(resolve => setTimeout(resolve, 0)), signal)
        stopped(signal); turn = performance.now()
      }
    }
    return bytes.subarray(0, size)
  } finally { void reader.cancel().catch(() => {}) }
}
