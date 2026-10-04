import { parseMkvMetadata, type MkvMetadataInput } from './mkv-text'
const scope = self as unknown as { onmessage: (event: MessageEvent<MkvMetadataInput>) => void; postMessage(value: unknown): void }
scope.onmessage = event => {
  try { scope.postMessage({ metadata: parseMkvMetadata(event.data) }) }
  catch { scope.postMessage({ error: 'This MKV has unsupported, oversized or malformed subtitle tables.' }) }
}
