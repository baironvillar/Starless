package app.starless.desktop

import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // From the activity, while it is in front: Android only lets a visible app
    // start a foreground service. See `KeepAliveService`.
    ContextCompat.startForegroundService(this, Intent(this, KeepAliveService::class.java))
  }

  override fun onDestroy() {
    stopService(Intent(this, KeepAliveService::class.java))
    super.onDestroy()
  }
}
