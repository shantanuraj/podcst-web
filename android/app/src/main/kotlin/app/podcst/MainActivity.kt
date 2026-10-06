package app.podcst

import android.content.ComponentName
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import app.podcst.data.Appearance
import app.podcst.designsystem.PodcstTheme
import app.podcst.playback.PlaybackService
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

class MainActivity : ComponentActivity() {
    private var controller: ListenableFuture<MediaController>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        val graph = (application as PodcstApplication).graph
        setContent {
            val appearance by graph.preferences.appearance.collectAsStateWithLifecycle(Appearance.System)
            val dark = when (appearance) {
                Appearance.System -> isSystemInDarkTheme()
                Appearance.Light -> false
                Appearance.Dark -> true
            }
            androidx.compose.runtime.LaunchedEffect(dark) {
                val style = if (dark) SystemBarStyle.dark(android.graphics.Color.TRANSPARENT) else SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
            }
            PodcstTheme(dark = dark) {
                PodcstApp(graph)
            }
        }
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                graph.session.restore()
                graph.stars.refresh()
                while (isActive) {
                    delay(5_000)
                    graph.stars.poll()
                }
            }
        }
        if (savedInstanceState == null) intent.incoming()?.let(graph.incoming::tryEmit)
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        intent.incoming()?.let((application as PodcstApplication).graph.incoming::tryEmit)
    }

    override fun onStart() {
        super.onStart()
        controller = MediaController.Builder(this, SessionToken(this, ComponentName(this, PlaybackService::class.java))).buildAsync()
    }

    override fun onStop() {
        controller?.let(MediaController::releaseFuture)
        controller = null
        super.onStop()
    }
}
