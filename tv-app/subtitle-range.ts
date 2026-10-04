import type { Media } from './media'
import { SubtitleError } from './external-subtitles'
import { cancelSubtitleResponse, fetchSubtitleResponse, readSubtitleBytes } from './subtitle-stream'
const stopped = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError') }

export async function subtitleBudget<T>(signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  stopped(signal)
  const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, 45000)
  signal.addEventListener('abort', abort, { once: true })
  try { return await work(controller.signal) }
  catch (error) { stopped(signal); if (controller.signal.aborted) throw new SubtitleError('Reading embedded subtitles took too long. Check the connection and retry.'); throw error }
  finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort() }
}
export function subtitleRangeReader(media: Media, maxBytes = 32 * 1024 * 1024) {
  let total: number | undefined, etag: string | undefined
  return async (start: number, length: number, signal: AbortSignal, short = false) => {
    stopped(signal)
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(start + length) || length < 1 || length > maxBytes) throw new SubtitleError('Invalid subtitle byte range.')
    const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, 15000)
    signal.addEventListener('abort', abort, { once: true })
    let response: Response | undefined
    try {
      const end = total === undefined ? start + length - 1 : Math.min(total - 1, start + length - 1)
      if (end < start) throw new SubtitleError('The video ended before its subtitle data.')
      const headers = { ...media.playback?.headers, Range: `bytes=${start}-${end}` }
      response = await fetchSubtitleResponse(media.url, { headers, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: Object.keys(media.playback?.headers || {}).length ? 'error' : 'follow' })
      if (response.status !== 206) throw new SubtitleError('The video server must support byte-range reads and cross-origin access for embedded subtitles.')
      const range = response.headers.get('content-range')
      if (range) {
        const parts = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(range)
        if (!parts || Number(parts[1]) !== start || Number(parts[2]) > end || Number(parts[2]) < start) throw new SubtitleError('The video server returned an unexpected subtitle byte range.')
        if (parts[3] !== '*') {
          const size = Number(parts[3]); if (!Number.isSafeInteger(size) || size <= Number(parts[2]) || total !== undefined && total !== size) throw new SubtitleError('The video changed while subtitles were being read.')
          total = size
        }
      }
      const currentTag = response.headers.get('etag')
      if (etag && currentTag && etag !== currentTag) throw new SubtitleError('The video changed while subtitles were being read.')
      if (currentTag) etag = currentTag
      if (Number(response.headers.get('content-length')) > length || !response.body) throw new SubtitleError('The video server returned an oversized or unreadable subtitle response.')
      const bytes = await readSubtitleBytes(response.body, length, controller.signal, () => new SubtitleError('The video server exceeded the requested subtitle byte limit.'))
      const size = bytes.byteLength
      stopped(controller.signal)
      if (!size || !short && size !== length || range && size !== Number(/^bytes \d+-(\d+)/i.exec(range)![1]) - start + 1) throw new SubtitleError('The subtitle data was truncated by the video server.')
      return { bytes, total }
    } catch (error) {
      stopped(signal)
      if (controller.signal.aborted) throw new SubtitleError('Reading embedded subtitles took too long. Check the connection and retry.')
      if (error instanceof SubtitleError) throw error
      throw new SubtitleError('Cannot read this video’s subtitle data. Check server access, byte ranges and cross-origin permissions. Authenticated redirects are not followed.')
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort(); cancelSubtitleResponse(response) }
  }
}

