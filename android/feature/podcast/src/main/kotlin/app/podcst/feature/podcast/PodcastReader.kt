package app.podcst.feature.podcast

import app.podcst.data.SessionState
import app.podcst.model.Podcast
import app.podcst.network.ApiException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

/** Owns the detail page's foreground read and bounded automatic rechecks. */
internal class PodcastReader(
    route: Podcast,
    private val scope: CoroutineScope,
    private val session: StateFlow<SessionState>,
    private val readerActive: () -> (() -> Boolean),
    private val read: suspend (Podcast, Boolean, (Podcast) -> Unit) -> Podcast,
    private val recheck: suspend (Podcast) -> Podcast,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    val source = MutableStateFlow(route)
    val inaccessible = MutableStateFlow(false)
    val load = MutableStateFlow(LoadState.Loading)
    private val visible = MutableStateFlow(false)
    private var loading: Job? = null
    private var generation = 0L

    init {
        scope.launch {
            combine(visible, session) { visible, session -> visible && !session.loading }
                .distinctUntilChanged().collect { ready ->
                    if (ready) fetch(force = false)
                    else stop(if (visible.value) LoadState.Loading else LoadState.Loaded)
                }
        }
    }

    fun refresh() { if ((source.value.freshness?.retryAtMs ?: 0) <= clock()) fetch(force = true) }

    fun retry() { if ((source.value.freshness?.retryAtMs ?: 0) <= clock()) fetch(force = false) }

    fun suspendReads() { visible.value = false; stop(LoadState.Loaded) }

    fun resumeReads() { visible.value = true }

    private fun stop(state: LoadState) {
        generation++
        loading?.cancel()
        load.value = state
    }

    private fun fetch(force: Boolean) {
        if (!visible.value || session.value.loading) return
        loading?.cancel()
        val generation = ++this.generation
        val active = readerActive()
        loading = scope.launch {
            val startedAt = clock()
            load.value = if (force) LoadState.Refreshing else LoadState.Loading
            load.value = try {
                if (!active()) throw CancellationException("Account changed")
                source.value = read(source.value, force) { source.value = it }
                inaccessible.value = false
                load.value = LoadState.Rechecking
                while (active()) {
                    val wait = source.value.freshness?.recheckDelay(startedAt, clock()) ?: break
                    delay(wait)
                    if (!active()) throw CancellationException("Account changed")
                    source.value = recheck(source.value)
                }
                LoadState.Loaded
            } catch (cancelled: CancellationException) {
                if (this@PodcastReader.generation == generation) load.value = LoadState.Loaded
                throw cancelled
            } catch (error: Exception) {
                if (error is ApiException && error.status in listOf(401, 403, 404)) inaccessible.value = true
                LoadState.Failed
            }
        }
    }
}
