import { httpUrl } from './catalog'
import { plainCaptionText as plainText } from './caption-text'

export class SubtitleError extends Error {}
export const SUBTITLE_BYTES = 2 * 1024 * 1024
const MAX_CUES = 20000, MAX_TIME = 7 * 24 * 60 * 60
export type SubtitleCue = { start: number; end: number; text: string }
const stopped = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError') }
const invalid = () => new SubtitleError('Use a UTF-8 SRT, WebVTT, ASS or SSA file with valid timestamps and plain text.')

function timestamp(value: string): number {
  const match = /^(?:(\d{1,3}):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(value)
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) throw invalid()
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000
}

function assTimestamp(value: string): number {
  const match = /^(\d{1,3}):(\d{2}):(\d{2})\.(\d{2})$/.exec(value.trim())
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) throw invalid()
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 100
}

function assText(value: string, defaultWrap: number): string {
  let text = '', drawing = false, wrap = defaultWrap
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '{') {
      const end = value.indexOf('}', i + 1)
      if (end < 0) throw invalid()
      // Only interpret text/drawing boundaries and line breaks. Never evaluate styles,
      // transforms, embedded fonts, links or ASS/SSA command/picture/sound events.
      let depth = 0
      for (let j = i + 1; j < end; j++) {
        if (value[j] === '(') { depth++; continue }
        if (value[j] === ')') { depth = Math.max(0, depth - 1); continue }
        if (value[j] !== '\\' || depth) continue
        let next = j + 1
        while (next < end && !'\\()'.includes(value[next])) next++
        const tag = value.slice(j + 1, next).trim()
        if (/^p\d*$/.test(tag)) drawing = Number(tag.slice(1)) > 0
        else if (/^q[0-3]?$/.test(tag)) wrap = tag.length > 1 ? Number(tag[1]) : defaultWrap
        else if (tag.startsWith('r')) { drawing = false; wrap = defaultWrap }
        j = next - 1
      }
      i = end; continue
    }
    if (drawing) continue
    if (value[i] === '\\' && 'Nnh'.includes(value[i + 1] || '\0')) {
      const escape = value[++i]
      text += escape === 'h' ? '\u00a0' : escape === 'N' || wrap === 2 ? '\n' : ' '
    } else text += value[i]
    if (text.length > 4096) throw invalid()
  }
  // Preserve ASS hard spaces (including at the edges), and literal HTML/entities.
  return text.replace(/^[ \t\n]+|[ \t\n]+$/g, '')
}

async function parseAss(text: string, signal?: AbortSignal): Promise<SubtitleTimeline> {
  const cues: SubtitleCue[] = [], sections = new Set<string>(), lines = text.split('\n')
  let section = '', scriptType = '', wrap = 0, fields: string[] | undefined, events = 0, turn = performance.now()
  for (let i = 0; i < lines.length; i++) {
    stopped(signal)
    if (i % 256 === 255 || performance.now() - turn >= 10) { await new Promise(resolve => setTimeout(resolve, 0)); stopped(signal); turn = performance.now() }
    if (lines[i].length > 16384) throw invalid()
    const line = lines[i].trimStart()
    if (!line.trim() || line.startsWith(';')) continue
    const header = /^\[([^\]]+)\][ \t]*$/.exec(line)
    if (header) {
      section = header[1].toLowerCase()
      if (sections.has(section) || sections.size >= 64) throw invalid()
      sections.add(section)
      if (section === 'events' && !scriptType) throw invalid()
      continue
    }
    const record = /^([A-Za-z][A-Za-z ]*):[ \t]*(.*)$/.exec(line)
    if (!record) continue
    const key = record[1].trim().toLowerCase(), value = record[2]
    if (section === 'script info') {
      if (key === 'scripttype') {
        if (scriptType) throw invalid()
        scriptType = value.trim().toLowerCase()
        if (!['v4.00', 'v4.00+'].includes(scriptType)) throw new SubtitleError('Use ASS v4+ or SSA v4 subtitles. This script version is not supported.')
      } else if (key === 'wrapstyle') {
        if (!/^[0-3]$/.test(value.trim())) throw invalid()
        wrap = Number(value.trim())
      }
    } else if (section === 'events') {
      if (key === 'format') {
        if (fields) throw invalid()
        fields = value.split(',').map(field => field.trim().toLowerCase())
        if (fields.length < 3 || fields.length > 32 || new Set(fields).size !== fields.length || fields.some(field => !/^[a-z][a-z0-9 ]{0,31}$/.test(field)) || fields[fields.length - 1] !== 'text' || !fields.includes('start') || !fields.includes('end')) throw invalid()
      } else if (key === 'dialogue') {
        if (!fields) throw invalid()
        if (++events > MAX_CUES) throw new SubtitleError('Subtitle files must contain no more than 20,000 cues.')
        // Text is the final field and may itself contain commas; metadata may not.
        const values: string[] = []; let offset = 0
        for (let field = 0; field < fields.length - 1; field++) {
          const comma = value.indexOf(',', offset)
          if (comma < 0) throw invalid()
          values.push(value.slice(offset, comma)); offset = comma + 1
        }
        const start = assTimestamp(values[fields.indexOf('start')]), end = assTimestamp(values[fields.indexOf('end')])
        if (!(end > start) || end > MAX_TIME) throw invalid()
        const body = assText(value.slice(offset), wrap)
        if (body) cues.push({ start, end, text: body })
      }
    }
  }
  if (!cues.length) throw new SubtitleError('This file has no supported subtitle cues.')
  return new SubtitleTimeline(cues)
}

