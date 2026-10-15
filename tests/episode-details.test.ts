import { describe, expect, it } from "vitest"
import { providerEpisodeDetails, fillEpisodeDetails } from "@/scripts/lib/episode-details"

describe("episode detail normalization", () => {
  it("reads provider overview/description variants without confusing the series plot", () => {
    expect(providerEpisodeDetails({ info: { overview: " Episode story ", air_date: "2024-03-01", duration_secs: 1800, rating: "8.3" } }))
      .toMatchObject({ plot: "Episode story", durationText: "30:00", airDate: "2024-03-01", ratingText: "8.3" })
    expect(providerEpisodeDetails({ description: "Flat story" }).plot).toBe("Flat story")
    expect(providerEpisodeDetails({ info: { plot: { unsafe: true } } }).plot).toBe("")
  })
  it("rejects invalid image URLs, dates and ratings", () => {
    expect(providerEpisodeDetails({ info: { movie_image: "javascript:alert(1)", rating: -1, releaseDate: "bad", duration_secs: Infinity } }))
      .toEqual({ plot: "", thumbUrl: null, durationText: "", airDate: "", ratingText: "" })
  })
  it("fills gaps while preserving provider details and original episode numbering", () => {
    const current = providerEpisodeDetails({ info: { plot: "Provider plot", duration: "00:24:00" } })
    expect(fillEpisodeDetails(current, { episodeNumber: 1, name: "Mapped", overview: "TMDB plot", stillUrl: "https://images.test/a.jpg", airDate: "2024-01-02", runtimeMinutes: 30, voteAverage: 7.5, metadataSeason: 1, metadataEpisode: 26 }))
      .toEqual({ plot: "Provider plot", durationText: "00:24:00", thumbUrl: "https://images.test/a.jpg", airDate: "2024-01-02", ratingText: "7.5", metadataSeason: 1, metadataEpisode: 26 })
  })
})
