import { afterEach, expect, it, vi } from 'vitest'
import { loadAccount } from '../tv-app/account'
const source = { kind: 'xtream' as const, url: 'https://example.com', username: 'private-user', password: 'secret' }
afterEach(() => vi.unstubAllGlobals())
it('shows bounded account facts without returning credentials, raw messages or server addresses', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user_info: { auth: 1, status: 'Active', exp_date: '1900000000', active_cons: '1', max_connections: '3', is_trial: '0', username: 'private-user', password: 'secret', message: 'private', allowed_output_formats: ['ts', 'm3u8', '<script>'] }, server_info: { timezone: 'Europe/Rome', url: 'private-host' } }))))
  const result = await loadAccount(source, new AbortController().signal)
  expect(result).toEqual({ accepted: true, status: 'Active', expires: 1900000000000, connections: 1, maximum: 3, trial: false, timezone: 'Europe/Rome', formats: ['ts', 'm3u8'] })
  expect(JSON.stringify(result)).not.toMatch(/private|secret|script/)
})
it('does not invent account status when the provider cannot report it', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
  await expect(loadAccount(source, new AbortController().signal)).rejects.toThrow('does not expose')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"user_info":{"auth":0,"status":"<script>","active_cons":-1}}')))
  expect(await loadAccount(source, new AbortController().signal)).toMatchObject({ accepted: false, status: 'Not reported', connections: undefined })
})
