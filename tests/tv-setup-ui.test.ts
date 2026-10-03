import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { inspectLgPackage } from '../tv-setup/package.mjs'
import { ipk } from './helpers/tv-package-fixture'

it('shows the package revision and last installed revision, and disables a damaged LG installer', async () => {
  const dom = new JSDOM(readFileSync('tv-setup/public/index.html', 'utf8'), { url: 'http://localhost/#' + 'a'.repeat(64), runScripts: 'outside-only' }), win = dom.window
  try {
    const pkg = inspectLgPackage(ipk()), old = { ...pkg, sha256: 'b'.repeat(64), build: { ...pkg.build, commit: 'b'.repeat(40), modified: true } }
    const status = { root: '/fixture', node: '24', addresses: [], lgTools: true, projectTools: true, lgPackage: true, lgPackageInfo: pkg, lgPackageProblem: '', linked: ['lg:192.168.1.50'], installed: ['lg:192.168.1.50'], installedPackages: { 'lg:192.168.1.50': old }, signed: [] }
    win.sessionStorage.setItem('lanternfin.setup.progress', JSON.stringify({ page: 'install', brand: 'lg', ip: '192.168.1.50' }))
    win.fetch = async () => ({ ok: true, json: async () => status }) as Response
    await win.eval('(async () => {\n' + readFileSync('tv-setup/public/app.js', 'utf8') + '\n})()')
    const text = win.document.querySelector('.package-details')!.textContent!
    expect(text).toContain('Ready to install'); expect(text).toContain('abcde123'); expect(text).toContain('32 app files checked')
    expect(text).toContain('bbbbbbbb · local changes'); expect(text).toContain('different package')
    expect((win.document.querySelector('[data-action="install-lg"]') as HTMLButtonElement).disabled).toBe(false)
    status.lgPackage = false; status.lgPackageInfo = null as never; status.lgPackageProblem = 'The LG installer is incomplete or damaged. Choose Build this checkout to replace it.'
    ;(win.document.querySelector('[data-refresh]') as HTMLButtonElement).click(); await new Promise(resolve => win.setTimeout(resolve, 0))
    expect(win.document.querySelector('.package-details')).toBeNull()
    expect(win.document.querySelector('#content')!.textContent).toContain('incomplete or damaged')
    expect((win.document.querySelector('[data-action="install-lg"]') as HTMLButtonElement).disabled).toBe(true)
    expect((win.document.querySelector('[data-action="build-lg"]') as HTMLButtonElement).disabled).toBe(false)
  } finally { win.close() }
})
