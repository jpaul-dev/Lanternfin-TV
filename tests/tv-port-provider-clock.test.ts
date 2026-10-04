import { expect, it } from 'vitest'
import { providerClockOffset } from '../tv-app/provider-clock'

it('accepts IANA-only providers including UTC and fractional offsets without choosing a fallback zone', () => {
  const at = Date.parse('2026-10-03T10:00:00.123Z')
  expect(providerClockOffset({ timezone: 'UTC' }, at)).toBe(0)
  expect(providerClockOffset({ timezone: 'Asia/Kathmandu' }, at)).toBe(345)
  expect(providerClockOffset({ timezone: 'Pacific/Kiritimati' }, at)).toBe(840)
  expect(providerClockOffset({ timezone: 'America/Denver' }, at)).toBe(-360)
  for (const timezone of ['Unknown/Provider', '', '<script>', 'x'.repeat(81)]) expect(() => providerClockOffset({ timezone }, at)).toThrow('provider did not report')
})
it('uses the programme date across daylight-saving boundaries when the reported clock agrees', () => {
  const now = Date.parse('2026-11-01T09:00:00Z'), earlier = Date.parse('2026-11-01T07:00:00Z')
  const clock = { timezone: 'America/Denver', time_now: '2026-11-01 02:00:00', timestamp_now: now / 1000 }
  expect(providerClockOffset(clock, now)).toBe(-420)
  expect(providerClockOffset(clock, earlier)).toBe(-360)
  expect(providerClockOffset({ timezone: 'America/Denver' }, earlier)).toBe(-360)
})
it('honors a valid explicit clock instead of an inconsistent provider timezone', () => {
  const now = Date.parse('2026-10-03T10:00:00Z')
  expect(providerClockOffset({ timezone: 'America/Denver', time_now: '2026-10-03 12:00:00', timestamp_now: now / 1000 }, now)).toBe(120)
  expect(providerClockOffset({ time_now: '2026-10-03 12:00:02', timestamp_now: now / 1000 }, now)).toBe(120)
})
it('rejects rolled calendar fields, zero epochs, invalid values and implausible explicit offsets', () => {
  const now = Date.parse('2026-10-03T10:00:00Z')
  for (const time_now of ['2026-02-31 12:00:00', '2026-13-03 12:00:00', '2026-10-03 25:00:00', '2026-10-06 12:00:00']) expect(() => providerClockOffset({ time_now, timestamp_now: now / 1000 }, now)).toThrow()
  for (const timestamp_now of [0, null, '', ' ', {}, NaN, Infinity]) expect(() => providerClockOffset({ time_now: '2026-10-03 12:00:00', timestamp_now }, now)).toThrow()
})
