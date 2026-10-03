import type { Channel } from './catalog'

// Keep keyboard input and the remote responsive while scanning large catalogs.
// A newer query cancels the old scan before it can replace the visible results.
export async function searchCatalog(channels: Channel[], query: string, group: string, signal: AbortSignal): Promise<Channel[]> {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle && !group) return channels
  const found: Channel[] = []
  let started = performance.now()
  for (let index = 0; index < channels.length; index++) {
    if (signal.aborted) throw new Error('Search cancelled.')
    const channel = channels[index]
    if ((!group || channel.group === group) && (!needle || channel.name.toLocaleLowerCase().includes(needle))) found.push(channel)
    if (index % 512 === 0 && performance.now() - started >= 10) {
      await new Promise<void>(resolve => setTimeout(resolve, 0)); started = performance.now()
    }
  }
  if (signal.aborted) throw new Error('Search cancelled.')
  return found
}
