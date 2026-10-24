export function tx3gSample(text: string, extraBytes: number[] = []): Uint8Array {
  const encoded = new TextEncoder().encode(text)
  const bytes = new Uint8Array(2 + encoded.length + extraBytes.length)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, encoded.length)
  bytes.set(encoded, 2)
  bytes.set(extraBytes, 2 + encoded.length)
  return bytes
}

// ---- synthetic MP4 fixtures ----

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Uint8Array(total)
  let cursor = 0
  for (const chunk of chunks) {
    merged.set(chunk, cursor)
    cursor += chunk.length
  }
  return merged
}

export function uint8(value: number): Uint8Array {
  return new Uint8Array([value & 0xff])
}

export function uint16(value: number): Uint8Array {
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, value)
  return bytes
}

export function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value)
  return bytes
}

export function uint64(value: number): Uint8Array {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value))
  return bytes
}

export function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function zeros(count: number): Uint8Array {
  return new Uint8Array(count)
}

export function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concatBytes(payload)
  return concatBytes([uint32(body.length + 8), ascii(type), body])
}

export function fullBox(type: string, version: number, flags: number, ...payload: Uint8Array[]): Uint8Array {
  return box(type, uint8(version), uint8(flags >> 16), uint8(flags >> 8), uint8(flags), ...payload)
}

export const IDENTITY_MATRIX = concatBytes([
  uint32(0x00010000),
  uint32(0),
  uint32(0),
  uint32(0),
  uint32(0x00010000),
  uint32(0),
  uint32(0),
  uint32(0),
  uint32(0x40000000),
])

/** ISO-639-2 code packed as three 5-bit values, as mdhd stores it. */
export function packLanguage(code: string): number {
  const padded = `${code}und`.slice(0, 3)
  return (
    (((padded.charCodeAt(0) - 0x60) & 31) << 10) |
    (((padded.charCodeAt(1) - 0x60) & 31) << 5) |
    ((padded.charCodeAt(2) - 0x60) & 31)
  )
}

export interface TrackFixture {
  trackId: number
  mediaType: "text" | "audio"
  language: string
  codecFourcc?: string
  handlerName?: string
  timescale?: number
  sampleDurationTicks?: number
  /** Samples are contiguous inside a cluster; clusters are separated by clusterGapBytes. */
  sampleClusters: Uint8Array[][]
  clusterGapBytes?: number
}

export const DEFAULT_TIMESCALE = 1000
export const DEFAULT_SAMPLE_DURATION_TICKS = 1000
export const DEFAULT_CLUSTER_GAP_BYTES = 300_000

export function tx3gCluster(texts: string[]): Uint8Array[] {
  return texts.map((text) => tx3gSample(text))
}

export function wvttSample(...texts: string[]): Uint8Array {
  return texts.length ? concatBytes(texts.map(text => box('vttc', box('payl', ascii(text))))) : box('vtte')
}

export function wvttSampleEntry(): Uint8Array {
  return box('wvtt', zeros(6), uint16(1), box('vttC', ascii('WEBVTT\n')))
}

/** 6 reserved bytes + data_reference_index, then displayFlags, justifications, colour, box and style records. */
export function tx3gSampleEntry(fourcc: string): Uint8Array {
  return box(
    fourcc,
    zeros(6),
    uint16(1),
    uint32(0),
    uint8(1),
    uint8(0xff),
    zeros(4),
    zeros(8),
    zeros(12),
  )
}

/** 6 reserved bytes + data_reference_index, then version, channel count, sample size and 16.16 sample rate. */
export function audioSampleEntry(fourcc: string): Uint8Array {
  return box(
    fourcc,
    zeros(6),
    uint16(1),
    uint16(0),
    uint16(0),
    uint32(0),
    uint16(2),
    uint16(16),
    uint16(0),
    uint16(0),
    uint32(48000 * 65536),
  )
}

export function sampleTableBox(track: TrackFixture, sampleOffsets: number[]): Uint8Array {
  const samples = track.sampleClusters.flat()
  const sampleEntry =
    track.mediaType === "text"
      ? track.codecFourcc === 'wvtt' ? wvttSampleEntry() : tx3gSampleEntry(track.codecFourcc ?? "tx3g")
      : audioSampleEntry(track.codecFourcc ?? "mp4a")
  return box(
    "stbl",
    fullBox("stsd", 0, 0, uint32(1), sampleEntry),
    fullBox("stts", 0, 0, uint32(1), uint32(samples.length), uint32(track.sampleDurationTicks ?? DEFAULT_SAMPLE_DURATION_TICKS)),
    fullBox("stsc", 0, 0, uint32(1), uint32(1), uint32(1), uint32(1)),
    fullBox("stsz", 0, 0, uint32(0), uint32(samples.length), ...samples.map((sample) => uint32(sample.length))),
    fullBox("stco", 0, 0, uint32(sampleOffsets.length), ...sampleOffsets.map((offset) => uint32(offset))),
  )
}

