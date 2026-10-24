package io.github.jpauldev.lanternfin

import org.junit.Assert.assertEquals
import org.junit.Test

class PlaybackEndPolicyTest {
  @Test fun truncatedTimelineCannotMakeAMovieLookComplete() {
    // Provider sent one minute and ExoPlayer reports a one-minute duration.
    assertEquals(PlaybackEndPolicy.Result.EARLY, PlaybackEndPolicy.classify(60_000, 60_000, 7_200_000))
    assertEquals(PlaybackEndPolicy.Result.EARLY, PlaybackEndPolicy.classify(60_000, 0, 2_400_000))
  }

  @Test fun unknownRuntimeCannotSilentlyMarkAnEpisodeWatched() {
    assertEquals(PlaybackEndPolicy.Result.UNCONFIRMED, PlaybackEndPolicy.classify(60_000, -9223372036854775807, 0))
    assertEquals(PlaybackEndPolicy.Result.UNCONFIRMED, PlaybackEndPolicy.classify(2_400_000, 0, 2_400_000))
    val recovery = PlaybackRecoveryPolicy()
    assertEquals(1000L, recovery.nextDelayMs("SOURCE_END_UNCONFIRMED", 0, false))
    assertEquals(2000L, recovery.nextDelayMs("SOURCE_END_UNCONFIRMED", 0, false))
    assertEquals(4000L, recovery.nextDelayMs("SOURCE_END_UNCONFIRMED", 0, false))
    assertEquals(null, recovery.nextDelayMs("SOURCE_END_UNCONFIRMED", 0, false))
  }

  @Test fun realEndAndSmallDifferencesBetweenCutsRemainValid() {
    assertEquals(PlaybackEndPolicy.Result.COMPLETE, PlaybackEndPolicy.classify(7_199_000, 7_200_000, 0))
    assertEquals(PlaybackEndPolicy.Result.COMPLETE, PlaybackEndPolicy.classify(2_340_000, 2_340_000, 2_400_000))
    assertEquals(PlaybackEndPolicy.Result.COMPLETE, PlaybackEndPolicy.classify(30_000, 30_000, 0))
  }

  @Test fun mediaTimelineStillCatchesEarlyEndWhenCatalogIsMissingOrShorter() {
    assertEquals(PlaybackEndPolicy.Result.EARLY, PlaybackEndPolicy.classify(60_000, 7_200_000, 0))
    assertEquals(PlaybackEndPolicy.Result.EARLY, PlaybackEndPolicy.classify(60_000, 7_200_000, 60_000))
  }
}
