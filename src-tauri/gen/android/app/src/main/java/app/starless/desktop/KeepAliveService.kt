package app.starless.desktop

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Keeps Starless a foreground process while its window is not on screen.
 *
 * **Android cuts the network of a background app, loopback included.** During
 * the login the browser is in front, so the callback to `127.0.0.1:8989` never
 * got an answer: the app was alive and listening, and `dumpsys netpolicy` said
 * `blocked=APP_BACKGROUND|BATTERY_SAVER`. A foreground service lifts both, and
 * it is the same thing the music needs to keep playing with the screen off.
 * See `docs/android.md`.
 */
class KeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL, getString(R.string.keepalive_channel), NotificationManager.IMPORTANCE_LOW)
    )
    val open = PendingIntent.getActivity(
      this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
    )
    val notification = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(getString(R.string.app_name))
      .setContentText(getString(R.string.keepalive_text))
      .setContentIntent(open)
      .setOngoing(true)
      .build()
    ServiceCompat.startForeground(
      this, NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
    )
    return START_NOT_STICKY
  }

  private companion object {
    const val CHANNEL = "playback"
    const val NOTIFICATION_ID = 1
  }
}
