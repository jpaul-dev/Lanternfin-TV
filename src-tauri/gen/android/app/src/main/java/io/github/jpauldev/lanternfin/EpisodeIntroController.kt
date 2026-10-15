package io.github.jpauldev.lanternfin

import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.KeyEvent
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/** Read-only lookup: only a public show ID, episode numbers and runtime leave the TV. */
@UnstableApi
class EpisodeIntroController(
  private val activity: AppCompatActivity,
  episodeJson: String,
  private val button: TextView,
  private val player: () -> Player?,
  private val controlsVisible: () -> Boolean,
  private val restoreControls: () -> Unit,
) {
  private val prefs = activity.getSharedPreferences("lanternfin_intros", 0)
  private val handler = Handler(Looper.getMainLooper())
  private val executor = Executors.newSingleThreadExecutor()
  private val info = try { JSONObject(episodeJson) } catch (_: Exception) { JSONObject() }
  private val key = info.optString("key").take(512)
  private val localKey = "episode_" + digest(key)
  private val imdb = info.optString("imdbId")
  private val tmdb = info.optLong("tmdbId", 0).coerceAtLeast(0)
  private val season = info.optInt("season", -1)
  private val episode = info.optInt("episode", -1)
  private var remote: IntroTiming? = null
  private var local: IntroTiming? = readLocal()
  private var disabledEpisode = prefs.getBoolean("disabled_$localKey", false)
  private var mode = prefs.getInt("mode", 1) // 0 off, 1 button, 2 automatic
  private var autoApplied = false
  private var dismissed = false
  private var editing = false
  private var running = false
  private var disposed = false
  private var activeDialog: AlertDialog? = null
  private var loaded = false
  @Volatile private var connection: HttpURLConnection? = null
  val available = key.isNotBlank() && season in 0..1000 && episode in 1..10000

  private val tick = object : Runnable {
    override fun run() {
      if (!running || disposed) return
      update()
      handler.postDelayed(this, 400)
    }
  }

  init {
    button.visibility = View.GONE
    button.setOnClickListener { skip() }
  }

  fun resume() { if (!disposed) { running = true; handler.removeCallbacks(tick); handler.post(tick) } }
  fun pause() { running = false; handler.removeCallbacks(tick); button.visibility = View.GONE }
  fun dispose() { disposed = true; pause(); activeDialog?.dismiss(); connection?.disconnect(); executor.shutdownNow() }

  private fun timing(): IntroTiming? = local ?: remote

  private fun update() {
    val p = player()
    if (available && mode != 0 && !disabledEpisode && local == null) loadRemote()
    val timing = timing()
    val active = available && !disabledEpisode && mode != 0 && !editing && p != null && timing != null &&
      !p.isCurrentMediaItemLive && timing.active(p.currentPosition, p.duration, p.isCurrentMediaItemSeekable)
    if (!active) dismissed = false
    // A previously auto-skipped intro is not skipped again if the viewer deliberately rewinds.
    if (active && mode == 2 && !autoApplied && p!!.isPlaying) { autoApplied = true; skip(); return }
    button.visibility = if (active && !dismissed && !controlsVisible() && !activity.isInPictureInPictureMode && mode == 1) View.VISIBLE else View.GONE
  }

  fun handleKey(code: Int, repeat: Int): Boolean {
    if (button.visibility != View.VISIBLE) return false
    if (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER) {
      if (repeat == 0) skip()
      return true
    }
    if (code == KeyEvent.KEYCODE_BACK) { dismissed = true; button.visibility = View.GONE; return true }
    return false
  }

  private fun skip() {
    val p = player() ?: return
    val t = timing() ?: return
    if (!disabledEpisode && mode != 0 && !p.isCurrentMediaItemLive && t.active(p.currentPosition, p.duration, p.isCurrentMediaItemSeekable)) {
      p.seekTo(t.endMs)
      button.visibility = View.GONE
    }
  }

  private fun readLocal(): IntroTiming? = try {
    val json = JSONObject(prefs.getString(localKey, "") ?: "")
    IntroTiming(json.getLong("start"), json.getLong("end"), json.getLong("duration")).takeIf { it.valid() }
  } catch (_: Exception) { null }

  private fun loadRemote() {
    if (loaded || disposed || (tmdb == 0L && !imdb.matches(Regex("tt[0-9]{7,12}"))) || !available) return
    val duration = player()?.duration ?: return
    if (duration <= 0) return
    loaded = true
    val identity = if (tmdb > 0) "tmdb_id=$tmdb" else "imdb_id=$imdb"
    val cacheKey = "cache_${identity}_${season}_${episode}_$duration"
    val now = System.currentTimeMillis()
    val expires = prefs.getLong("until_$cacheKey", 0)
    if (expires > now) {
      remote = IntroTiming.fromRemote(prefs.getString(cacheKey, "") ?: "", tmdb, season, episode, duration)
      return
    }
    executor.execute {
      var body = ""
      var ttl = 300_000L
      try {
        val conn = URL("https://api.theintrodb.org/v3/media?$identity&season=$season&episode=$episode&duration_ms=$duration").openConnection() as HttpURLConnection
        connection = conn
        conn.connectTimeout = 4000
        conn.readTimeout = 4000
        conn.instanceFollowRedirects = false
        conn.setRequestProperty("Accept", "application/json")
        conn.setRequestProperty("User-Agent", "Lanternfin-TV/0.1")
        if (conn.responseCode == 200) {
          val deadline = System.nanoTime() + 8_000_000_000L
          conn.inputStream.use { input ->
            val bytes = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(4096)
            while (!Thread.currentThread().isInterrupted) {
              if (System.nanoTime() > deadline) throw java.io.IOException("Lookup timed out")
              val read = input.read(buffer)
              if (read < 0) break
              if (bytes.size() + read > 65536) throw IllegalArgumentException("Response too large")
              bytes.write(buffer, 0, read)
            }
            body = bytes.toString("UTF-8")
          }
          ttl = if (IntroTiming.fromRemote(body, tmdb, season, episode, duration) == null) 3_600_000 else 86_400_000
        } else if (conn.responseCode == 404) ttl = 3_600_000
      } catch (_: Exception) {
        // Intro lookup must never interrupt playback or expose provider URLs in logs.
      } finally { connection?.disconnect(); connection = null }
      val result = IntroTiming.fromRemote(body, tmdb, season, episode, duration)
      handler.post {
        if (!disposed) {
          // Bounded cache: only timestamps requested while watching, never a catalog crawl.
          val edit = prefs.edit()
          val oldest = prefs.all.entries.filter { it.key.startsWith("until_cache_") }
            .sortedBy { (it.value as? Long) ?: 0 }
          oldest.take((oldest.size - 99).coerceAtLeast(0)).forEach { edit.remove(it.key).remove(it.key.removePrefix("until_")) }
          edit.putString(cacheKey, body).putLong("until_$cacheKey", System.currentTimeMillis() + ttl).apply()
          remote = result
        }
      }
    }
  }

  fun showSettings() {
    if (!available) return
    editing = true
    button.visibility = View.GONE
    val labels = arrayOf(
      activity.getString(R.string.intro_behavior),
      activity.getString(R.string.intro_edit),
      activity.getString(R.string.intro_database),
      activity.getString(if (disabledEpisode) R.string.intro_enable_episode else R.string.intro_disable_episode),
    )
    activeDialog = AlertDialog.Builder(activity).setTitle(R.string.intro_settings)
      .setItems(labels) { _, which ->
        when (which) {
          0 -> handler.post { if (!disposed) showBehavior() }
          1 -> handler.post { if (!disposed) showEditor() }
          2 -> {
            prefs.edit().remove(localKey).apply(); local = null; autoApplied = false
            if (mode != 0 && !disabledEpisode) loadRemote()
          }
          3 -> {
            disabledEpisode = !disabledEpisode
            prefs.edit().putBoolean("disabled_$localKey", disabledEpisode).apply()
            if (!disabledEpisode && mode != 0) loadRemote()
          }
        }
      }.setOnDismissListener { editing = false; if (!disposed) restoreControls() }.show()
  }

  private fun showBehavior() {
    editing = true
    activeDialog = AlertDialog.Builder(activity).setTitle(R.string.intro_behavior)
      .setSingleChoiceItems(arrayOf(activity.getString(R.string.intro_off), activity.getString(R.string.intro_button), activity.getString(R.string.intro_auto)), mode) { dialog, choice ->
        mode = choice; prefs.edit().putInt("mode", choice).apply()
        autoApplied = false
        if (choice != 0 && !disabledEpisode) loadRemote()
        dialog.dismiss()
      }.setOnDismissListener { editing = false; if (!disposed) restoreControls() }.show()
  }

  private fun showEditor() {
    val p = player() ?: return
    if (!p.isCurrentMediaItemSeekable || p.duration <= 0) {
      Toast.makeText(activity, R.string.intro_unseekable, Toast.LENGTH_LONG).show(); return
    }
    editing = true
    val wasPlaying = p.playWhenReady
    p.pause()
    val t = timing()
    val layout = LinearLayout(activity).apply {
      orientation = LinearLayout.VERTICAL
      val padding = (24 * resources.displayMetrics.density).toInt()
      setPadding(padding, padding / 2, padding, 0)
    }
    val help = TextView(activity).apply { setText(R.string.intro_edit_help) }
    val start = EditText(activity).apply {
      setSingleLine(); inputType = InputType.TYPE_CLASS_TEXT
      setText(IntroTiming.clock(t?.startMs ?: p.currentPosition.coerceAtLeast(0)))
      hint = activity.getString(R.string.intro_start)
      contentDescription = hint
    }
    val end = EditText(activity).apply {
      setSingleLine(); inputType = InputType.TYPE_CLASS_TEXT
      setText(IntroTiming.clock(t?.endMs ?: (p.currentPosition.coerceAtLeast(0) + 60000)))
      hint = activity.getString(R.string.intro_end)
      contentDescription = hint
    }
    layout.addView(help)
    layout.addView(TextView(activity).apply { setText(R.string.intro_start) }); layout.addView(start)
    layout.addView(TextView(activity).apply { setText(R.string.intro_end) }); layout.addView(end)
    val dialog = AlertDialog.Builder(activity).setTitle(R.string.intro_edit).setView(layout)
      .setPositiveButton(R.string.intro_save, null).setNegativeButton(android.R.string.cancel, null)
      .setOnDismissListener { editing = false; if (!disposed) { p.playWhenReady = wasPlaying; restoreControls() } }.create()
    activeDialog = dialog
    dialog.setOnShowListener {
      dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
        val startMs = IntroTiming.parseClock(start.text.toString())
        val endMs = IntroTiming.parseClock(end.text.toString())
        val value = if (startMs != null && endMs != null) IntroTiming(startMs, endMs, p.duration) else null
        if (value == null || !value.matches(p.duration)) { end.error = activity.getString(R.string.intro_invalid); return@setOnClickListener }
        local = value; disabledEpisode = false; autoApplied = false
        prefs.edit().putString(localKey, JSONObject().put("start", value.startMs).put("end", value.endMs).put("duration", value.durationMs).toString())
          .putBoolean("disabled_$localKey", false).apply()
        dialog.dismiss()
      }
    }
    dialog.show()
  }

  companion object {
    private fun digest(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
      .joinToString("") { "%02x".format(it) }
  }
}
