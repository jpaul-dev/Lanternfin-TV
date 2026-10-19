package io.github.jpauldev.lanternfin

import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.media3.common.util.UnstableApi
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.UUID

/** Authenticated commands arrive from receiver.rs. This bridge owns no WebView. */
@UnstableApi
object NativeCompanion {
  private val main = Handler(Looper.getMainLooper())
  private var library = WeakReference<MainActivity>(null)
  @Volatile private var enabled = false

  @JvmStatic external fun nativeInitialize()
  @JvmStatic external fun nativeReport(report: String)

  fun attach(activity: MainActivity) {
    library = WeakReference(activity)
    nativeInitialize()
  }

  fun setEnabled(value: Boolean) {
    enabled = value
    if (value) main.post { NativePlayerControl.reportCompanion() }
  }

  fun isEnabled(): Boolean = enabled

  fun report(payload: JSONObject) {
    if (enabled) nativeReport(payload.toString())
  }

  fun idle() = report(JSONObject().put("state", "idle").put("positionSeconds", 0)
    .put("companion", true).put("seekable", false))

  @JvmStatic fun rejectsPlay(json: String): Boolean {
    if (!enabled) return false
    return try { !CompanionPlayPolicy.supported(JSONObject(json)) } catch (_: Exception) { true }
  }

  @JvmStatic fun play(json: String): Boolean {
    if (!enabled) return false
    val descriptor = try { JSONObject(json).getJSONObject("descriptor") } catch (_: Exception) { return false }
    main.post {
      if (!enabled) return@post
      // Never discard DRM settings and accidentally attempt an unprotected stream.
      if (!CompanionPlayPolicy.supported(descriptor)) {
        report(JSONObject().put("state", "error").put("positionSeconds", 0).put("companion", true)
          .put("error", "This protected or catch-up source needs the TV library player."))
        return@post
      }
      val activity = NativePlayerControl.currentActivity() ?: library.get()?.takeUnless { it.isDestroyed || it.isFinishing }
      if (activity == null) {
        report(JSONObject().put("state", "error").put("positionSeconds", 0).put("companion", true)
          .put("error", "Open Lanternfin on the TV, then try again."))
        return@post
      }
      val live = descriptor.optBoolean("isLive")
      val title = descriptor.optString("title", "Playing from your phone")
      val headers = descriptor.optJSONObject("headers")
      val intent = Intent(activity, VideoActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        putExtra(VideoActivity.EXTRA_MODE, if (live) VideoActivity.MODE_LIVE else VideoActivity.MODE_VOD)
        putExtra(VideoActivity.EXTRA_CONTENT_KEY, "companion:" + UUID.randomUUID())
        putExtra(VideoActivity.EXTRA_URL, descriptor.optString("src"))
        putExtra(VideoActivity.EXTRA_MIME, CompanionPlayPolicy.adaptiveMime(descriptor.optString("src"), descriptor.optString("mime")))
        putExtra(VideoActivity.EXTRA_TITLE, title)
        putExtra(VideoActivity.EXTRA_POSTER, descriptor.optString("logo"))
        putExtra(VideoActivity.EXTRA_UA, headers?.optString("userAgent") ?: "")
        putExtra(VideoActivity.EXTRA_REFERER, headers?.optString("referer") ?: "")
        putExtra(VideoActivity.EXTRA_START_MS, CompanionPlayPolicy.millis(descriptor.optDouble("resumeSeconds", 0.0)))
        putExtra(VideoActivity.EXTRA_DURATION_MS, CompanionPlayPolicy.millis(descriptor.optDouble("durationSeconds", 0.0)))
        putExtra(VideoActivity.EXTRA_TV_OVERSCAN_PERCENT, TvOverscanState.percent)
      }
      if (live) {
        val channel = JSONObject().put("id", "companion").put("name", title)
          .put("streamUrl", descriptor.optString("src")).put("logo", descriptor.optString("logo"))
          .put("ua", headers?.optString("userAgent") ?: "").put("referer", headers?.optString("referer") ?: "")
        NativePlayerPayload.setChannels(org.json.JSONArray().put(channel).toString())
        intent.putExtra(VideoActivity.EXTRA_INITIAL_CHANNEL_ID, "companion")
      }
      try { activity.startActivity(intent) } catch (_: Exception) {
        report(JSONObject().put("state", "error").put("positionSeconds", 0).put("companion", true)
          .put("error", "The TV could not open this video. Try again on the TV."))
      }
    }
    return true
  }

  @JvmStatic fun control(json: String): Boolean {
    if (!enabled) return false
    val data = try { JSONObject(json) } catch (_: Exception) { return false }
    main.post {
      if (!enabled) return@post
      when (data.optString("action")) {
        "pause" -> NativePlayerControl.setPlayWhenReady(false)
        "resume" -> NativePlayerControl.setPlayWhenReady(true)
        "stop" -> NativePlayerControl.finishPlayback()
        "seek" -> NativePlayerControl.seekToMs(CompanionPlayPolicy.millis(data.optDouble("seconds", 0.0)))
        "volume" -> NativePlayerControl.setVolume(data.optDouble("level", 1.0).toFloat(), data.optBoolean("muted"))
        "track" -> NativePlayerControl.currentActivity()?.selectCompanionTrack(data)
      }
      NativePlayerControl.reportCompanion()
    }
    return true
  }
}
