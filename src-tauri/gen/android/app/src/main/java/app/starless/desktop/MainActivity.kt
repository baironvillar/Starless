package app.starless.desktop

import android.content.Intent
import android.os.Bundle
import android.webkit.JavascriptInterface
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

  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(Bridge(), "StarlessAndroid")
  }

  /**
   * What the page asks of the activity. Only one thing: going behind the other
   * apps when the back button has nothing left to close (`src/lib/back.ts`).
   * Finishing the activity instead would run `onDestroy`, which stops the
   * service that keeps the music alive — "back" on Home would stop the song.
   */
  inner class Bridge {
    @JavascriptInterface
    fun moveToBack() {
      runOnUiThread { moveTaskToBack(true) }
    }
  }

  override fun onDestroy() {
    stopService(Intent(this, KeepAliveService::class.java))
    super.onDestroy()
  }
}