export function trackBox(track: TrackFixture, sampleOffsets: number[]): Uint8Array {
  const samples = track.sampleClusters.flat()
  const timescale = track.timescale ?? DEFAULT_TIMESCALE
  const mediaDuration = samples.length * (track.sampleDurationTicks ?? DEFAULT_SAMPLE_DURATION_TICKS)
  const mediaHeader = track.mediaType === "text" ? fullBox("nmhd", 0, 0) : fullBox("smhd", 0, 0, uint16(0), uint16(0))
  return box(
    "trak",
    fullBox(
      "tkhd",
      0,
      3,
      uint32(0),
      uint32(0),
      uint32(track.trackId),
      uint32(0),
      uint32(mediaDuration),
      zeros(8),
      uint16(0),
      uint16(0),
      uint16(0),
      uint16(0),
      IDENTITY_MATRIX,
      uint32(0),
      uint32(0),
    ),
    box(
      "mdia",
      fullBox("mdhd", 0, 0, uint32(0), uint32(0), uint32(timescale), uint32(mediaDuration), uint16(packLanguage(track.language)), uint16(0)),
      fullBox("hdlr", 0, 0, uint32(0), ascii(track.mediaType === "text" ? "text" : "soun"), zeros(12), ascii(`${track.handlerName ?? ""}\0`)),
      box("minf", mediaHeader, sampleTableBox(track, sampleOffsets)),
    ),
  )
}

export function movieBox(tracks: TrackFixture[], sampleOffsetsPerTrack: number[][]): Uint8Array {
  const longestDuration = Math.max(
    ...tracks.map((track) => track.sampleClusters.flat().length * (track.sampleDurationTicks ?? DEFAULT_SAMPLE_DURATION_TICKS)),
  )
  const maxTrackId = Math.max(...tracks.map((track) => track.trackId))
  return box(
    "moov",
    fullBox(
      "mvhd",
      0,
      0,
      uint32(0),
      uint32(0),
      uint32(DEFAULT_TIMESCALE),
      uint32(longestDuration),
      uint32(0x00010000),
      uint16(0x0100),
      uint16(0),
      zeros(8),
      IDENTITY_MATRIX,
      zeros(24),
      uint32(maxTrackId + 1),
    ),
    ...tracks.map((track, index) => trackBox(track, sampleOffsetsPerTrack[index])),
  )
}

export interface Mp4Fixture {
  tracks: TrackFixture[]
  moovPosition?: "before-mdat" | "after-mdat"
  /** Filler ahead of the first sample, used to push a trailing moov past the head-probe window. */
  mdatLeadingPadding?: number
  use64BitMdatHeader?: boolean
  boxesBeforeMoov?: Uint8Array[]
  boxesAfterMoov?: Uint8Array[]
}

export interface BuiltMp4 {
  bytes: Uint8Array
  moovOffset: number
  moovSize: number
  mdatOffset: number
  mdatSize: number
  sampleOffsetsPerTrack: number[][]
}

export function layoutMdatContent(fixture: Mp4Fixture, mdatDataStart: number): { content: Uint8Array; sampleOffsetsPerTrack: number[][] } {
  const pieces: Uint8Array[] = []
  const sampleOffsetsPerTrack: number[][] = []
  let cursor = 0
  if (fixture.mdatLeadingPadding) {
    pieces.push(zeros(fixture.mdatLeadingPadding))
    cursor += fixture.mdatLeadingPadding
  }
  for (const track of fixture.tracks) {
    const trackSampleOffsets: number[] = []
    track.sampleClusters.forEach((cluster, clusterIndex) => {
      if (clusterIndex > 0) {
        const gap = track.clusterGapBytes ?? DEFAULT_CLUSTER_GAP_BYTES
        pieces.push(zeros(gap))
        cursor += gap
      }
      for (const sample of cluster) {
        trackSampleOffsets.push(mdatDataStart + cursor)
        pieces.push(sample)
        cursor += sample.length
      }
    })
    sampleOffsetsPerTrack.push(trackSampleOffsets)
  }
  return { content: concatBytes(pieces), sampleOffsetsPerTrack }
}

export function buildMp4(fixture: Mp4Fixture): BuiltMp4 {
  const ftyp = box("ftyp", ascii("isom"), uint32(0x200), ascii("isom"), ascii("mp41"))
  const placeholderOffsets = fixture.tracks.map((track) => track.sampleClusters.flat().map(() => 0))
  const moovProbe = movieBox(fixture.tracks, placeholderOffsets)
  const boxesBefore = fixture.boxesBeforeMoov ?? []
  const boxesAfter = fixture.boxesAfterMoov ?? []
  const mdatHeaderSize = fixture.use64BitMdatHeader ? 16 : 8
  const moovAfterMdat = fixture.moovPosition === "after-mdat"
  const mdatOffset = moovAfterMdat ? ftyp.length : ftyp.length + moovProbe.length
  const { content, sampleOffsetsPerTrack } = layoutMdatContent(fixture, mdatOffset + mdatHeaderSize)
  const mdat = fixture.use64BitMdatHeader
    ? concatBytes([uint32(1), ascii("mdat"), uint64(content.length + 16), content])
    : box("mdat", content)
  const moov = movieBox(fixture.tracks, sampleOffsetsPerTrack)
  if (moov.length !== moovProbe.length) throw new Error("fixture moov size changed between passes")
  const moovOffset = moovAfterMdat
    ? mdatOffset + mdat.length + boxesBefore.reduce((sum, extraBox) => sum + extraBox.length, 0)
    : ftyp.length
  const ordered = moovAfterMdat ? [ftyp, mdat, ...boxesBefore, moov, ...boxesAfter] : [ftyp, moov, mdat, ...boxesAfter]
  return {
    bytes: concatBytes(ordered),
    moovOffset,
    moovSize: moov.length,
    mdatOffset,
    mdatSize: mdat.length,
    sampleOffsetsPerTrack,
  }
}