/** Text-only, file-relative SRT/WebVTT/ASS/SSA. No advanced layout, fonts, drawings or live timestamp maps. */
export async function parseSubtitles(text: string, signal?: AbortSignal): Promise<SubtitleTimeline> {
  stopped(signal)
  if (text.length > SUBTITLE_BYTES || new TextEncoder().encode(text).length > SUBTITLE_BYTES) throw new SubtitleError('Subtitle files must be 2 MB or smaller.')
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (text.includes('\0')) throw invalid()
  if (/^(?:[ \t]*(?:;[^\n]*)?\n)*[ \t]*\[Script Info\][ \t]*(?:\n|$)/i.test(text)) return parseAss(text, signal)
  const blocks = text.split(/\n[\t ]*\n/), cues: SubtitleCue[] = []
  const webvtt = /^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(blocks[0])
  if (webvtt && /(?:^|\n)X-TIMESTAMP-MAP[=:]/i.test(blocks[0])) throw new SubtitleError('Live WebVTT timestamp maps are not supported. Use a subtitle file timed from the start of this video.')
  let turn = performance.now()
  for (let i = webvtt ? 1 : 0; i < blocks.length; i++) {
    stopped(signal)
    if (i % 256 === 255 || performance.now() - turn >= 10) { await new Promise(resolve => setTimeout(resolve, 0)); stopped(signal); turn = performance.now() }
    const block = blocks[i].trim()
    if (block.length > 16384) throw invalid()
    if (!block || webvtt && /^(?:NOTE(?:[ \t\n]|$)|STYLE(?:\n|$)|REGION(?:\n|$))/.test(block)) continue
    const lines = block.split('\n'), timing = lines[0].includes('-->') ? 0 : 1
    const match = /^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t]+.*)?$/.exec(lines[timing] || '')
    if (!match) throw invalid()
    const start = timestamp(match[1]), end = timestamp(match[2]), body = plainText(lines.slice(timing + 1).join('\n'))
    if (!(end > start) || end > MAX_TIME || body.length > 4096) throw invalid()
    if (body) cues.push({ start, end, text: body })
    if (cues.length > MAX_CUES) throw new SubtitleError('Subtitle files must contain no more than 20,000 cues.')
  }
  if (!cues.length) throw new SubtitleError('This file has no supported subtitle cues.')
  return new SubtitleTimeline(cues)
}

