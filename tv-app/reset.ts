/** Only this portable app's namespace is reset; the shared browser origin may contain other apps. */
export async function resetAppData(storage: Storage, session: Storage, cache: { forget(): Promise<void> }, removeDownloads?: () => Promise<void>) {
  // Enumerate first: removing by index would skip keys, and enumeration can fail.
  const keys: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key?.startsWith('lanternfin.tv.')) keys.push(key)
  }
  const sessionKeys: string[] = []
  for (let index = 0; index < session.length; index++) {
    const key = session.key(index)
    if (key?.startsWith('lanternfin.tv.') || key === 'lanternfin.restored') sessionKeys.push(key)
  }
  if (removeDownloads) await removeDownloads()
  await cache.forget() // Also invalidates in-flight catalog writes.
  for (const key of keys) storage.removeItem(key)
  for (const key of sessionKeys) session.removeItem(key)
  if (keys.some(key => storage.getItem(key) !== null) || sessionKeys.some(key => session.getItem(key) !== null)) throw new Error('App storage did not remove all selected data.')
}
