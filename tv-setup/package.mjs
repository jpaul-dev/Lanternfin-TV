import { createHash } from 'node:crypto'
import { inflateRawSync, gunzipSync } from 'node:zlib'

export const LG_ID = 'io.github.jpauldev.lanternfin'
export const SAMSUNG_ID = 'LantFin001.LanternfinTV'
const LIMIT = 100 * 1024 * 1024, MEMBER_LIMIT = 32 * 1024 * 1024, MAX_FILES = 512
const locales = ['es', 'de', 'fr', 'pt-BR', 'it', 'ru', 'zh', 'ja', 'tr', 'ar', 'ur', 'nl', 'hi', 'id', 'pl']
export const CORE_ASSETS = ['app.js', 'app.css', 'index.html', 'startup.js', 'icon.png', 'epg-worker.js', 'mp4-text-worker.js', 'mkv-text-worker.js', 'shaka-player.compiled.js', 'mpegts.js', 'LICENSE', 'NOTICE.txt', 'LICENSE-Shaka.txt', 'LICENSE-mpegts.txt', 'LICENSE-Geist.txt', 'LICENSE-fflate.txt', ...locales.map(code => `locale-${code}.js`)]
const digest = data => createHash('sha256').update(data).digest('hex')
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => { for (let i = 0; i < 8; i++) byte = byte & 1 ? 0xedb88320 ^ byte >>> 1 : byte >>> 1; return byte >>> 0 })
function crc32(data) { let crc = 0xffffffff; for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0 }
const invalid = () => new Error('The app package is incomplete or damaged. Build it again before installing.')
const text = (data, start, size) => data.subarray(start, start + size).toString('utf8').replace(/\0.*$/s, '')
function nameOf(raw) {
  const name = raw.replace(/^\.\//, '').replace(/\/$/, '')
  if (!name || name.length > 512 || /[\\\x00-\x1f]/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..')) throw invalid()
  return name
}

/** Check bytes inside the archive; never extract paths or execute packaged code. */
function verifyBuild(members, target, expectedManifest) {
  const raw = members.get('build.json')
  if (!raw || raw.length > 128 * 1024 || expectedManifest && !raw.equals(expectedManifest)) throw invalid()
  let build
  try { build = JSON.parse(raw.toString('utf8')) } catch { throw invalid() }
  if (build?.target !== target || typeof build.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(build.version) || typeof build.commit !== 'string' || !/^[a-f0-9]{40}$/.test(build.commit) || typeof build.dirty !== 'boolean' || !build.hashes || typeof build.hashes !== 'object' || Array.isArray(build.hashes)) throw invalid()
  const entries = Object.entries(build.hashes), required = [...CORE_ASSETS, ...(target === 'webos' ? ['appinfo.json', 'large-icon.png'] : ['config.xml'])]
  if (entries.length > 256 || required.some(name => !Object.prototype.hasOwnProperty.call(build.hashes, name))) throw invalid()
  for (const [name, hash] of entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name) || name === 'build.json' || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) || !members.has(name) || digest(members.get(name)) !== hash) throw invalid()
  }
  for (const name of members.keys()) if (!['build.json', ...(target === 'tizen' ? ['author-signature.xml', 'signature1.xml'] : [])].includes(name) && !Object.prototype.hasOwnProperty.call(build.hashes, name)) throw invalid()
  return { target, version: build.version, commit: build.commit, modified: build.dirty, assets: entries.length }
}

function zipMembers(data) {
  if (!Buffer.isBuffer(data) || data.length > LIMIT) throw invalid()
  let end = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50 && i + 22 + data.readUInt16LE(i + 20) === data.length) { end = i; break }
  }
  if (end < 0 || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6)) throw invalid()
  const count = data.readUInt16LE(end + 10), directory = data.readUInt32LE(end + 16)
  if (count < 1 || count > MAX_FILES || data.readUInt16LE(end + 8) !== count || directory + data.readUInt32LE(end + 12) !== end) throw invalid()
  let offset = directory, expanded = 0
  const members = new Map(), seen = new Set(), ranges = []
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || data.readUInt32LE(offset) !== 0x02014b50) throw invalid()
    const flags = data.readUInt16LE(offset + 8), method = data.readUInt16LE(offset + 10), size = data.readUInt32LE(offset + 20), unpacked = data.readUInt32LE(offset + 24)
    const nameLength = data.readUInt16LE(offset + 28), next = offset + 46 + nameLength + data.readUInt16LE(offset + 30) + data.readUInt16LE(offset + 32)
    const fileType = data.readUInt32LE(offset + 38) >>> 16 & 0xf000
    if (next > end || flags & 1 || data.readUInt16LE(offset + 34) || ![0, 0x4000, 0x8000].includes(fileType) || ![0, 8].includes(method) || size > LIMIT || unpacked > MEMBER_LIMIT) throw invalid()
    const rawName = data.subarray(offset + 46, offset + 46 + nameLength), name = nameOf(rawName.toString('utf8'))
    if (seen.has(name)) throw invalid()
    seen.add(name)
    const local = data.readUInt32LE(offset + 42)
    if (local + 30 > directory || data.readUInt32LE(local) !== 0x04034b50 || data.readUInt16LE(local + 6) !== flags || data.readUInt16LE(local + 8) !== method || data.readUInt16LE(local + 26) !== nameLength) throw invalid()
    const start = local + 30 + nameLength + data.readUInt16LE(local + 28), stop = start + size
    if (stop > directory || !data.subarray(local + 30, local + 30 + nameLength).equals(rawName) || ranges.some(([lo, hi]) => local < hi && stop > lo)) throw invalid()
    ranges.push([local, stop])
    let value
    try { value = method === 0 ? data.subarray(start, stop) : inflateRawSync(data.subarray(start, stop), { maxOutputLength: Math.max(1, Math.min(MEMBER_LIMIT, LIMIT - expanded, unpacked)) }) } catch { throw invalid() }
    expanded += value.length
    if (value.length !== unpacked || expanded > LIMIT || crc32(value) !== data.readUInt32LE(offset + 16)) throw invalid()
    if (!(flags & 8) && (data.readUInt32LE(local + 14) !== data.readUInt32LE(offset + 16) || data.readUInt32LE(local + 18) !== size || data.readUInt32LE(local + 22) !== unpacked)) throw invalid()
    if (rawName.toString().endsWith('/')) { if (value.length) throw invalid() }
    else members.set(name, value)
    offset = next
  }
  if (offset !== end) throw invalid()
  return members
}

