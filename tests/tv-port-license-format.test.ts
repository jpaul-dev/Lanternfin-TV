import { expect, it } from 'vitest'
import { licenseFormat, wrapLicense, unwrapLicense } from '../tv-app/license-format'
const challenge = new Uint8Array([0, 255, 128, 65]), encoded = 'AP+AQQ=='
const text = (value: Uint8Array) => new TextDecoder().decode(value)
it('accepts raw conventions and wraps byte-exact challenges without evaluating templates', () => {
  expect(licenseFormat('R{SSM}', 'R')).toEqual({}); expect(licenseFormat()).toEqual({})
  expect(text(wrapLicense(challenge, 'b{SSM}'))).toBe(encoded)
  expect(text(wrapLicense(challenge, 'challenge=B{SSM}&fixed=token'))).toBe('challenge=AP%2BAQQ%3D%3D&fixed=token')
  expect(text(wrapLicense(challenge.subarray(1, 3), 'D{SSM}'))).toBe('255,128')
  const format = licenseFormat(encodeURIComponent('{"challenge":"b{SSM}","id":"123"}'), 'JBlicense')
  expect(JSON.parse(text(wrapLicense(challenge, format.request!)))).toEqual({ challenge: encoded, id: '123' })
})
it('unwraps bounded base64 and single-field JSON responses', () => {
  expect(unwrapLicense(encoded, 'B')).toEqual(challenge)
  expect(unwrapLicense(JSON.stringify({ license: encoded }), 'JBlicense')).toEqual(challenge)
  expect(unwrapLicense(JSON.stringify({ license: '\u0000\u00ff\u0080A' }), 'Jlicense')).toEqual(challenge)
})
it('rejects formats requiring unimplemented session IDs or security policy extraction', () => {
  for (const [request, response] of [['R{SSM}', 'JBlicense;hdcp'], ['b{SSM}+R{SID}', 'R'], ['R{KID}', 'R'], ['b{SSM}+{UNKNOWN}', 'B'], ['b{SSM}', 'JBpath.to.license'], ['b{SSM}', 'HB']]) expect(() => licenseFormat(request, response)).toThrow('unsupported')
})
it('fails on missing fields, malformed bytes and oversized input without leaking the payload', () => {
  for (const data of ['{"secret":"private"}', '{"license":42}', '{"license":"!private!"}', 'not JSON']) expect(() => unwrapLicense(data, 'JBlicense')).toThrow('provider license format')
  expect(() => unwrapLicense('{"license":"漢"}', 'Jlicense')).toThrow()
  expect(() => wrapLicense(new Uint8Array(512 * 1024 + 1), 'b{SSM}')).toThrow()
  expect(() => unwrapLicense('x'.repeat(4 * 1024 * 1024 + 1), 'B')).toThrow()
})
