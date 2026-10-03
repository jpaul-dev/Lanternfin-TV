import { buildInfo } from './diagnostics'
import { UPDATE_LINKS, checkUpdates } from './updates'

export function updatesUI(root: HTMLElement, target: 'webos' | 'tizen' | 'browser', check = checkUpdates) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#updates-${id}`)!
  let request: AbortController | undefined, checkedAt = 0
  const status = (text: string) => { el('status').textContent = text }
  const busy = (value: boolean) => { el<HTMLButtonElement>('check').disabled = value; el('cancel').hidden = !value }
  const close = () => { request?.abort(); request = undefined; busy(false) }
  for (const [name, url] of Object.entries(UPDATE_LINKS)) el<HTMLAnchorElement>(name).href = url
  el('cancel').onclick = () => { close(); status('Update check canceled. Nothing was installed.'); el('check').focus() }
  el('check').onclick = async () => {
    if (request) return
    if (checkedAt && Date.now() - checkedAt < 60000) { status('Please wait a minute before checking again. The previous result is still shown.'); return }
    checkedAt = Date.now(); request = new AbortController(); const controller = request
    busy(true); status('Checking the public Lanternfin TV repository…'); el('cancel').focus()
    el('result').textContent = ''; el('packages').replaceChildren()
    try {
      const result = await check(controller.signal)
      if (request !== controller) return
      const build = buildInfo(target)
      el('result').textContent = result.commit ? result.commit === build.commit ? build.modified ? 'The source commit matches the TV branch, but this app includes local changes.' : 'This app matches the current TV source commit.' : `The TV branch is at ${result.commit.slice(0, 7)}. This app has a different source revision; review changes before rebuilding.` : 'Source status is unknown.'
      const releases = result.releases?.filter(release => target === 'browser' || release.targets.includes(target))
      if (releases) {
        if (!releases.length) el('packages').textContent = 'No compatible TV package was found in the latest 20 published releases. Android installers and unsigned Samsung archives are excluded. You can still build the TV source with the setup companion.'
        for (const release of releases) {
          const row = document.createElement('div'); row.className = 'update-release'
          const link = document.createElement('a'); link.href = release.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `${release.name}${release.prerelease ? ' · Prerelease' : ''}`
          const note = document.createElement('p'); note.className = 'hint'; note.textContent = `${release.targets.map(platform => platform === 'webos' ? 'LG webOS' : 'Samsung Tizen').join(' · ')}. Review the release notes and package provenance. A filename does not verify signing or compatibility.`
          row.append(link, note); el('packages').append(row)
        }
      }
      status(result.errors.length ? result.errors.join(' ') : 'Check complete. No package was downloaded or installed.')
    } catch { if (request === controller) status('The update check could not finish. Check your network and try again.') }
    finally { if (request === controller) { request = undefined; busy(false); el('check').focus() } }
  }
  return {
    close,
    open() {
      close(); const build = buildInfo(target)
      el('build').textContent = `${target === 'webos' ? 'LG webOS' : target === 'tizen' ? 'Samsung Tizen' : 'Browser'} · ${build.version} · ${build.commit.slice(0, 7)}${build.modified ? ' · local changes' : ''}`
      status('Checks run only when you choose Check updates. GitHub receives the ordinary public request; your sources, accounts and viewing history are never included.')
    },
  }
}