function inspectWidget(data, expectedManifest, signed) {
  const members = zipMembers(data)
  if (!/<tizen:application\b[^>]*\bid=["']LantFin001\.LanternfinTV["']/.test(members.get('config.xml')?.toString() || '')) throw new Error('This widget is not the Lanternfin TV app.')
  for (const name of signed ? ['author-signature.xml', 'signature1.xml'] : []) {
    const signature = members.get(name)
    if (!signature || signature.length > 1024 * 1024 || !/<(?:\w+:)?Signature[\s>]/.test(signature.toString())) throw new Error('The widget is unsigned. Finish the Samsung certificate step first.')
  }
  // Presence is checked here; cryptographic signature trust is checked by the TV.
  return { sha256: digest(data), bytes: data.length, build: verifyBuild(members, 'tizen', expectedManifest) }
}
export const inspectSignedWidget = (data, expectedManifest) => inspectWidget(data, expectedManifest, true)
export const inspectUnsignedWidget = (data, expectedManifest) => inspectWidget(data, expectedManifest, false)

function tarMembers(data) {
  const members = new Map(), seen = new Set()
  let offset = 0, count = 0
  for (; offset + 512 <= data.length && data[offset];) {
    const header = data.subarray(offset, offset + 512)
    const lengthText = text(header, 124, 12).trim(), sumText = text(header, 148, 8).trim()
    if (!/^[0-7]+$/.test(lengthText) || !/^[0-7]+$/.test(sumText)) throw invalid()
    const length = parseInt(lengthText, 8), sum = [...header].reduce((total, byte, i) => total + (i >= 148 && i < 156 ? 32 : byte), 0)
    if (sum !== parseInt(sumText, 8) || length > MEMBER_LIMIT || offset + 512 + Math.ceil(length / 512) * 512 > data.length || ++count > MAX_FILES) throw invalid()
    const prefix = text(header, 345, 155), rawName = `${prefix ? prefix + '/' : ''}${text(header, 0, 100)}`
    const name = rawName === './' || rawName === '.' ? '' : nameOf(rawName), type = header[156]
    if (seen.has(name) || ![0, 48, 53].includes(type)) throw invalid()
    seen.add(name)
    if (type === 53) { if (length) throw invalid() }
    else { if (!name) throw invalid(); members.set(name, data.subarray(offset + 512, offset + 512 + length)) }
    offset += 512 + Math.ceil(length / 512) * 512
  }
  if (offset + 1024 > data.length || data.subarray(offset).some(byte => byte !== 0)) throw invalid()
  return members
}

export function inspectLgPackage(data, expectedManifest) {
  if (!Buffer.isBuffer(data) || data.length > LIMIT || data.subarray(0, 8).toString() !== '!<arch>\n') throw invalid()
  let archive, offset = 8
  const seen = new Set()
  for (; offset + 60 <= data.length;) {
    const header = data.subarray(offset, offset + 60), name = header.subarray(0, 16).toString().trim().replace(/\/$/, ''), sizeText = header.subarray(48, 58).toString().trim()
    if (header.subarray(58).toString() !== '`\n' || !/^\d+$/.test(sizeText) || seen.has(name)) throw invalid()
    seen.add(name)
    const length = Number(sizeText)
    if (!Number.isSafeInteger(length) || offset + 60 + length + length % 2 > data.length) throw invalid()
    if (name === 'data.tar.gz') { try { archive = gunzipSync(data.subarray(offset + 60, offset + 60 + length), { maxOutputLength: LIMIT }) } catch { throw invalid() } }
    offset += 60 + length + length % 2
  }
  if (offset !== data.length || !archive) throw invalid()
  const all = tarMembers(archive), prefix = `usr/palm/applications/${LG_ID}/`, members = new Map()
  for (const [name, bytes] of all) if (name.startsWith(prefix)) members.set(name.slice(prefix.length), bytes)
  let app
  try { app = JSON.parse(members.get('appinfo.json')?.toString() || 'null') } catch { throw invalid() }
  if (app?.id !== LG_ID) throw new Error('This LG package does not contain Lanternfin TV.')
  return { sha256: digest(data), bytes: data.length, build: verifyBuild(members, 'webos', expectedManifest) }
}
