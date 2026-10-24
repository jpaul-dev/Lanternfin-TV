import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'

const dataDir = await mkdtemp(resolve(tmpdir(), 'lanternfin-launcher-test-'))
const run = action => promisify(execFile)(process.execPath, ['home-server/cli.mjs', action, '--no-open'], { windowsHide: true, timeout: 30000, env: { ...process.env, LANTERNFIN_HOME_DATA: dataDir, LANTERNFIN_HOME_PORT: '0', LANTERNFIN_HOME_MDNS: '0' } })
try {
  await run('start')
  const first = JSON.parse(await readFile(resolve(dataDir, 'running.json'), 'utf8'))
  await run('start')
  const second = JSON.parse(await readFile(resolve(dataDir, 'running.json'), 'utf8'))
  assert.equal(first.pid, second.pid)
  assert.equal(first.instance, second.instance)
  await run('stop')
  assert.equal(await stat(resolve(dataDir, 'running.json')).catch(() => null), null)
  assert.ok(await stat(resolve(dataDir, 'home.sqlite')))
  await run('stop')
  console.log('PASS: start, repeated start, authenticated stop, repeated stop, saved library retained.')
} finally {
  await run('stop').catch(() => {})
  assert.equal(dirname(dataDir), resolve(tmpdir()))
  await rm(dataDir, { recursive: true })
}
