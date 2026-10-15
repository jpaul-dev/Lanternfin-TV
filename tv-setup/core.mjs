import { access, readFile, readdir, mkdir, copyFile } from 'node:fs/promises'
import { resolve, dirname, join, isAbsolute } from 'node:path'
import { isIP } from 'node:net'
import { networkInterfaces, homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { LG_ID, SAMSUNG_ID, inspectLgPackage, inspectSignedWidget } from './package.mjs'
export { LG_ID, SAMSUNG_ID, inspectLgPackage, inspectSignedWidget } from './package.mjs'
import { runProcess, openVendorWindow } from './runner.mjs'

export const ACTIONS = ['install-lg-tools', 'install-project-tools', 'build-lg', 'build-samsung', 'pair-lg', 'check-lg', 'connect-samsung', 'profiles-samsung', 'sign-samsung', 'install-lg', 'launch-lg', 'install-samsung', 'launch-samsung', 'open-certificate-manager', 'open-device-manager', 'open-package-manager']
const exists = async file => { try { await access(file); return true } catch { return false } }
export function privateIPv4(value) {
  if (typeof value !== 'string' || isIP(value.trim()) !== 4) throw new Error('Enter the TV’s IPv4 address, such as 192.168.1.50.')
  const ip = value.trim(), bytes = ip.split('.').map(Number)
  if (!(bytes[0] === 10 || (bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31) || (bytes[0] === 192 && bytes[1] === 168))) throw new Error('Use the TV’s private home-network address (10.x, 172.16–31.x, or 192.168.x).')
  return ip
}
export const lgDeviceName = ip => `lanternfin-lg-${privateIPv4(ip).replaceAll('.', '-')}`
export function certificateProfile(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_. -]{0,63}$/.test(value)) throw new Error('Enter a certificate profile name using letters, numbers, spaces, dots, underscores, or hyphens.')
  return value
}
export function connectedSamsung(output, ip) {
  const serial = `${privateIPv4(ip)}:26101`
  return output.split(/\r?\n/).some(line => { const fields = line.trim().split(/\s+/); return fields[0] === serial && fields[1] === 'device' })
}
export function localAddresses() {
  return Object.entries(networkInterfaces()).flatMap(([name, values]) => (values || []).flatMap(info => {
    if (info.internal || info.family !== 'IPv4') return []
    try { return [{ name, address: privateIPv4(info.address), virtual: /vethernet|virtual|vmware|vpn|wsl|docker/i.test(name) }] } catch { return [] }
  })).sort((a, b) => Number(a.virtual) - Number(b.virtual))
}

