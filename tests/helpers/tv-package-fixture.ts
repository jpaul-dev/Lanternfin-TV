import { createHash } from 'node:crypto'
import { gzipSync, deflateRawSync, crc32 } from 'node:zlib'
import { CORE_ASSETS, LG_ID, SAMSUNG_ID } from '../../tv-setup/package.mjs'
export const COMMIT = 'abcde12345'.repeat(4)
export function buildFiles(target = 'webos', id = target === 'webos' ? LG_ID : SAMSUNG_ID): Map<string, Buffer> {
  const files = new Map<string, Buffer>(CORE_ASSETS.map((name: string) => [name, Buffer.from(`fixture: ${name}`)]))
  if (target === 'webos') { files.set('appinfo.json', Buffer.from(JSON.stringify({ id }))); files.set('large-icon.png', Buffer.from('large icon')) }
  else files.set('config.xml', Buffer.from(`<widget><tizen:application id="${id}" /></widget>`))
  files.set('build.json', Buffer.from(JSON.stringify({ target, version: '0.1.0', commit: COMMIT, dirty: false, hashes: Object.fromEntries([...files].map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')])) })))
  return files
}
export function zip(entries: [string, Buffer][], compress = false): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0
  for (const [name, raw] of entries) {
    const n = Buffer.from(name), data = compress ? deflateRawSync(raw) : raw
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(compress ? 8 : 0, 8); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(raw.length, 22); header.writeUInt16LE(n.length, 26)
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50); dir.writeUInt16LE(compress ? 8 : 0, 10); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(raw.length, 24); dir.writeUInt16LE(n.length, 28); dir.writeUInt32LE(offset, 42)
    header.writeUInt32LE(crc32(raw), 14); dir.writeUInt32LE(crc32(raw), 16)
    locals.push(header, n, data); central.push(dir, n); offset += header.length + n.length + data.length
  }
  const end = Buffer.alloc(22), directory = Buffer.concat(central); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
export function widget(signed = true, id = SAMSUNG_ID, compress = false, files = buildFiles('tizen', id)): Buffer {
  return zip([...files, ...(signed ? [['author-signature.xml', Buffer.from('<Signature xmlns="test" />')], ['signature1.xml', Buffer.from('<Signature xmlns="test" />')]] as [string, Buffer][] : [])], compress)
}
export function tar(entries: [string, Buffer, string?][]): Buffer {
  const members: Buffer[] = []
  for (const [name, data, type = '0'] of entries) {
    const header = Buffer.alloc(512)
    if (Buffer.byteLength(name) > 100) throw new Error('Fixture name too long')
    header.write(name); header.write(data.length.toString(8).padStart(11, '0') + '\0', 124); header.write(type, 156); header.fill(32, 148, 156)
    const sum = [...header].reduce((total, n) => total + n, 0); header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
    members.push(header, data, Buffer.alloc((512 - data.length % 512) % 512))
  }
  return Buffer.concat([...members, Buffer.alloc(1024)])
}
export function ar(data: Buffer): Buffer {
  const compressed = gzipSync(data), header = Buffer.alloc(60, ' ')
  header.write('data.tar.gz'); header.write(String(compressed.length), 48); header.write('`\n', 58)
  return Buffer.concat([Buffer.from('!<arch>\n'), header, compressed, Buffer.alloc(compressed.length % 2)])
}
export function ipk(id = LG_ID, files = buildFiles('webos', id)): Buffer {
  return ar(tar([...files].map(([name, value]) => [`./usr/palm/applications/${id}/${name}`, value])))
}
