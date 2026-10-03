import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { deflateRawSync, gzipSync } from 'node:zlib'
import { createSetupService, inspectSignedWidget, inspectLgPackage, LG_ID } from '../tv-setup/core.mjs'
import { runProcess } from '../tv-setup/runner.mjs'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'lanternfin-setup-test-')) })
afterEach(async () => {
  if (!resolve(root).startsWith(resolve(tmpdir()) + '\\lanternfin-setup-test-') && !resolve(root).startsWith(resolve(tmpdir()) + '/lanternfin-setup-test-')) throw new Error('Unexpected fixture path')
  await rm(root, { recursive: true, force: true })
})
async function file(path: string, value = '') { await mkdir(dirname(path), { recursive: true }); await writeFile(path, value) }
const context = () => ({ signal: new AbortController().signal, log: vi.fn(), step: vi.fn() })
async function lgTools() { await file(join(root, 'packaging/tv-tools/node_modules/@webos-tools/cli/bin/ares-install.js')) }
async function samsungTools() {
  const path = join(root, 'Samsung SDK')
  await file(join(path, 'tools', process.platform === 'win32' ? 'sdb.exe' : 'sdb'))
  await file(join(path, 'tools/ide/bin', process.platform === 'win32' ? 'tizen.bat' : 'tizen'))
  return path
}
function widget(signed = true, id = 'LantFin001.LanternfinTV', compress = false) {
  const entries = [['config.xml', `<widget><tizen:application id="${id}" /></widget>`], ...(signed ? [['author-signature.xml', '<Signature xmlns="test" />'], ['signature1.xml', '<Signature xmlns="test" />']] : [])]
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0
  for (const [name, text] of entries) {
    const n = Buffer.from(name), raw = Buffer.from(text), data = compress ? deflateRawSync(raw) : raw
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(n.length, 26)
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50); dir.writeUInt16LE(compress ? 8 : 0, 10); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(raw.length, 24); dir.writeUInt16LE(n.length, 28); dir.writeUInt32LE(offset, 42)
    locals.push(header, n, data); central.push(dir, n); offset += header.length + n.length + data.length
  }
  const end = Buffer.alloc(22), directory = Buffer.concat(central); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
