import { expect, it } from 'vitest'
import { inspectLgPackage, inspectSignedWidget, inspectUnsignedWidget, LG_ID } from '../tv-setup/package.mjs'
import { buildFiles, widget, ipk, zip, ar, tar, COMMIT } from './helpers/tv-package-fixture'

it('verifies complete LG and signed Samsung assets and reports the exact source revision', () => {
  for (const compress of [false, true]) expect(inspectSignedWidget(widget(true, undefined, compress)).build).toEqual({ target: 'tizen', version: '0.1.0', commit: COMMIT, modified: false, assets: 34 })
  expect(inspectLgPackage(ipk()).build).toEqual({ target: 'webos', version: '0.1.0', commit: COMMIT, modified: false, assets: 35 })
  expect(inspectUnsignedWidget(widget(false)).build.assets).toBe(34)
  expect(() => inspectSignedWidget(widget(false))).toThrow('unsigned')
})

it.each(['app.css', 'app.js', 'startup.js', 'epg-worker.js', 'mp4-text-worker.js', 'mkv-text-worker.js', 'mp4-media-worker.js', 'LICENSE-MP4Box.txt', 'shaka-player.compiled.js', 'locale-fr.js', 'LICENSE-Shaka.txt'])('rejects missing %s even when identity and signatures remain', name => {
  for (const target of ['webos', 'tizen']) {
    const files = buildFiles(target); files.delete(name)
    const inspect = () => target === 'webos' ? inspectLgPackage(ipk(undefined, files)) : inspectSignedWidget(widget(true, undefined, true, files))
    expect(inspect).toThrow('incomplete or damaged')
    const manifest = JSON.parse(files.get('build.json')!.toString()); delete manifest.hashes[name]; files.set('build.json', Buffer.from(JSON.stringify(manifest)))
    expect(inspect).toThrow('incomplete or damaged')
  }
})

it('rejects changed assets, extra unrecorded files and a different expected build', () => {
  for (const target of ['webos', 'tizen']) {
    const files = buildFiles(target), original = files.get('app.css')!
    const inspect = (expected?: Buffer) => target === 'webos' ? inspectLgPackage(ipk(undefined, files), expected) : inspectSignedWidget(widget(true, undefined, false, files), expected)
    files.set('app.css', Buffer.from('modified stylesheet')); expect(inspect).toThrow()
    files.set('app.css', original); files.set('extra.js', Buffer.from('unexpected')); expect(inspect).toThrow()
    files.delete('extra.js'); expect(() => inspect(Buffer.from('{}'))).toThrow()
    expect(inspect(files.get('build.json')).build.commit).toBe(COMMIT)
  }
})

it('requires valid build metadata without treating archive text as a path or error message', () => {
  for (const patch of [{ target: 'browser' }, { dirty: 'false' }, { commit: 'secret value' }, { commit: { toString: 1 } }, { version: '<script>' }, { hashes: [] }]) {
    const files = buildFiles(), manifest = JSON.parse(files.get('build.json')!.toString())
    files.set('build.json', Buffer.from(JSON.stringify({ ...manifest, ...patch })))
    expect(() => inspectLgPackage(ipk(undefined, files))).toThrow('incomplete or damaged')
  }
  const files = buildFiles(); files.set('build.json', Buffer.alloc(129 * 1024))
  expect(() => inspectLgPackage(ipk(undefined, files))).toThrow()
})

it('rejects ambiguous ZIP members, traversal and disagreement between local and central names', () => {
  const entries = [...buildFiles('tizen')]
  for (const name of ['app.js', './app.js', '../app.js', '/app.js', 'folder\\app.js']) expect(() => inspectSignedWidget(zip([...entries, [name, Buffer.from('changed')]]))).toThrow()
  const data = widget(); data[30] ^= 1
  expect(() => inspectSignedWidget(data)).toThrow('incomplete or damaged')
  const badCrc = widget(), directory = badCrc.readUInt32LE(badCrc.length - 6)
  badCrc.writeUInt32LE(0, directory + 16); badCrc.writeUInt32LE(0, 14)
  expect(() => inspectSignedWidget(badCrc)).toThrow('incomplete or damaged')
  const link = widget(), linkDirectory = link.readUInt32LE(link.length - 6)
  link.writeUInt32LE(0xa1ff0000, linkDirectory + 38)
  expect(() => inspectSignedWidget(link)).toThrow('incomplete or damaged')
})

it('bounds ZIP expansion using the actual inflated data and rejects truncated directories', () => {
  const files = buildFiles('tizen'); files.set('app.js', Buffer.alloc(100000, 65))
  const data = widget(true, undefined, true, files), end = data.length - 22, directory = data.readUInt32LE(end + 16)
  data.writeUInt32LE(10, directory + 24)
  expect(() => inspectSignedWidget(data)).toThrow()
  expect(() => inspectSignedWidget(widget().subarray(0, -1))).toThrow()
  const many = widget(); many.writeUInt16LE(513, many.length - 12)
  expect(() => inspectSignedWidget(many)).toThrow()
})

it('rejects duplicate tar paths, links and damaged headers without extracting anything', () => {
  const entries: [string, Buffer][] = [...buildFiles()].map(([name, bytes]) => [`usr/palm/applications/${LG_ID}/${name}`, bytes])
  expect(() => inspectLgPackage(ar(tar([...entries, entries[0]])))).toThrow()
  expect(() => inspectLgPackage(ar(tar([...entries, ['link', Buffer.alloc(0), '2']])))).toThrow()
  const archive = tar(entries); archive[100] ^= 1
  expect(() => inspectLgPackage(ar(archive))).toThrow()
  expect(() => inspectLgPackage(ar(tar([['../outside', Buffer.from('x')], ...entries])))).toThrow()
})
