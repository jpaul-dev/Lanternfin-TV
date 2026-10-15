import { mp4SubtitleProblem, openMp4Subtitles } from './mp4-subtitles'
import { mkvSubtitleProblem, openMkvSubtitles } from './mkv-subtitles'
import type { Media } from './media'
import type { SubtitleTimeline } from './external-subtitles'

export type EmbeddedSubtitleSession = {
  tracks: { id: number; language: string; name?: string }[]
  read(id: number, position: number, signal: AbortSignal): Promise<{ from: number; to: number; timeline: SubtitleTimeline }>
}
export const embeddedFormat = (media?: Media) => /\.mkv(?:[?#]|$)/i.test(media?.url || '') ? 'MKV' : 'MP4'
export const embeddedSubtitleProblem = (media?: Media) => embeddedFormat(media) === 'MKV' ? mkvSubtitleProblem(media) : mp4SubtitleProblem(media)
export const openEmbeddedSubtitles = (media: Media, signal: AbortSignal): Promise<EmbeddedSubtitleSession> => embeddedFormat(media) === 'MKV' ? openMkvSubtitles(media, signal) : openMp4Subtitles(media, signal)
