import type { Media } from './media'
import { fetchSubtitleResponse as fetchResponse, readSubtitleBytes as readBytes, cancelSubtitleResponse as cancelResponse } from './subtitle-stream'

export const MP4_ACCESS_ERROR = 'Cannot read this MP4. The server must allow byte ranges, cross-origin requests and the required headers, and expose Content-Range. Authenticated redirects are not followed.'
/** Strict random access; never accept a whole movie in response to a small range. */
export function mp4MediaReader(media: Media) {
  let total: number | undefined, tag: string | undefined
  return async (start: number, length: number, signal: AbortSignal) => {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(start + length) || length < 1 || length > 16 * 1024 * 1024) throw new Error(MP4_ACCESS_ERROR)
    const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, 15000)
    signal.addEventListener('abort', abort, { once: true })
    let response: Response | undefined
    try {
      const end = total === undefined ? start + length - 1 : Math.min(total - 1, start + length - 1)
      const headers = { ...media.playback?.headers, Range: `bytes=${start}-${end}`, ...(tag && !tag.startsWith('W/') ? { 'If-Range': tag } : {}) }
      response = await fetchResponse(media.url, { headers, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error' })
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(response.headers.get('content-range') || '')
      if (response.status !== 206 || !match || !response.body) throw new Error()
      const first = Number(match[1]), last = Number(match[2]), size = Number(match[3]), currentTag = response.headers.get('etag')
      if (!Number.isSafeInteger(size) || first !== start || last !== Math.min(end, size - 1) || last < start || total !== undefined && size !== total || tag && currentTag && tag !== currentTag) throw new Error()
      total = size; if (currentTag) tag = currentTag
      if (Number(response.headers.get('content-length')) > length) throw new Error()
      const bytes = await readBytes(response.body, length, controller.signal, () => new Error())
      if (bytes.length !== last - start + 1 || controller.signal.aborted) throw new Error()
      return { bytes, total }
    } catch {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
      throw new Error(MP4_ACCESS_ERROR)
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort(); cancelResponse(response) }
  }
}
