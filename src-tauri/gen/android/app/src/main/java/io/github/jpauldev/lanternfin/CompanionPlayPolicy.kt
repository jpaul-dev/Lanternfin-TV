package io.github.jpauldev.lanternfin

import org.json.JSONObject
import java.net.URI

/** Keep protected sources and offset-based catch-up on their existing playback paths. */
object CompanionPlayPolicy {
  fun supported(descriptor: JSONObject): Boolean = descriptor.isNull("drm") &&
    descriptor.optDouble("timelineOffsetSeconds", 0.0) <= 0.0

  fun millis(seconds: Double): Long =
    if (seconds.isFinite()) (seconds.coerceIn(0.0, 604800.0) * 1000).toLong() else 0L

  fun adaptiveMime(url: String, mime: String): String? {
    val path = try { URI(url).path.orEmpty().lowercase() } catch (_: Exception) { return null }
    // Live descriptors often default to HLS even when their URL is an MPEG-TS stream.
    if (Regex("\\.(ts|mp4|mkv|webm|avi|m4v)$").containsMatchIn(path)) return null
    return when (mime.lowercase()) {
      "application/dash+xml" -> "application/dash+xml"
      "application/x-mpegurl", "application/vnd.apple.mpegurl" -> "application/x-mpegURL"
      else -> null
    }
  }
}