export class SubtitleTimeline {
  private cues: SubtitleCue[]
  private ends: Float64Array
  constructor(cues: SubtitleCue[]) {
    this.cues = cues.slice().sort((a, b) => a.start - b.start)
    this.ends = new Float64Array(cues.length * 4)
    const build = (lo: number, hi: number, node: number): number => {
      if (hi - lo === 1) return this.ends[node] = this.cues[lo].end
      const mid = (lo + hi) >>> 1
      return this.ends[node] = Math.max(build(lo, mid, node * 2 + 1), build(mid, hi, node * 2 + 2))
    }
    if (cues.length) build(0, cues.length, 0)
  }
  get count() { return this.cues.length }
  at(time: number): string {
    if (!Number.isFinite(time) || time < 0 || !this.cues.length) return ''
    const active: string[] = []
    // Interval maxima skip completed ranges, including when one unusually long cue overlaps many short ones.
    const visit = (lo: number, hi: number, node: number) => {
      if (active.length >= 8 || this.ends[node] <= time || this.cues[lo].start > time) return
      if (hi - lo === 1) { active.push(this.cues[lo].text); return }
      const mid = (lo + hi) >>> 1
      visit(lo, mid, node * 2 + 1); visit(mid, hi, node * 2 + 2)
    }
    visit(0, this.cues.length, 0)
    return active.join('\n').slice(0, 8192)
  }
}

export async function loadSubtitles(source: string | File, signal: AbortSignal): Promise<SubtitleTimeline> {
  stopped(signal)
  const controller = new AbortController(), cancel = () => controller.abort()
  signal.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(cancel, 30000)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    let bytes: Uint8Array
    if (typeof source === 'string') {
      if (source.length > 8192) throw invalid()
      let url: string
      try { url = httpUrl(source) } catch { throw new SubtitleError('Enter an HTTP or HTTPS subtitle URL without a username or password in its address.') }
      let response: Response
      try { response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' }) }
      catch { throw new SubtitleError('Cannot load this subtitle URL. Check the address and server cross-origin access. Provider login headers are not sent.') }
      if (!response.ok) throw new SubtitleError('The subtitle server did not return a file. Check the address and your access.')
      if (Number(response.headers.get('content-length')) > SUBTITLE_BYTES) throw new SubtitleError('Subtitle files must be 2 MB or smaller.')
      if (!response.body) throw new SubtitleError('This browser cannot safely read the subtitle response.')
      reader = response.body.getReader()
      const chunks: Uint8Array[] = []; let size = 0
      while (true) {
        stopped(controller.signal)
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > SUBTITLE_BYTES) throw new SubtitleError('Subtitle files must be 2 MB or smaller.')
        chunks.push(value)
      }
      bytes = new Uint8Array(size); let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    } else {
      if (source.size > SUBTITLE_BYTES) throw new SubtitleError('Subtitle files must be 2 MB or smaller.')
      bytes = new Uint8Array(await readFile(source, controller.signal))
    }
    stopped(controller.signal)
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw invalid() }
    return await parseSubtitles(text, controller.signal)
  } catch (error) {
    stopped(signal)
    if (controller.signal.aborted) throw new SubtitleError('Subtitle loading took too long. Check the connection and try again.')
    // Errors produced here are safe; raw fetch/stream errors can contain private addresses.
    if (error instanceof SubtitleError) throw error
    throw new SubtitleError('The subtitle file could not be read. Check the file and connection, then retry.')
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', cancel); controller.abort()
    void reader?.cancel().catch(() => {})
  }
}

function readFile(file: File, signal: AbortSignal): Promise<ArrayBuffer> {
  // FileReader also works on older TV engines without Blob.arrayBuffer().
  return new Promise((resolve, reject) => {
    const reader = new FileReader(), cancel = () => reader.abort()
    const finish = () => signal.removeEventListener('abort', cancel)
    signal.addEventListener('abort', cancel, { once: true })
    reader.onload = () => { finish(); resolve(reader.result as ArrayBuffer) }
    reader.onerror = () => { finish(); reject(new SubtitleError('The subtitle file could not be read.')) }
    reader.onabort = () => { finish(); reject(new DOMException('Cancelled', 'AbortError')) }
    try { stopped(signal); reader.readAsArrayBuffer(file) } catch (error) { finish(); reject(error) }
  })
}
