/** @vitest-environment jsdom */
import { expect, it, vi } from "vitest"
const play = vi.hoisted(() => vi.fn(async () => true))
vi.mock("@/scripts/tv/playback", () => ({ playEpisode: play, playVod: vi.fn() }))
vi.mock("@/scripts/lib/tv-cast-next.ts", () => ({ resolveSeriesNextUp: async () => ({ season: 2, episodeNum: 1, episodeId: 81, title: "Episode", resumeSeconds: 30 }) }))
vi.mock("@/scripts/lib/cache.js", () => ({ getCached: () => ({ data: { info: { tmdb: 55 } } }) }))
vi.mock("@/scripts/lib/enrichment", () => ({ peekTitleEnrichmentDetailed: async () => ({ tmdbId: 55, enrichment: { imdbId: "tt0903747" } }) }))
vi.mock("@/scripts/lib/tmdb-enrich", () => ({ peekCachedSeasonEnrichment: async () => ({ episodes: [{ episodeNumber: 1, metadataSeason: 1, metadataEpisode: 26 }] }) }))
vi.mock("@/scripts/lib/tvdb-proxy", () => ({ parseProviderTmdbId: () => 55 }))
vi.mock("@/scripts/tv/ui/series-match", () => ({ seriesMatch: () => 99 }))
import { resumeContinueWatchingRow } from "@/scripts/tv/resume-playback"

it("resumes with the corrected show and cached canonical episode numbering without another metadata request", async () => {
  expect(await resumeContinueWatchingRow("fixture", { kind: "episode", id: 81, seriesId: 7 })).toBe(true)
  expect(play).toHaveBeenCalledWith(expect.objectContaining({ tmdbId: 99, season: 2, episodeNum: 1, metadataSeason: 1, metadataEpisode: 26, resumeSeconds: 30 }), {})
})
