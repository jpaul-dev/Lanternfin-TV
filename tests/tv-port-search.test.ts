import { expect, it } from 'vitest'
import { searchCatalog } from '../tv-app/search'

it('searches names case-insensitively within an exact group and preserves provider order', async () => {
  const channels = [
    { name: 'NEWS 1', group: 'English', url: 'https://example.com/1' },
    { name: 'News 2', group: 'French', url: 'https://example.com/2' },
    { name: 'News 3', group: 'English', url: 'https://example.com/3' },
  ]
  expect(await searchCatalog(channels, ' news ', 'English', new AbortController().signal)).toEqual([channels[0], channels[2]])
  expect(await searchCatalog(channels, '', '', new AbortController().signal)).toBe(channels)
})

it('allows UI work and cancellation while scanning a provider-sized catalog', async () => {
  const channels = Array.from({ length: 300000 }, (_, index) => ({ name: `Station ${index} ${'long title '.repeat(8)}`, group: 'Live', url: 'https://example.com/stream' }))
  const controller = new AbortController()
  const heartbeat = setTimeout(() => controller.abort(), 0)
  try { await expect(searchCatalog(channels, 'unmatched', '', controller.signal)).rejects.toThrow('cancelled') }
  finally { clearTimeout(heartbeat) }
}, 10000)
