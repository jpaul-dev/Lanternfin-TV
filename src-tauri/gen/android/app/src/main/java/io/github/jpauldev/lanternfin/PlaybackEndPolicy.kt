package io.github.jpauldev.lanternfin

/** An EOF is not proof that the provider delivered the whole movie. */
object PlaybackEndPolicy {
  enum class Result { EARLY, UNCONFIRMED, COMPLETE }

  fun classify(positionMs: Long, timelineDurationMs: Long, catalogDurationMs: Long): Result {
    if (positionMs < 0) return Result.UNCONFIRMED
    if (PlaybackRecoveryPolicy.endedEarly(positionMs, timelineDurationMs)) return Result.EARLY
    // Catalog runtimes can describe a different cut or omit credits. Only use them
    // to reject a substantial truncation, never to seek or change the media timeline.
    if (catalogDurationMs > 0 && positionMs < catalogDurationMs - maxOf(60_000, catalogDurationMs / 10)) {
      return Result.EARLY
    }
    if (timelineDurationMs <= 0) return Result.UNCONFIRMED
    return Result.COMPLETE
  }
}
