import { openMp4Media, type Mp4MediaSession } from './mp4-media-session'
import { MP4_METADATA_ERROR } from './mp4-media-guard'
let session: Mp4MediaSession | undefined, busy = false
const controller = new AbortController()
const scope = self as unknown as { postMessage(value: unknown, transfer?: ArrayBuffer[]): void }
self.onmessage = async event => {
  const { id, action, media, tracks, position, reset } = event.data
  if (busy) { self.postMessage({ id, error: MP4_METADATA_ERROR }); return }
  busy = true
  try {
    let result: unknown, transfer: ArrayBuffer[] = []
    if (action === 'open' && !session) { session = await openMp4Media(media, controller.signal); result = session.info }
    else if (action === 'initialize' && session) { result = session.initialize(tracks); transfer = (result as { buffer: ArrayBuffer }[]).map(s => s.buffer) }
    else if (action === 'segment' && session) { const value = await session.segment(position, reset); result = value; transfer = value.segments.map(s => s.buffer) }
    else throw new Error()
    scope.postMessage({ id, result }, transfer)
  } catch (error) {
    // Only our fixed messages, never parser diagnostics or a provider URL.
    const message = error instanceof Error && /^(This MP4|Cannot read this MP4)/.test(error.message) ? error.message : MP4_METADATA_ERROR
    self.postMessage({ id, error: message })
  } finally { busy = false }
}