function ipk(id = LG_ID) {
  const data = Buffer.from(JSON.stringify({ id })), header = Buffer.alloc(512)
  header.write(`./usr/palm/applications/${id}/appinfo.json`); header.write(data.length.toString(8).padStart(11, '0') + '\0', 124)
  const tar = gzipSync(Buffer.concat([header, data, Buffer.alloc(512 - data.length), Buffer.alloc(1024)]))
  const ar = Buffer.alloc(60, ' '); ar.write('data.tar.gz', 0); ar.write(String(tar.length), 48)
  return Buffer.concat([Buffer.from('!<arch>\n'), ar, tar, Buffer.alloc(tar.length % 2)])
}
it('rejects unsigned and unrelated widgets and reads compressed signatures without extracting paths', () => {
  expect(() => inspectSignedWidget(widget(false))).toThrow('unsigned')
  expect(() => inspectSignedWidget(widget(true, 'Other.App'))).toThrow('not the Lanternfin')
  expect(inspectSignedWidget(widget(true, undefined, true)).sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(() => inspectSignedWidget(Buffer.from('not a widget'))).toThrow()
})
it('checks LG app identity inside the package', () => {
  expect(inspectLgPackage(ipk()).sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(() => inspectLgPackage(ipk('another.app'))).toThrow('does not contain')
})
it('pairs LG with an explicit target, sends the code separately, and verifies the TV', async () => {
  await lgTools()
  const runner = vi.fn().mockResolvedValue('Success'), service = createSetupService({ root, runner })
  const params = { ip: '192.168.1.50', passphrase: 'AbC123', devModeConfirmed: true }
  await service.execute('pair-lg', params, context())
  const calls = runner.mock.calls
  expect(calls.map(call => JSON.stringify(call[1])).join('')).not.toContain('AbC123')
  const pair = calls.find(call => call[1].includes('--getkey'))!
  expect(pair[2]).toMatchObject({ secret: 'AbC123', suppressOutput: true })
  expect(calls[0][2].suppressOutput).toBe(true)
  expect(calls.find(call => call[1].includes('--add'))![2].suppressOutput).toBe(true)
  expect(calls.at(-1)![1]).toContain('--system-info')
  expect(params.passphrase).toBe(''); expect((await service.status()).linked).toContain('lg:192.168.1.50')
})
it('does not replace an existing LG registration for another target', async () => {
  await lgTools()
  const runner = vi.fn().mockResolvedValue('lanternfin-lg-192-168-1-50 prisoner@192.168.1.51:9922 ssh tv secret')
  const service = createSetupService({ root, runner })
  await expect(service.execute('pair-lg', { ip: '192.168.1.50', passphrase: 'AbC123', devModeConfirmed: true }, context())).rejects.toThrow('somewhere else')
  expect(runner).toHaveBeenCalledOnce()
})
it('does not mark pairing successful when the final connection check fails', async () => {
  await lgTools()
  const runner = vi.fn(async (_file, args) => { if (args.includes('--system-info')) throw new Error('TV not available'); return 'Success' })
  const service = createSetupService({ root, runner })
  await expect(service.execute('pair-lg', { ip: '192.168.1.50', passphrase: 'AbC123', devModeConfirmed: true }, context())).rejects.toThrow()
  expect((await service.status()).linked).toEqual([])
})
it('requires Developer Mode acknowledgement and never runs against an unsafe IP', async () => {
  await lgTools(); const runner = vi.fn(), service = createSetupService({ root, runner })
  await expect(service.execute('pair-lg', { ip: '192.168.1.50', passphrase: 'AbC123' }, context())).rejects.toThrow('checklist')
  await expect(service.execute('pair-lg', { ip: '8.8.8.8', passphrase: 'AbC123', devModeConfirmed: true }, context())).rejects.toThrow('private')
  expect(runner).not.toHaveBeenCalled()
})
it('refuses install and launch before a verified connection', async () => {
  const service = createSetupService({ root, runner: vi.fn() })
  await expect(service.execute('install-lg', { ip: '192.168.1.50' }, context())).rejects.toThrow('connection')
  await expect(service.execute('launch-samsung', { ip: '192.168.1.50' }, context())).rejects.toThrow('connection')
})
it('distinguishes an offline Samsung target from an accepted connection', async () => {
  const sdkRoot = await samsungTools(), runner = vi.fn().mockResolvedValue('192.168.1.50:26101 offline TV')
  const service = createSetupService({ root, runner }), params = { sdkRoot, ip: '192.168.1.50', devModeConfirmed: true }
  await expect(service.execute('connect-samsung', params, context())).rejects.toThrow('not accepted')
  expect((await service.status(sdkRoot)).linked).toEqual([])
  runner.mockResolvedValue('192.168.1.50:26101 device TV')
  await service.execute('connect-samsung', params, context()); expect((await service.status(sdkRoot)).linked).toContain('samsung:192.168.1.50')
  await expect(service.execute('install-samsung', { ...params, profile: 'LanternfinTV' }, context())).rejects.toThrow('Sign a fresh')
})
it('opens only detected Samsung vendor launchers and explains missing tools', async () => {
  const sdkRoot = await samsungTools(), opener = vi.fn().mockResolvedValue(undefined)
  const launcher = join(sdkRoot, 'tools/certificate-manager', process.platform === 'win32' ? 'certificate-manager.exe' : 'certificate-manager')
  await file(launcher)
  const service = createSetupService({ root, runner: vi.fn(), opener })
  expect((await service.status(sdkRoot)).sdk.gui).toContain('certificate-manager')
  await service.execute('open-certificate-manager', { sdkRoot, file: 'untrusted.exe' }, context())
  expect(opener).toHaveBeenCalledExactlyOnceWith(launcher)
  await expect(service.execute('open-device-manager', { sdkRoot }, context())).rejects.toThrow('launcher was not found')
  await expect(service.execute('open-untrusted', { sdkRoot }, context())).rejects.toThrow('Unknown setup action')
  expect(opener).toHaveBeenCalledOnce()
})
it('only installs the explicit paired LG package and records success after the tool exits', async () => {
  await lgTools(); const runner = vi.fn(async (_file, args) => args.includes('--list') ? 'lanternfin-lg-192-168-1-50 prisoner@192.168.1.50:9922 ssh tv hidden' : 'Success')
  const service = createSetupService({ root, runner }), params = { ip: '192.168.1.50' }
  const path = join(root, 'artifacts/tv-preview-0.1.0', LG_ID + '_0.1.0_all.ipk'); await mkdir(dirname(path), { recursive: true }); await writeFile(path, ipk())
  await service.execute('check-lg', params, context()); await service.execute('install-lg', params, context()); await service.execute('launch-lg', params, context())
  expect((await service.status()).installed).toEqual(['lg:192.168.1.50'])
  expect(runner.mock.calls.at(-1)![1]).toEqual([expect.stringContaining('ares-launch.js'), '--device', 'lanternfin-lg-192-168-1-50', LG_ID])
})
it('signs into a fresh directory, checks both signatures, and rejects a changed package before install', async () => {
  const sdkRoot = await samsungTools()
  await file(join(root, 'node_modules/vite/package.json'), '{}')
  const assets = ['app.js', 'app.css', 'index.html', 'config.xml', 'icon.png', 'LICENSE', 'NOTICE.txt', 'build.json', 'startup.js', 'shaka-player.compiled.js', 'mpegts.js', 'epg-worker.js', 'mp4-text-worker.js', 'i18n-fr.json', 'LICENSE-Shaka.txt']
  for (const name of assets) await file(join(root, 'dist/tv/tizen', name), name)
  let signedPath = ''
  const runner = vi.fn(async (_command, args) => {
    if (args[0] === 'build-web') {
      for (const name of assets) expect(await readFile(join(args.at(-1), name), 'utf8')).toBe(name)
      await mkdir(join(args.at(-1), '.buildResult'))
    }
    if (args[0] === 'package') { signedPath = join(args.at(-1), 'LanternfinTV.wgt'); await writeFile(signedPath, widget(true)) }
    return args[0] === 'devices' ? '192.168.1.50:26101 device TV' : 'Success'
  })
  const service = createSetupService({ root, runner })
  const params = { sdkRoot, ip: '192.168.1.50', profile: 'Living Room TV', devModeConfirmed: true, certificateConfirmed: true }
  await service.execute('connect-samsung', params, context())
  await service.execute('sign-samsung', params, context())
  expect((await service.status(sdkRoot)).signed).toEqual([sdkRoot + '|Living Room TV'])
  const command = runner.mock.calls.find(call => call[1][0] === 'package')!
  expect(command[1]).toEqual(['package', '-t', 'wgt', '-s', 'Living Room TV', '--', expect.stringContaining('.buildResult')])
  await service.execute('install-samsung', params, context())
  expect(runner.mock.calls.at(-1)![1]).toEqual(['install', '-s', '192.168.1.50:26101', '-n', 'LanternfinTV.wgt', '--', expect.stringContaining('.buildResult')])
  const installs = runner.mock.calls.filter(call => call[1][0] === 'install').length
  await writeFile(signedPath, widget(true, undefined, true))
  await expect(service.execute('install-samsung', params, context())).rejects.toThrow('changed')
  expect(runner.mock.calls.filter(call => call[1][0] === 'install')).toHaveLength(installs)
})
it.runIf(process.platform === 'win32')('runs Windows vendor batch launchers safely from paths and arguments containing spaces', async () => {
  const batch = join(root, 'TV tools', 'fixture.bat')
  await file(batch, '@echo off\r\necho profile=[%~1]\r\n')
  expect(await runProcess(batch, ['Living Room TV'])).toContain('profile=[Living Room TV]')
})
