import type { Channel } from './catalog'

/** Stable merge sort that yields and can be cancelled, including large catalogs. */
export async function sortCatalog(items: Channel[], order: string, signal: AbortSignal): Promise<Channel[]> {
  if (!['name-asc', 'name-desc', 'newest', 'rating'].includes(order)) return items
  let input = items.slice(), output = new Array<Channel>(items.length), started = performance.now(), operations = 0
  const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare
  const compare = order === 'newest'
    ? (a: Channel, b: Channel) => (b.addedAt || 0) - (a.addedAt || 0)
    : order === 'rating' ? (a: Channel, b: Channel) => (b.rating || 0) - (a.rating || 0)
    : (a: Channel, b: Channel) => names(a.name, b.name) * (order === 'name-desc' ? -1 : 1)
  const check = () => { if (signal.aborted) throw new Error('Sorting cancelled.') }
  check()
  for (let width = 1; width < input.length; width *= 2) {
    for (let start = 0; start < input.length; start += width * 2) {
      const middle = Math.min(start + width, input.length), end = Math.min(start + width * 2, input.length)
      let left = start, right = middle
      for (let index = start; index < end; index++) {
        output[index] = left < middle && (right >= end || compare(input[left], input[right]) <= 0) ? input[left++] : input[right++]
        if (++operations % 1024 === 0 && performance.now() - started > 10) { await new Promise<void>(resolve => setTimeout(resolve, 0)); check(); started = performance.now() }
      }
    }
    ;[input, output] = [output, input]; check()
  }
  return input
}
