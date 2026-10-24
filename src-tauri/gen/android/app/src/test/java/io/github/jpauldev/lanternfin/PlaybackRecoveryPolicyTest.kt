package io.github.jpauldev.lanternfin

import org.junit.Assert.*
import org.junit.Test

class PlaybackRecoveryPolicyTest {
  @Test fun retriesTransientFailuresWithABoundedBackoff() {
    val policy = PlaybackRecoveryPolicy()
    val code = "ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT"
    assertEquals(1000L, policy.nextDelayMs(code, 0, false))
    assertEquals(2000L, policy.nextDelayMs(code, 0, false))
    assertEquals(4000L, policy.nextDelayMs(code, 0, false))
    assertNull(policy.nextDelayMs(code, 0, false))
  }

  @Test fun accessAndFormatFailuresDoNotRetryOrConsumeTheBudget() {
    val policy = PlaybackRecoveryPolicy()
    for (status in listOf(401, 403, 404, 416, 429, 456, 458)) {
      assertNull(policy.nextDelayMs("ERROR_CODE_IO_BAD_HTTP_STATUS", status, false))
    }
    for (code in listOf("ERROR_CODE_DECODING_FAILED", "ERROR_CODE_DRM_LICENSE_EXPIRED", "ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED")) {
      assertNull(policy.nextDelayMs(code, 0, false))
    }
    assertEquals(0, policy.attempts)
    assertEquals(1000L, policy.nextDelayMs("ERROR_CODE_IO_BAD_HTTP_STATUS", 503, false))
  }

  @Test fun repeatedInterruptionsRecoverOnlyAfterRealPlaybackProgress() {
    val policy = PlaybackRecoveryPolicy()
    var position = 60_000L
    repeat(5) {
      assertEquals(1000L, policy.nextDelayMs("ERROR_CODE_IO_NETWORK_CONNECTION_FAILED", 0, false))
      policy.observePlaying(position)
      repeat(15) { position += 2000; policy.observePlaying(position) }
    }
    assertEquals(0, policy.attempts)
  }

  @Test fun readyLoopsAndSeeksCannotResetTheRetryBudget() {
    val policy = PlaybackRecoveryPolicy()
    repeat(3) {
      assertNotNull(policy.nextDelayMs("ERROR_CODE_IO_UNSPECIFIED", 0, false))
      repeat(25) { policy.observePlaying(60_000) }
      policy.observePlaying(3_600_000)
    }
    assertNull(policy.nextDelayMs("ERROR_CODE_IO_UNSPECIFIED", 0, false))
    policy.reset()
    assertEquals(1000L, policy.nextDelayMs("ERROR_CODE_IO_UNSPECIFIED", 0, false))
  }

  @Test fun earlyEofIsNotMovieCompletionButNormalEndStillIs() {
    assertTrue(PlaybackRecoveryPolicy.endedEarly(60_000, 7_200_000))
    assertFalse(PlaybackRecoveryPolicy.endedEarly(7_199_000, 7_200_000))
    assertFalse(PlaybackRecoveryPolicy.endedEarly(7_200_000, 7_200_000))
    assertFalse(PlaybackRecoveryPolicy.endedEarly(60_000, -9223372036854775807))
    assertFalse(PlaybackRecoveryPolicy.endedEarly(60_000, 0))
    assertEquals(1000L, PlaybackRecoveryPolicy().nextDelayMs("SOURCE_ENDED_EARLY", 0, false))
  }

  @Test fun behindLiveWindowOnlyRecoversLiveContent() {
    assertTrue(PlaybackRecoveryPolicy.retryable("ERROR_CODE_BEHIND_LIVE_WINDOW", 0, true))
    assertFalse(PlaybackRecoveryPolicy.retryable("ERROR_CODE_BEHIND_LIVE_WINDOW", 0, false))
  }
}
