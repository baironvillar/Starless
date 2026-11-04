package app.starless.desktop

import android.app.Notification
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.view.KeyEvent
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.net.URL
import java.util.concurrent.Executors
import org.json.JSONObject

/**
 * What Android shows of the music outside the app: the lock screen, the media
 * notification, the headset buttons — and the wake lock that lets the next
 * song load with the screen off.
 *
 * **The page decides, Kotlin only shows.** What is playing comes from the
 * page through `MainActivity`'s bridge (`mediaSession` in `src/lib/spotify.ts`,
 * the same answer Windows' media card gets), and a press on the lock screen
 * goes back to the page as a media key: what "next" means —the queue, the DJ,
 * the radio— lives in `App.tsx`, and a second copy of it here would drift.
 *
 * **The wake lock is the bug it fixes.** With the screen off Android suspends
 * the processor whenever nothing holds it awake, and the audio output only
 * holds it while it plays. A song ends, the output goes quiet, and the phone
 * fell asleep between "the song ended" and "the next one arrived": the next
 * song stayed loading until somebody woke the screen. The lock is held while
 * something plays or loads, and kept for a while after — the end of a song
 * reports "not playing" a moment before the page asks for the next one.
 */
object NowPlayingCenter {
  const val CHANNEL = "playback"
  const val NOTIFICATION_ID = 1

  /** How long the processor stays awake after the music stops saying it plays. */
  private const val LINGER_MS = 30_000L
  /** A ceiling in case nothing ever says stop; every change of song renews it. */
  private const val HOLD_MS = 60 * 60 * 1000L

  private data class Now(
    val title: String,
    val artist: String,
    val album: String,
    val artwork: String?,
    val playing: Boolean,
    val loading: Boolean,
    val positionMs: Long,
    val durationMs: Long,
  )

  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()
  private var session: MediaSessionCompat? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var webView: WebView? = null
  private var now: Now? = null
  private var artUrl: String? = null
  private var art: Bitmap? = null
  private val release = Runnable { wakeLock?.takeIf { it.isHeld }?.release() }

  /** What the page calls, as `window.StarlessMedia`. */
  private class Bridge(private val context: Context) {
    /** `NowPlaying` as JSON, or "null". See `mediaSession` in `src/lib/spotify.ts`. */
    @JavascriptInterface
    fun nowPlaying(json: String) = update(context, json)
  }

