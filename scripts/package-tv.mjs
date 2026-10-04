import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { inspectLgPackage, inspectUnsignedWidget } from '../tv-setup/package.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2]
if (!['webos', 'tizen'].includes(target)) throw new Error('Usage: node scripts/package-tv.mjs webos|tizen')
const source = resolve(root, 'dist/tv', target)
const output = resolve(root, 'artifacts/tv-preview-0.1.0')
await mkdir(output, { recursive: true })
const metadata = JSON.parse(await readFile(resolve(source, 'build.json'), 'utf8'))
for (const [name, hash] of Object.entries(metadata.hashes)) {
  if (createHash('sha256').update(await readFile(resolve(source, name))).digest('hex') !== hash) throw new Error(`Changed build asset: ${name}. Rebuild before packaging.`)
}
if (target === 'webos') {
  const cli = resolve(root, 'packaging/tv-tools/node_modules/@webos-tools/cli/bin/ares-package.js')
  execFileSync(process.execPath, [cli, source, '--no-minify', '--outdir', output], { cwd: root, stdio: 'inherit' })
} else {
  // A WGT is a ZIP. Deliberately unsigned; Samsung device certificates are personal.
  // This minimal STORE-only ZIP writer uses no external archiver or build-time downloads.
  function crc32(data) {
    let crc = 0xffffffff
    for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
    return (crc ^ 0xffffffff) >>> 0
  }
  const local = [], central = []; let offset = 0
  for (const file of (await readdir(source)).sort()) {
    const name = Buffer.from(file), data = await readFile(resolve(source, file)), crc = crc32(data)
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x800, 6); head.writeUInt16LE(33, 12)
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26)
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x800, 8); dir.writeUInt16LE(33, 14)
    dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42)
    local.push(head, name, data); central.push(dir, name); offset += head.length + name.length + data.length
  }
  const end = Buffer.alloc(22), directory = Buffer.concat(central)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  await writeFile(resolve(output, 'Lanternfin-TV-0.1.0-tizen-UNSIGNED.wgt'), Buffer.concat([...local, directory, end]))
  console.log('Created UNSIGNED Tizen widget. Sign with a Samsung TV certificate before device installation.')
}
const packageFile = resolve(output, target === 'webos' ? 'io.github.jpauldev.lanternfin_0.1.0_all.ipk' : 'Lanternfin-TV-0.1.0-tizen-UNSIGNED.wgt')
const inspected = (target === 'webos' ? inspectLgPackage : inspectUnsignedWidget)(await readFile(packageFile), await readFile(resolve(source, 'build.json')))
console.log(`Verified ${inspected.build.assets} packaged app files at revision ${inspected.build.commit.slice(0, 8)}${inspected.build.modified ? ' (local changes)' : ''}.`)
const suffix = target === 'webos' ? '.ipk' : '.wgt'
const checksums = []
for (const file of (await readdir(output)).filter(name => name.endsWith(suffix))) checksums.push(`${createHash('sha256').update(await readFile(resolve(output, file))).digest('hex')}  ${file}`)
await writeFile(resolve(output, `${target}-SHA256SUMS.txt`), checksums.join('\n') + '\n')
