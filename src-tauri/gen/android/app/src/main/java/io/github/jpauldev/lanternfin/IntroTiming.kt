package io.github.jpauldev.lanternfin

import org.json.JSONObject
import kotlin.math.abs

/** Milliseconds throughout. Remote data never becomes a seek without validation. */
data class IntroTiming(val startMs: Long, val endMs: Long, val durationMs: Long = 0) {
  fun valid(): Boolean = startMs in 0..900_000 && endMs > startMs && endMs - startMs <= 600_000
  fun matches(duration: Long): Boolean = valid() && duration > endMs + 1_000 &&
    (durationMs == 0L || abs(duration - durationMs) <= 2_000)
  fun active(position: Long, duration: Long, seekable: Boolean): Boolean =
    seekable && matches(duration) && position >= startMs && position < endMs

  companion object {
    fun fromRemote(body: String, tmdbId: Long, season: Int, episode: Int, duration: Long): IntroTiming? = try {
      val root = JSONObject(body)
      if ((tmdbId > 0 && root.optLong("tmdb_id", -1) != tmdbId) || root.optInt("season", -1) != season ||
        root.optInt("episode", -1) != episode || root.optString("type") != "tv") null
      else root.optJSONArray("intro")?.takeIf { it.length() == 1 }?.optJSONObject(0)?.let { intro ->
        val start = if (intro.has("start_ms") && intro.isNull("start_ms")) 0.0 else intro.optDouble("start_ms", Double.NaN)
        val end = intro.optDouble("end_ms", Double.NaN)
        if (!start.isFinite() || !end.isFinite() || start % 1 != 0.0 || end % 1 != 0.0) null
        else IntroTiming(start.toLong(), end.toLong(), duration).takeIf { it.matches(duration) && it.endMs - it.startMs <= 180_000 }
      }
    } catch (_: Exception) { null }

    fun parseClock(raw: String): Long? {
      val parts = raw.trim().split(":")
      if (parts.size !in 2..3 || parts.any { !it.matches(Regex("[0-9]{1,3}")) }) return null
      val values = parts.map { it.toLong() }
      if (values.last() >= 60 || (values.size == 3 && values[1] >= 60)) return null
      val seconds = values.fold(0L) { total, n -> total * 60 + n }
      return (seconds * 1000).takeIf { it <= 1_500_000 }
    }

    fun clock(ms: Long): String = "%d:%02d".format(java.util.Locale.ROOT, ms / 60000, ms / 1000 % 60)
  }
}
