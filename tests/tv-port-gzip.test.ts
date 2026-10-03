import { expect, it } from 'vitest'
import { gzipSync } from 'node:zlib'
import { gunzipStream } from '../tv-app/gzip'
it('bounds inflated data even when a tiny input expands far beyond the guide budget', async () => {
  const compressed = gzipSync('x'.repeat(1024 * 1024)), input = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(compressed); controller.close() } })
  await expect(new Response(gunzipStream(input, 32768)).text()).rejects.toThrow('guide budget')
})
it('releases the underlying reader when cancelled and never waits for EOF', async () => {
  let cancelled = false
  const input = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } }), reader = gunzipStream(input).getReader()
  const pending = reader.read(); await reader.cancel(); expect(cancelled).toBe(true); await expect(pending).resolves.toMatchObject({ done: true })
})
