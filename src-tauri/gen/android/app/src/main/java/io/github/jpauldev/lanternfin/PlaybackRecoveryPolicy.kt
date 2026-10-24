package io.github.jpauldev.lanternfin

/** Bounded retries for transport failures, never for access refusals or unsupported media. */
class PlaybackRecoveryPolicy {
  var attempts = 0
    private set
  private var lastPositionMs: Long? = null
  private var playedSinceFailureMs = 0L

  fun reset() {
    attempts = 0
    lastPositionMs = null
    playedSinceFailureMs = 0
  }

  fun observePlaying(positionMs: Long) {
    val delta = lastPositionMs?.let { positionMs - it } ?: 0
    // Ignore seeks and intro skips; READY alone is not evidence of a recovered stream.
    if (delta in 1..5_000) playedSinceFailureMs += delta
    lastPositionMs = positionMs
    if (playedSinceFailureMs >= 30_000) attempts = 0
  }

  fun nextDelayMs(code: String, httpStatus: Int, live: Boolean): Long? {
    if (!retryable(code, httpStatus, live) || attempts >= 3) return null
    lastPositionMs = null
    playedSinceFailureMs = 0
    return 1_000L shl attempts++
  }

  companion object {
    fun retryable(code: String, httpStatus: Int, live: Boolean): Boolean {
      if (httpStatus != 0) return httpStatus == 408 || httpStatus in 500..599
      return code in setOf(
        "ERROR_CODE_IO_NETWORK_CONNECTION_FAILED",
        "ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT",
        "ERROR_CODE_IO_UNSPECIFIED",
        "SOURCE_ENDED_EARLY",
        "SOURCE_END_UNCONFIRMED",
      ) || (live && code == "ERROR_CODE_BEHIND_LIVE_WINDOW")
    }

    fun endedEarly(positionMs: Long, durationMs: Long): Boolean {
      if (durationMs <= 0 || positionMs < 0) return false
      val tolerance = (durationMs / 50).coerceIn(10_000, 30_000)
      return positionMs < durationMs - tolerance
    }
  }
}
