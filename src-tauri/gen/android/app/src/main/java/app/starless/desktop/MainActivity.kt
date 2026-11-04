package app.starless.desktop

import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.webkit.WebView
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

  /** Media keys go to the session's handler, not to the WebView. See `NowPlayingCenter.mediaButton`. */
  override fun dispatchKeyEvent(event: KeyEvent): Boolean =
    NowPlayingCenter.mediaButton(event) || super.dispatchKeyEvent(event)

  override fun onWebViewCreate(webView: WebView) {
    NowPlayingCenter.attach(this, webView)
  }

  override fun onDestroy() {
    NowPlayingCenter.detach()
    stopService(Intent(this, KeepAliveService::class.java))
    super.onDestroy()
  }
}
