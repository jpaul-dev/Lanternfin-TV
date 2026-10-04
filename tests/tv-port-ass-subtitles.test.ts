// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { loadSubtitles, parseSubtitles } from '../tv-app/external-subtitles'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const format = 'Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
const ass = (events: string, header = '', columns = format) => `[Script Info]\nScriptType: v4.00+\n${header}\n[Events]\nFormat: ${columns}\n${events}`
const dialogue = (text: string, start = '0:00:01.25', end = '0:00:03.50') => `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`

it('reads centisecond ASS dialogue in file order, with commas, overlaps, backwards seeks and ignored attachments/events', async () => {
  const header = '[V4+ Styles]\nFormat: Name, Fontname\nStyle: Default,Unavailable Font\n[Fonts]\nfontname: ignored.ttf\nencoded-font-data\n[Graphics]\nfilename: ignored.bmp'
  const cues = await parseSubtitles('\uFEFF; optional comment\r\n' + ass([
    dialogue('Later, line', '0:00:02.00', '0:00:04.00'),
    'Comment: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,Do not display',
    'Picture: private-image.bmp', 'Sound: private-audio.wav', 'Command: private-command',
    dialogue(String.raw`{\i1}Hello{\i0}, world\NSecond line`),
  ].join('\n'), header).replace(/\n/g, '\r\n'))
  expect(cues.count).toBe(2)
  expect(cues.at(1.24)).toBe(''); expect(cues.at(1.25)).toBe('Hello, world\nSecond line')
  expect(cues.at(2)).toBe('Hello, world\nSecond line\nLater, line')
  expect(cues.at(3.5)).toBe('Later, line'); expect(cues.at(4)).toBe('')
  expect(cues.at(1.25)).toBe('Hello, world\nSecond line')
})

it('reads SSA Marked events and named timing fields without guessing a fixed column order', async () => {
  const text = '[Script Info]\nScriptType: v4.00\n[V4 Styles]\nStyle: ignored\n[Events]\nFormat: End, Marked, Start, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 1:01:03.75,Marked=0,1:01:01.05,Default,Speaker,0,0,0,,Bonjour, مرحبا, 日本語'
  const cues = await loadSubtitles(new File([text], 'captions.ssa', { type: 'text/x-ssa' }), new AbortController().signal)
  expect(cues.at(3661.05)).toBe('Bonjour, مرحبا, 日本語')
  expect(cues.at(3663.75)).toBe('')
})

it('keeps HTML/entities inert and preserves hard spaces, hard/soft line breaks and per-dialogue wrapping', async () => {
  const text = String.raw`\h<img src=x onerror=alert(1)> &amp; <b>literal</b>\Nhard\nspace{\q2}\nline{\q0}\nspace{\r}\nreset\h`
  const cues = await parseSubtitles(ass(dialogue(text)))
  expect(cues.at(2)).toBe('\u00a0<img src=x onerror=alert(1)> &amp; <b>literal</b>\nhard space\nline space reset\u00a0')
  const wrapped = await parseSubtitles(ass(dialogue(String.raw`A\nB{\q0}\nC{\rOther}\nD`) + '\n' + dialogue(String.raw`E\nF`, '0:00:04.00', '0:00:05.00'), 'WrapStyle: 2'))
  expect(wrapped.at(2)).toBe('A\nB C\nD'); expect(wrapped.at(4)).toBe('E\nF')
})

it('omits drawing-mode content, ignores nested transform tags and never renders override comments', async () => {
  const cues = await parseSubtitles(ass([
    dialogue(String.raw`{comment}{\p1}m 0 0 l 100 100{\pbo5}more drawing{\p0}Visible {\t(0,100,\p1\q2)}text\nonly{\p2}m 0 0{\r} reset`),
    dialogue(String.raw`{\p1}m 0 0 l 10 10`),
    dialogue(String.raw`{\pbo10}Baseline is text`, '0:00:04.00', '0:00:05.00'),
  ].join('\n')))
  expect(cues.count).toBe(2); expect(cues.at(2)).toBe('Visible text only reset')
  expect(cues.at(4)).toBe('Baseline is text')
  await expect(parseSubtitles(ass(dialogue(String.raw`{\p1}m 0 0`)))).rejects.toThrow('no supported subtitle cues')
})

it('rejects ambiguous versions, sections, event formats, malformed times and oversized text', async () => {
  for (const text of [
    ass(dialogue('text')).replace('v4.00+', 'v4.00++'),
    ass(dialogue('text')).replace('ScriptType: v4.00+', ''),
    ass(dialogue('text')).replace('ScriptType: v4.00+', 'ScriptType: v4.00+\nScriptType: v4.00+'),
    ass(dialogue('text')) + '\n[Events]\n' + dialogue('duplicate'),
    ass(dialogue('text'), '', 'Start, Text, End'),
    ass(dialogue('text'), '', 'Start, Start, End, Text'),
    ass(dialogue('text'), '', 'Start, Text'),
    ass(dialogue('text')).replace('Format: ' + format, ''),
    ass('Format: ' + format + '\n' + dialogue('text')),
    ass('Dialogue: 0,0:00:01.00,too,few,fields'),
    ass(dialogue('text', '0:00:60.00')),
    ass(dialogue('text', '0:00:01.250')),
    ass(dialogue('text', '-1:00:01.00')),
    ass(dialogue('text', '0:00:04.00')),
    ass(dialogue('text', '168:00:00.00', '168:00:01.00')),
    ass(dialogue('text'), 'WrapStyle: 4'),
    ass(dialogue('{unfinished override')),
    ass(dialogue('x'.repeat(4097))),
    ass(dialogue('{comment' + 'x'.repeat(16384) + '}')),
  ]) await expect(parseSubtitles(text)).rejects.toThrow()
})

it('bounds total dialogue events even when they contain only drawings, and cooperatively cancels', async () => {
  vi.useFakeTimers()
  const text = ass(Array.from({ length: 2000 }, (_, i) => dialogue(`Caption ${i}`)).join('\n'))
  const controller = new AbortController(), pending = parseSubtitles(text, controller.signal)
  const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort(); await vi.runAllTimersAsync(); await cancelled
  const completed = parseSubtitles(text); await vi.runAllTimersAsync()
  expect((await completed).at(2).split('\n')).toHaveLength(8)
  const limit = expect(parseSubtitles(ass((dialogue(String.raw`{\p1}m 0 0`) + '\n').repeat(20001)))).rejects.toThrow('20,000 cues')
  await vi.runAllTimersAsync(); await limit
})

it('loads ASS by content without fetching its font/image/sound references or forwarding credentials', async () => {
  const text = ass(dialogue('Working captions'), '[Fonts]\nfontname: https://private.invalid/font.ttf\n[Graphics]\nfilename: https://private.invalid/image.bmp')
  const fetch = vi.fn(async () => new Response(text, { headers: { 'Content-Type': 'application/octet-stream' } })); vi.stubGlobal('fetch', fetch)
  const cues = await loadSubtitles('https://captions.example/download?id=123', new AbortController().signal)
  expect(cues.at(2)).toBe('Working captions'); expect(fetch).toHaveBeenCalledOnce()
  expect(fetch.mock.calls[0]).toEqual(['https://captions.example/download?id=123', {
    credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: expect.any(AbortSignal),
  }])
})
