package app.podcst.feature.library

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import app.podcst.model.FeedFreshness
import kotlinx.coroutines.delay
import kotlinx.coroutines.CancellationException

@Composable
internal fun FeedRecheck(freshness: List<FeedFreshness>, read: suspend () -> Unit) {
    val startedAt = remember { System.currentTimeMillis() }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val current = rememberUpdatedState(read)
    LaunchedEffect(freshness, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            val wait = freshness.mapNotNull { it.recheckDelay(startedAt) }.minOrNull()
            if (wait != null) {
                delay(wait)
                try { current.value() } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) {}
            }
        }
    }
}
