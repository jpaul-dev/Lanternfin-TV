import { formatPaddedHms } from "@/scripts/lib/format"
import type { TmdbSeasonEpisodeOut } from "@/scripts/lib/tmdb-enrich"

export interface EpisodeDetails {
  plot: string
  thumbUrl: string | null
  durationText: string
  airDate: string
  ratingText: string
  metadataSeason?: number
  metadataEpisode?: number
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 8000) : ""
}

function image(value: unknown): string | null {
  const raw = text(value)
  try { return /^https?:$/.test(new URL(raw).protocol) ? raw : null } catch { return null }
}

function rating(value: unknown): string {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 && n <= 10 ? n.toFixed(1) : ""
}

function date(value: unknown): string {
  const raw = text(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(raw)) ? raw : ""
}

/** Providers disagree on nested/flat metadata and plot/overview/description names. */
export function providerEpisodeDetails(raw: any): EpisodeDetails {
  const info = raw?.info && typeof raw.info === "object" ? raw.info : {}
  const seconds = Number(info.duration_secs ?? raw?.duration_secs)
  return {
    plot: text(info.plot) || text(info.overview) || text(info.description) || text(raw?.plot) || text(raw?.overview) || text(raw?.description),
    thumbUrl: image(info.movie_image) || image(info.cover_big) || image(info.cover) || image(raw?.movie_image),
    durationText: text(info.duration) || (Number.isFinite(seconds) && seconds > 0 ? formatPaddedHms(seconds) : ""),
    airDate: date(info.releaseDate) || date(info.releasedate) || date(info.air_date) || date(raw?.air_date),
    ratingText: rating(info.rating ?? raw?.rating),
  }
}

export function fillEpisodeDetails(current: EpisodeDetails, fallback: TmdbSeasonEpisodeOut): EpisodeDetails {
  return {
    ...current,
    plot: current.plot || fallback.overview,
    thumbUrl: current.thumbUrl || fallback.stillUrl,
    durationText: current.durationText || (fallback.runtimeMinutes ? formatPaddedHms(fallback.runtimeMinutes * 60) : ""),
    airDate: current.airDate || date(fallback.airDate),
    ratingText: current.ratingText || rating(fallback.voteAverage),
    metadataSeason: fallback.metadataSeason,
    metadataEpisode: fallback.metadataEpisode,
  }
}
