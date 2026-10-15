import { parseMp4Text } from './mp4-text'
const scope = self as unknown as { onmessage: (event: MessageEvent<ArrayBuffer>) => void; postMessage(value: unknown): void }
scope.onmessage = event => {
  try { scope.postMessage({ tracks: parseMp4Text(new Uint8Array(event.data)) }) }
  catch { scope.postMessage({ error: 'This MP4 has unsupported, oversized or malformed subtitle tables.' }) }
}
