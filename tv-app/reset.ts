/** Only this portable app's namespace is reset; the shared browser origin may contain other apps. */
export async function resetAppData(storage: Storage, session: Storage, cache: { forget(): Promise<void> }, removeDownloads?: () => Promise<void>) {
  // Enumerate first: removing by index would skip keys, and enumeration can fail.
  const keys: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key?.startsWith('lanternfin.tv.')) keys.push(key)
  }
  session.getItem('lanternfin.restored') // Check session storage access before deleting anything.
  if (removeDownloads) await removeDownloads()
  await cache.forget() // Also invalidates in-flight catalog writes.
  for (const key of keys) storage.removeItem(key)
  session.removeItem('lanternfin.restored')
  if (keys.some(key => storage.getItem(key) !== null) || session.getItem('lanternfin.restored') !== null) throw new Error('App storage did not remove all selected data.')
}
