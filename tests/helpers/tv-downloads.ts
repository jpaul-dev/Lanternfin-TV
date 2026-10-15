import { vi } from 'vitest'
import type { DownloadListener, DownloadPlatform } from '../../tv-app/downloads'
export function downloadDevice() {
  const files = new Map<string, number>(), directories = new Set(['wgt-private'])
  const requests = new Map<number, InstanceType<DownloadPlatform['DownloadRequest']>>()
  const listeners = new Map<number, DownloadListener>(), states = new Map<number, string>()
  let next = 0
  const api: DownloadPlatform = {
    systeminfo: { getCapability: vi.fn(() => true) },
    DownloadRequest: class { constructor(public url: string, public destination: string, public fileName: string, public network: 'ALL', public httpHeader: Record<string, string>) {} },
    download: {
      start: vi.fn((request, listener) => { const id = ++next; requests.set(id, request); listeners.set(id, listener); states.set(id, 'DOWNLOADING'); return id }),
      pause: vi.fn(id => { states.set(id, 'PAUSED') }), resume: vi.fn(id => { states.set(id, 'DOWNLOADING') }),
      cancel: vi.fn(id => { states.set(id, 'CANCELED'); queueMicrotask(() => listeners.get(id)?.oncanceled(id)) }),
      getState: vi.fn(id => { if (!states.has(id)) throw new Error('provider secret'); return states.get(id) as ReturnType<DownloadPlatform['download']['getState']> }),
      getDownloadRequest: vi.fn(id => { if (!requests.has(id)) throw new Error('private token'); return requests.get(id)! }),
      setListener: vi.fn((id, listener) => { listeners.set(id, listener) }),
    },
    filesystem: {
      isDirectory: vi.fn(path => directories.has(path)), isFile: vi.fn(path => files.has(path)), pathExists: vi.fn(path => files.has(path) || directories.has(path)),
      toURI: vi.fn(path => path.startsWith('file:') ? path : `file:///opt/apps/private/${path}`),
      createDirectory: vi.fn((path, _, done) => { directories.add(path); done() }),
      deleteFile: vi.fn((path, done) => { files.delete(path); done() }),
      openFile: vi.fn(path => { if (!files.has(path)) throw new Error(); return { seek: () => files.get(path)!, close: vi.fn() } }),
    },
  }
  const complete = (id: number, bytes = 123456) => { const request = requests.get(id)!; files.set(`${request.destination}/${request.fileName}`, bytes); states.set(id, 'COMPLETED'); listeners.get(id)!.oncompleted(id, '/do/not/trust/this/path.mp4') }
  return { api, files, requests, listeners, states, complete }
}