  fun attach(context: Context, view: WebView) {
    webView = view
    view.addJavascriptInterface(Bridge(context.applicationContext), "StarlessMedia")
    if (session != null) return
    val app = context.applicationContext
    session = MediaSessionCompat(app, "Starless").apply {
      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() = key("play")
        override fun onPause() = key("pause")
        override fun onSkipToNext() = key("next")
        override fun onSkipToPrevious() = key("previous")
      })
    }
    wakeLock = app.getSystemService(PowerManager::class.java)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Starless:playback")
      .apply { setReferenceCounted(false) }
  }

  fun detach() {
    main.removeCallbacks(release)
    release.run()
    session?.run {
      isActive = false
      release()
    }
    session = null
    webView = null
  }

  /**
   * A media key that reached the activity instead of the session.
   *
   * **With the app on screen, Android gives the keys to the focused window**,
   * and the focused window is the WebView, which swallows them: a headset's
   * play/pause did nothing while the app was open, and worked the moment it
   * was not. The activity hands them here first. Both halves of the press
   * are consumed, and only the first `down` acts.
   */
  fun mediaButton(event: KeyEvent): Boolean {
    val name = when (event.keyCode) {
      KeyEvent.KEYCODE_MEDIA_PLAY -> "play"
      KeyEvent.KEYCODE_MEDIA_PAUSE -> "pause"
      KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK ->
        if (now?.playing == true) "pause" else "play"
      KeyEvent.KEYCODE_MEDIA_NEXT -> "next"
      KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "previous"
      else -> return false
    }
    if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) key(name)
    return true
  }

  /** A button outside the app: handed to the page as the media key it is. */
  fun key(name: String) {
    val view = webView ?: return
    main.post {
      view.evaluateJavascript("window.__starlessMediaKey&&window.__starlessMediaKey('$name')", null)
    }
  }

  /** From the bridge, on the WebView's thread: `NowPlaying` as JSON, or "null". */
  fun update(context: Context, json: String) {
    val parsed = parse(json)
    val app = context.applicationContext
    main.post { show(app, parsed) }
  }

  private fun parse(json: String): Now? {
    if (json == "null") return null
    return runCatching {
      val o = JSONObject(json)
      Now(
        title = o.optString("title"),
        artist = o.optString("artist"),
        album = o.optString("album"),
        artwork = if (o.isNull("artwork")) null else o.optString("artwork"),
        playing = o.optBoolean("playing"),
        loading = o.optBoolean("loading"),
        positionMs = o.optLong("positionMs"),
        durationMs = o.optLong("durationMs"),
      )
    }.getOrNull()
  }

  private fun show(context: Context, next: Now?) {
    now = next
    val session = session ?: return
    if (next == null) {
      session.isActive = false
      awake(false)
      post(context)
      return
    }

    session.setPlaybackState(
      PlaybackStateCompat.Builder()
        .setActions(
          PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or
            PlaybackStateCompat.ACTION_PLAY_PAUSE or PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
        )
        .setState(
          when {
            next.playing -> PlaybackStateCompat.STATE_PLAYING
            next.loading -> PlaybackStateCompat.STATE_BUFFERING
            else -> PlaybackStateCompat.STATE_PAUSED
          },
          next.positionMs,
          if (next.playing) 1f else 0f,
          SystemClock.elapsedRealtime(),
        )
        .build()
    )
    session.isActive = true
    awake(next.playing || next.loading)

    if (next.artwork != artUrl) {
      artUrl = next.artwork
      art = null
      next.artwork?.let { url ->
        io.execute {
          val bitmap = runCatching { URL(url).openStream().use(BitmapFactory::decodeStream) }.getOrNull()
          main.post {
            if (artUrl != url) return@post
            art = bitmap
            metadata()
            post(context)
          }
        }
      }
    }
    metadata()
    post(context)
  }

  private fun metadata() {
    val n = now ?: return
    session?.setMetadata(
      MediaMetadataCompat.Builder()
        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, n.title)
        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, n.artist)
        .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, n.album)
        .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, n.durationMs)
        .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art)
        .build()
    )
  }

  private fun awake(on: Boolean) {
    main.removeCallbacks(release)
    if (on) wakeLock?.acquire(HOLD_MS) else main.postDelayed(release, LINGER_MS)
  }

  /** Replaces the keep-alive notification: it is the same one, now with the song. */
  private fun post(context: Context) {
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return
    runCatching { manager.notify(NOTIFICATION_ID, notification(context)) }
  }

  fun notification(context: Context): Notification {
    val open = PendingIntent.getActivity(
      context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
    )
    val builder = NotificationCompat.Builder(context, CHANNEL)
      // The mark without its plate: the status bar draws only the shape.
      .setSmallIcon(R.mipmap.ic_launcher_foreground)
      .setContentIntent(open)
      .setOngoing(true)
      .setSilent(true)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
    val n = now
    val token = session?.sessionToken
    if (n == null || token == null) {
      return builder
        .setContentTitle(context.getString(R.string.app_name))
        .setContentText(context.getString(R.string.keepalive_text))
        .build()
    }
    return builder
      .setContentTitle(n.title)
      .setContentText(n.artist)
      .setLargeIcon(art)
      .addAction(
        android.R.drawable.ic_media_previous,
        context.getString(R.string.media_previous),
        action(context, "previous", 1),
      )
      .addAction(
        if (n.playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
        context.getString(if (n.playing) R.string.media_pause else R.string.media_play),
        action(context, if (n.playing) "pause" else "play", 2),
      )
      .addAction(
        android.R.drawable.ic_media_next,
        context.getString(R.string.media_next),
        action(context, "next", 3),
      )
      .setStyle(
        androidx.media.app.NotificationCompat.MediaStyle()
          .setMediaSession(token)
          .setShowActionsInCompactView(0, 1, 2)
      )
      .build()
  }

  /**
   * The notification's buttons, for the Android versions that still draw them
   * (before 13 the controls are the notification's; from 13 they come from the
   * session, and these go unused).
   */
  private fun action(context: Context, key: String, code: Int): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      code,
      Intent(context, MediaActionReceiver::class.java).putExtra("key", key),
      PendingIntent.FLAG_IMMUTABLE,
    )
}

/** The notification's buttons arrive here and go to the page as media keys. */
class MediaActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    intent.getStringExtra("key")?.let(NowPlayingCenter::key)
  }
}
