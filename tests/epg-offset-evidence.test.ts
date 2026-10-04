// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { OffsetCoverage, estimateOffset, type OffsetEvidence } from '../src/scripts/lib/epg-offset-evidence'
import { inferTimezoneOffsetMin } from '../src/scripts/lib/epg-data.js'
import { handleWorkerRequest } from '../src/scripts/lib/epg-worker'
import { gzipSync } from 'node:zlib'

const now = Date.UTC(2026, 9, 3, 12), minute = 60000
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14)
afterEach(() => vi.restoreAllMocks())

it('matches full-schedule inference without retaining schedules, regardless of stream order', () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  for (const shift of [-720, -330, -30, 0, 60, 840]) {
    const sample = new OffsetCoverage(now), programmes = new Map<string, Array<{ start: number; stop: number }>>()
    for (let channel = 0; channel < 60; channel++) {
      const rows = [-360, 0, 360].map(delta => ({ start: now - shift * minute + (delta - 5) * minute, stop: now - shift * minute + (delta + 5) * minute }))
      programmes.set(String(channel), rows)
      for (const row of [...rows].reverse()) sample.add(String(channel), row.start, row.stop)
    }
    const evidence = sample.evidence(false)
    expect(evidence.channels).toBe(50); expect(evidence.scores).toHaveLength(53)
    for (const preferred of [undefined, 0, shift]) expect(estimateOffset(evidence, preferred).minutes).toBe(inferTimezoneOffsetMin(programmes, preferred))
    expect(JSON.stringify(evidence).length).toBeLessThan(250)
  }
})

it('does not double-count overlapping/repeated programmes and respects exclusive end times', () => {
  const sample = new OffsetCoverage(now)
  for (let i = 0; i < 100; i++) sample.add('one', now, now + 30 * minute)
  sample.add('two', now - 30 * minute, now)
  const evidence = sample.evidence(false)
  expect(evidence.scores[24]).toBe(1); expect(evidence.scores[25]).toBe(1)
  expect(estimateOffset(evidence).minutes).toBe(0)
})

it('keeps two-channel hysteresis, prefers zero on ties and refuses explicit or absent evidence', () => {
  const scores = Array(53).fill(0); scores[24] = 8; scores[26] = 9
  const evidence = { channels: 10, scores, explicit: false }
  expect(estimateOffset(evidence, 0).minutes).toBe(0)
  scores[26] = 10; expect(estimateOffset(evidence, 0).minutes).toBe(60)
  scores.fill(10); expect(estimateOffset(evidence).minutes).toBe(0)
  expect(estimateOffset({ ...evidence, explicit: true }, 60)).toMatchObject({ minutes: 0, reason: 'explicit' })
  scores.fill(0); expect(estimateOffset(evidence, 60)).toMatchObject({ minutes: 0, reason: 'empty' })
  for (const malformed of [undefined, {}, { channels: 51, scores, explicit: false }, { channels: 1, scores: [1], explicit: false }]) expect(estimateOffset(malformed as OffsetEvidence).minutes).toBe(0)
})

it.each([false, true])('collects full-schedule evidence during chunked download, gzip=%s', async gzip => {
  const feedId = `offset-${gzip}`, id = 770 + Number(gzip)
  const xml = '<tv>' + Array.from({ length: 52 }, (_, index) => `<programme channel="c${index}" start="${stamp(now - 125 * minute)}" stop="${stamp(now - 115 * minute)}"><title>Past in raw time</title></programme>`).join('') + '</tv>'
  const bytes = gzip ? gzipSync(xml) : new TextEncoder().encode(xml)
  handleWorkerRequest({ type: 'begin', id, feedId, nowMs: now, mode: 'now-next', gzip, offsetEvidence: true })
  for (let at = 0; at < bytes.length; at += 17) handleWorkerRequest({ type: 'chunk', id, feedId, bytes: new Uint8Array(bytes.slice(at, at + 17)).buffer })
  const result = await handleWorkerRequest({ type: 'end', id, feedId })
  expect(result).not.toHaveProperty('error'); expect(result.programmes).toEqual([])
  expect('offsetEvidence' in result && estimateOffset(result.offsetEvidence)).toEqual({ minutes: 120, channels: 50, reason: 'estimated' })
})

it('detects even one explicit timestamp outside the sampled channels', async () => {
  const id = 779, feedId = 'mixed-timezones'
  const xml = '<tv>' + Array.from({ length: 51 }, (_, index) => `<programme channel="${index}" start="${stamp(now + 115 * minute)}${index === 50 ? ' +0000' : ''}" stop="${stamp(now + 125 * minute)}"><title>Show</title></programme>`).join('') + '</tv>'
  handleWorkerRequest({ type: 'begin', id, feedId, nowMs: now, mode: 'now-next', gzip: false, offsetEvidence: true })
  handleWorkerRequest({ type: 'chunk', id, feedId, bytes: new TextEncoder().encode(xml).buffer })
  const result = await handleWorkerRequest({ type: 'end', id, feedId })
  expect('offsetEvidence' in result && estimateOffset(result.offsetEvidence)).toEqual({ minutes: 0, channels: 50, reason: 'explicit' })
})