export function createSetupService({ root, runner = runProcess, opener = openVendorWindow } = {}) {
  const cliRoot = join(root, 'packaging/tv-tools/node_modules/@webos-tools/cli/bin')
  const ipk = join(root, 'artifacts/tv-preview-0.1.0', `${LG_ID}_0.1.0_all.ipk`)
  const linked = new Set(), signed = new Map(), installed = new Map()
  const lg = name => join(cliRoot, name + '.js')
  async function sdk(input = '') {
    if (typeof input !== 'string' || input.length > 512 || /[\x00-\x1f"%!?^&|<>]/.test(input)) throw new Error('Choose a simple Tizen Studio folder path without shell punctuation.')
    if (input && !isAbsolute(input)) throw new Error('Enter the full Tizen Studio folder path.')
    const paths = input ? [input] : [process.env.TIZEN_STUDIO_HOME, process.env.TIZEN_STUDIO, 'C:\\tizen-studio', join(homedir(), 'tizen-studio'), '/opt/tizen-studio'].filter(Boolean)
    for (const path of paths) {
      const base = resolve(path)
      const tizen = join(base, 'tools/ide/bin', process.platform === 'win32' ? 'tizen.bat' : 'tizen')
      const sdb = join(base, 'tools', process.platform === 'win32' ? 'sdb.exe' : 'sdb')
      if (await exists(tizen) && await exists(sdb)) {
        const gui = {}
        for (const tool of ['certificate-manager', 'device-manager', 'package-manager']) {
          const folders = tool === 'package-manager' ? ['package-manager'] : [`tools/${tool}`, `tools/${tool}/bin`]
          for (const folder of folders) for (const extension of process.platform === 'win32' ? ['.exe', '.bat'] : ['', '.sh']) {
            const file = join(base, folder, tool + extension)
            if (!gui[tool] && await exists(file)) gui[tool] = file
          }
        }
        return { root: base, tizen, sdb, gui }
      }
    }
    return null
  }
  async function status(input = '') {
    const kit = await sdk(input)
    let lgPackageInfo = null, lgPackageProblem = ''
    try { lgPackageInfo = inspectLgPackage(await readFile(ipk)) }
    catch (error) { if (error.code !== 'ENOENT') lgPackageProblem = 'The LG installer is incomplete or damaged. Choose Build this checkout to replace it.' }
    return { node: process.versions.node, root, addresses: localAddresses(), lgTools: await exists(lg('ares-install')),
      projectTools: await exists(join(root, 'node_modules/vite/package.json')), lgPackage: !!lgPackageInfo, lgPackageInfo, lgPackageProblem, samsungApp: await exists(join(root, 'dist/tv/tizen/config.xml')),
      sdk: kit ? { root: kit.root, gui: Object.keys(kit.gui) } : null, linked: [...linked], installed: [...installed.keys()], installedPackages: Object.fromEntries(installed), signed: [...signed.keys()], signedPackages: Object.fromEntries([...signed].map(([key, { file, ...info }]) => [key, info])) }
  }
  async function execute(action, params, context) {
    if (!ACTIONS.includes(action)) throw new Error('Unknown setup action.')
    const { signal, log, step } = context
    const run = (file, args, extra = {}) => runner(file, args, { cwd: root, signal, onLine: log, ...extra })
    const node = (file, args = [], extra = {}) => run(process.execPath, [file, ...args], extra)
    const requireLg = async () => { if (!await exists(lg('ares-install'))) throw new Error('Install the LG tools in Computer tools first.') }
    const requireKit = async () => { const kit = await sdk(params.sdkRoot); if (!kit) throw new Error('Samsung tools were not found. Install Tizen Studio with Web CLI, Samsung TV Extension, and Certificate Extension, then check its folder.'); return kit }
    const requireProject = async () => { if (!await exists(join(root, 'node_modules/vite/package.json'))) throw new Error('Install the project build tools in Computer tools first.') }
    const build = async target => { await requireProject(); step('Building your TV app…'); await node(join(root, 'scripts/build-tv.mjs'), [target], { timeout: 180000 }) }
    if (action === 'install-lg-tools' || action === 'install-project-tools') {
      const candidates = [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')]
      let npm
      for (const file of candidates) if (await exists(file)) { npm = file; break }
      if (!npm) throw new Error('npm was not found next to Node.js. Repair the Node.js installation and reopen setup.')
      step('Downloading the pinned tools. This can take a few minutes…')
      const args = action === 'install-lg-tools' ? ['ci', '--prefix', 'packaging/tv-tools', '--ignore-scripts', '--no-fund', '--no-audit']
        : ['exec', '--yes', '--package=pnpm@10.31.0', '--', 'pnpm', 'install', '--frozen-lockfile', '--ignore-scripts']
      await node(npm, args, { timeout: 600000 }); return { message: 'Tools installed. You can continue.' }
    }
    if (action === 'build-lg') { await requireLg(); await build('webos'); step('Packaging the LG installer…'); await node(join(root, 'scripts/package-tv.mjs'), ['webos']); return { message: 'LG installer is ready.', package: inspectLgPackage(await readFile(ipk), await readFile(join(root, 'dist/tv/webos/build.json'))) } }
    if (action === 'build-samsung') { await build('tizen'); return { message: 'Samsung app built. Continue to the certificate step to sign it.' } }
    if (action.startsWith('open-')) {
      const kit = await requireKit(), tool = action.slice(5), file = kit.gui[tool]
      if (!file) throw new Error('This tool’s launcher was not found. Open it from Tizen Studio’s Tools menu or Package Manager shortcut.')
      await opener(file)
      return { message: 'Requested the Samsung tool window. Complete its steps there, then return here. If it does not appear, use Tizen Studio’s Tools menu.' }
    }
    if (action === 'profiles-samsung') { const kit = await requireKit(); step('Reading certificate profile names…'); const output = await run(kit.tizen, ['security-profiles', 'list']); return { message: 'Profile list loaded. Use the exact name shown in Certificate Manager.', profiles: output } }
    if (action === 'sign-samsung') {
      const kit = await requireKit(), profile = certificateProfile(params.profile)
      if (params.certificateConfirmed !== true) throw new Error('Complete the Samsung certificate and TV installation-permission checklist first.')
      signed.delete(`${kit.root}|${profile}`)
      await build('tizen')
      const stage = join(root, 'artifacts/tv-setup', randomUUID()); await mkdir(stage, { recursive: true })
      // Keep the complete self-contained build: engines, workers, startup guard,
      // translations and their licenses must accompany the main script.
      for (const file of await readdir(join(root, 'dist/tv/tizen'))) await copyFile(join(root, 'dist/tv/tizen', file), join(stage, file))
      step('Preparing the app with Samsung’s tools…'); await run(kit.tizen, ['build-web', '--', stage], { timeout: 180000 })
      step('Signing with your chosen certificate profile…'); const result = join(stage, '.buildResult')
      await run(kit.tizen, ['package', '-t', 'wgt', '-s', profile, '--', result], { timeout: 180000 })
      const files = (await readdir(result)).filter(file => file.endsWith('.wgt'))
      if (files.length !== 1) throw new Error('Expected one newly signed widget. Check the Samsung tool output.')
      const file = join(result, files[0]), info = inspectSignedWidget(await readFile(file), await readFile(join(stage, 'build.json')))
      signed.set(`${kit.root}|${profile}`, { file, ...info })
      return { message: 'Signed package is ready. The TV will validate its certificate during installation.', package: info }
    }
    const ip = privateIPv4(params.ip), isLg = action.endsWith('-lg'), key = `${isLg ? 'lg' : 'samsung'}:${ip}`, name = lgDeviceName(ip)
    const registeredLg = async () => {
      // LG's current table includes a passphrase column. Inspect privately only.
      const output = await node(lg('ares-setup-device'), ['--list'], { suppressOutput: true })
      const entry = output.split(/\r?\n/).find(line => line.trim().split(/\s+/)[0] === name)
      if (entry && !entry.split(/\s+/).includes(`prisoner@${ip}:9922`)) throw new Error('That Lanternfin device entry points somewhere else. Check it in LG’s device manager before pairing.')
      return !!entry
    }
    if (action === 'pair-lg') {
      await requireLg()
      if (params.devModeConfirmed !== true) throw new Error('Complete the Developer Mode checklist first.')
      if (typeof params.passphrase !== 'string' || !/^[!-~]{6}$/.test(params.passphrase)) throw new Error('Enter the six-character passphrase shown in LG’s Developer Mode app.')
      linked.delete(key); installed.delete(key)
      step('Registering this TV with LG’s tools…')
      // Adding a device also prints LG's table, including other saved passphrases.
      if (!await registeredLg()) await node(lg('ares-setup-device'), ['--add', name, '--info', JSON.stringify({ host: ip, port: 9922, username: 'prisoner', profile: 'tv', description: 'Lanternfin TV setup' })], { suppressOutput: true })
      step('Requesting the TV key. Keep Key Server switched on…')
      await node(lg('ares-novacom'), ['--device', name, '--getkey'], { secret: params.passphrase, suppressOutput: true })
      params.passphrase = ''
      step('Checking the paired TV…'); await node(lg('ares-device'), ['--device', name, '--system-info'])
      linked.add(key); return { message: 'LG TV paired and connection verified.' }
    }
    if (action === 'check-lg') { await requireLg(); linked.delete(key); step('Checking your existing LG pairing…'); if (!await registeredLg()) throw new Error('This TV has not been paired here yet. Enter its code and choose Pair my LG TV.'); await node(lg('ares-device'), ['--device', name, '--system-info']); linked.add(key); return { message: 'LG connection verified.' } }
    if (action === 'connect-samsung') {
      const kit = await requireKit()
      if (params.devModeConfirmed !== true) throw new Error('Complete the Developer Mode checklist first.')
      linked.delete(key); installed.delete(key); step('Connecting to the Samsung TV…')
      await run(kit.sdb, ['connect', `${ip}:26101`])
      const output = await run(kit.sdb, ['devices'])
      if (!connectedSamsung(output, ip)) throw new Error('Samsung has not accepted the connection. Recheck Developer Mode, the computer IP entered on the TV, and its restart.')
      linked.add(key); return { message: 'Samsung TV connection verified.' }
    }
    if (!linked.has(key)) throw new Error('Check the TV connection in Connect your TV before continuing.')
    if (isLg) {
      await requireLg()
      if (!await registeredLg()) throw new Error('This TV’s saved pairing was removed. Pair it again before continuing.')
      if (action === 'install-lg') {
        step('Checking the LG app package…'); const info = inspectLgPackage(await readFile(ipk))
        step('Installing Lanternfin on your LG TV…'); await node(lg('ares-install'), ['--device', name, ipk], { timeout: 180000 })
        installed.set(key, info); return { message: `Lanternfin installed on your LG TV. Revision ${info.build.commit.slice(0, 8)}${info.build.modified ? ' with local changes' : ''}. Close and reopen the TV app to use this build.`, package: info }
      }
      if (!installed.has(key)) throw new Error('Install the app in this setup session before launching it.')
      step('Opening Lanternfin on your LG TV…'); await node(lg('ares-launch'), ['--device', name, LG_ID]); return { message: 'Launch command accepted. Check the TV for the Lanternfin welcome screen.' }
    }
    const kit = await requireKit()
    if (action === 'install-samsung') {
      const profile = certificateProfile(params.profile), artifact = signed.get(`${kit.root}|${profile}`)
      if (!artifact) throw new Error('Sign a fresh Samsung package in the certificate step first.')
      const info = inspectSignedWidget(await readFile(artifact.file))
      if (info.sha256 !== artifact.sha256) throw new Error('The signed package changed. Sign a fresh package before installing.')
      step('Installing the signed app on your Samsung TV…')
      await run(kit.tizen, ['install', '-s', `${ip}:26101`, '-n', artifact.file.slice(dirname(artifact.file).length + 1), '--', dirname(artifact.file)], { timeout: 180000 })
      installed.set(key, info); return { message: `Lanternfin installed on your Samsung TV. Revision ${info.build.commit.slice(0, 8)}${info.build.modified ? ' with local changes' : ''}. Close and reopen the TV app to use this build.`, package: info }
    }
    if (!installed.has(key)) throw new Error('Install the app in this setup session before launching it.')
    step('Opening Lanternfin on your Samsung TV…'); await run(kit.tizen, ['run', '-s', `${ip}:26101`, '-p', SAMSUNG_ID]); return { message: 'Launch command accepted. Check the TV for the Lanternfin welcome screen.' }
  }
  return { status, execute }
}
