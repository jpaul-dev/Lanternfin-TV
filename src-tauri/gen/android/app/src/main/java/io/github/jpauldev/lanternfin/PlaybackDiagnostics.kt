package io.github.jpauldev.lanternfin

import android.content.Context
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/** Small local flight recorder. Never accepts a URL, title, content key or exception message. */
object PlaybackDiagnostics {
  enum class Event {
    START, RESUME, PAUSE, STOP, DESTROY, CHECKPOINT, PLAYER_STATE, FAILURE,
    END_EARLY, END_UNCONFIRMED, END_COMPLETE, FINISH_REQUEST, REMOTE_STOP,
    SESSION_END, RENDERER_CRASH, RENDERER_RECLAIMED, CONFIGURATION_RESTART
  }
  private const val PREFS = "lanternfin_playback_diagnostics"
  private const val KEY = "events"

  @Synchronized
  fun record(context: Context, event: Event, positionMs: Long = 0, durationMs: Long = 0,
             state: Int = 0, code: String = "", httpStatus: Int = 0, catalogDurationMs: Long = 0) {
    try {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val events = JSONArray(prefs.getString(KEY, "[]"))
      val entry = JSONObject().put("at", System.currentTimeMillis()).put("event", event.name)
        .put("positionMs", positionMs.coerceAtLeast(0)).put("durationMs", durationMs.coerceAtLeast(0))
        .put("state", state).put("httpStatus", httpStatus)
        .put("catalogDurationMs", catalogDurationMs.coerceAtLeast(0))
      // Only Media3 error identifiers / internal constants, never exception.toString().
      if (code.matches(Regex("[A-Z][A-Z0-9_]{0,95}"))) entry.put("code", code)
      events.put(entry)
      while (events.length() > 80) events.remove(0)
      prefs.edit().putString(KEY, events.toString()).apply()
      if (event != Event.CHECKPOINT) Log.i("LanternfinPlayback", entry.toString())
    } catch (_: Exception) { /* Diagnostics must never interrupt playback. */ }
  }

  @Synchronized
  fun read(context: Context): String {
    val events = try { JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]")) }
      catch (_: Exception) { JSONArray() }
    val exits = JSONArray()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      try {
        val manager = context.getSystemService(android.app.ActivityManager::class.java)
        for (exit in manager.getHistoricalProcessExitReasons(context.packageName, 0, 3)) {
          exits.put(JSONObject().put("at", exit.timestamp).put("reason", exit.reason).put("status", exit.status))
        }
      } catch (_: Exception) { /* Older firmware may not expose process history. */ }
    }
    return JSONObject().put("version", BuildConfig.VERSION_NAME).put("versionCode", BuildConfig.VERSION_CODE)
      .put("diagnosticsRevision", 1).put("model", Build.MODEL).put("androidApi", Build.VERSION.SDK_INT)
      .put("events", events).put("processExits", exits).toString()
  }
}
