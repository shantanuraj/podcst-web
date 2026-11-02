package app.podcst.feature.podcast

import app.podcst.data.SessionState
import app.podcst.model.Episode
import app.podcst.model.EpisodePage
import app.podcst.model.EpisodeQuery
import app.podcst.model.FeedFreshness
import app.podcst.model.Podcast
import app.podcst.network.ApiException
import app.podcst.network.awaitFeedContent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

internal data class EpisodePaging(
    val query: EpisodeQuery = EpisodeQuery(),
    val episodes: List<Episode> = emptyList(),
    val nextCursor: Int? = null,
    val total: Int = 0,
    val loading: Boolean = false,
    val failed: Boolean = false,
    val retryAt: Long = 0,
)

internal class PodcastReader(
    private val route: Podcast,
    private val scope: CoroutineScope,
    private val session: StateFlow<SessionState>,
    private val readerActive: () -> (() -> Boolean),
    private val cached: suspend (Podcast) -> Podcast?,
    private val resolve: suspend (Podcast) -> Podcast,
    private val metadata: suspend (Podcast) -> Podcast,
    private val page: suspend (Podcast, EpisodeQuery, Int?) -> EpisodePage,
    private val refreshFeed: suspend (Podcast) -> FeedFreshness,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    val source = MutableStateFlow(route)
    val inaccessible = MutableStateFlow(false)
    val load = MutableStateFlow(LoadState.Loading)
    val paging = MutableStateFlow(EpisodePaging())
    private val visible = MutableStateFlow(false)
    private val jobs = mutableListOf<Job>()
    private var pageJob: Job? = null
    private var generation = 0L
    private var queryGeneration = 0L
    private var account = session.value.user?.id
    private var resolved = false
    private var active: () -> Boolean = { false }

    init {
        scope.launch {
            combine(visible, session) { visible, session -> Triple(visible, session.loading, session.user?.id) }
                .distinctUntilChanged().collect { (visible, restoring, account) ->
                    if (this@PodcastReader.account != account || restoring) {
                        this@PodcastReader.account = account
                        clear()
                    }
                    if (visible && !restoring) start(false)
                    else stop(if (visible) LoadState.Loading else LoadState.Loaded)
                }
        }
    }

    fun refresh() { if (canRead()) start(true) }
    fun retry() {
        if (!canRead()) return
        if (paging.value.failed && paging.value.nextCursor != null) loadMore() else start(false)
    }
    fun suspendReads() { visible.value = false; stop(LoadState.Loaded) }
    fun resumeReads() { visible.value = true }

    fun query(query: EpisodeQuery) {
        val normalized = query.copy(search = query.search.trim())
        if (normalized == paging.value.query) return
        queryGeneration++
        pageJob?.cancel()
        paging.value = EpisodePaging(query = normalized)
        if (resolved && visible.value && !session.value.loading) {
            requestPage(null, debounce = true)
            if (source.value.episodes.isEmpty() && normalized != EpisodeQuery()) {
                val token = generation
                jobs += scope.launch { readLatest(token) }
            }
        }
    }

    fun loadMore() {
        val state = paging.value
        if (!resolved || !visible.value || state.loading || pageJob?.isActive == true || state.retryAt > clock()) return
        state.nextCursor?.let { requestPage(it) }
    }

    private fun canRead() = visible.value && !session.value.loading && maxOf(source.value.freshness?.retryAtMs ?: 0, paging.value.retryAt) <= clock()

    private fun clear() {
        stop(LoadState.Loading)
        source.value = if (route.isPrivate) Podcast(id = route.id, feed = "", title = "Podcast unavailable", isPrivate = true) else route.copy(episodes = emptyList())
        paging.value = EpisodePaging(query = paging.value.query)
        inaccessible.value = route.isPrivate
    }

    private fun stop(state: LoadState) {
        generation++
        queryGeneration++
        jobs.forEach(Job::cancel)
        jobs.clear()
        pageJob?.cancel()
        resolved = false
        paging.value = paging.value.copy(loading = false)
        load.value = state
    }

    private fun start(force: Boolean) {
        if (route.isPrivate && session.value.user == null) {
            clear()
            load.value = LoadState.Failed
            return
        }
        stop(if (force) LoadState.Refreshing else LoadState.Loading)
        active = readerActive()
        val token = generation
        jobs += scope.launch {
            try {
                check(token)
                val snapshot = try { cached(source.value) } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { null }
                snapshot?.let { found ->
                    check(token)
                    source.value = found.copy(freshness = source.value.freshness)
                    if (paging.value.query == EpisodeQuery() && paging.value.episodes.isEmpty()) {
                        paging.value = paging.value.copy(episodes = found.episodes, total = found.episodeCount)
                    }
                }
                val result = resolve(source.value)
                check(token)
                source.value = result
                inaccessible.value = false
                resolved = true
                jobs += scope.launch { readMetadata(token) }
                requestPage(null)
                if (paging.value.query != EpisodeQuery()) jobs += scope.launch { readLatest(token) }
                if (force) jobs += scope.launch { refresh(token, forced = true) }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                failure(error, token)
                if (token == generation) load.value = LoadState.Failed
            }
        }
    }

    private suspend fun check(token: Long) {
        currentCoroutineContext().ensureActive()
        if (token != generation || !active()) throw CancellationException("Reader changed")
    }

    private suspend fun readMetadata(token: Long) {
        try {
            val found = metadata(source.value)
            check(token)
            source.value = found.copy(episodes = source.value.episodes.map { it.context(found) }, freshness = source.value.freshness ?: found.freshness)
            paging.value = paging.value.copy(episodes = paging.value.episodes.map { it.context(found) })
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            failure(error, token)
        }
    }

    private fun requestPage(cursor: Int?, debounce: Boolean = false) {
        pageJob?.cancel()
        val token = generation
        val queryToken = ++queryGeneration
        val previous = paging.value
        val query = previous.query
        paging.value = previous.copy(nextCursor = previous.nextCursor.takeIf { cursor != null }, loading = true, failed = false, retryAt = 0)
        if (cursor == null && load.value != LoadState.Refreshing) load.value = LoadState.Loading
        pageJob = scope.launch {
            try {
                if (debounce) delay(300)
                val result = readPage(query, cursor, token)
                check(token)
                if (queryToken != queryGeneration) return@launch
                fun continuation(page: EpisodePage, after: Int?): Int? {
                    val next = page.nextCursor?.takeIf { page.hasMore && it > (after ?: 0) }
                    if (page.hasMore && next == null) throw IllegalStateException("Episode cursor did not advance")
                    return next
                }
                var next = continuation(result, cursor)
                if (query == EpisodeQuery() && cursor == null) {
                    source.value = source.value.copy(episodes = result.episodes.map { it.context(source.value) }, episodeCount = result.total, freshness = result.freshness)
                }
                val samePrefix = cursor == null && result.episodes.isNotEmpty() && previous.episodes.size > result.episodes.size &&
                    previous.episodes.take(result.episodes.size).map { it.identity } == result.episodes.map { it.identity }
                val retainTail = samePrefix && previous.nextCursor != null
                var rows = when {
                    cursor != null -> previous.episodes + result.episodes
                    retainTail -> result.episodes + previous.episodes.drop(result.episodes.size)
                    else -> result.episodes
                }.distinctBy { it.identity }
                if (cursor == null && !retainTail) {
                    while (rows.size < previous.episodes.size && next != null) {
                        val after = next
                        val older = readPage(query, after, token)
                        check(token)
                        if (queryToken != queryGeneration) return@launch
                        rows = (rows + older.episodes).distinctBy { it.identity }
                        next = continuation(older, after)
                    }
                }
                paging.value = EpisodePaging(query, rows.map { it.context(source.value) }, if (retainTail) previous.nextCursor else next, result.total)
                load.value = LoadState.Loaded
                if (query == EpisodeQuery() && cursor == null) jobs += scope.launch { refresh(token, forced = false) }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                failure(error, token)
                if (token == generation && queryToken == queryGeneration) {
                    paging.value = paging.value.copy(loading = false, failed = true, retryAt = retryAt(error))
                    load.value = LoadState.Failed
                }
            }
        }
    }

    private suspend fun readPage(query: EpisodeQuery, cursor: Int?, token: Long, foreground: Boolean = true): EpisodePage = awaitFeedContent(
        read = {
            check(token)
            val result = page(source.value, query, cursor)
            check(token)
            if (result.freshness?.content == FeedFreshness.Content.missing) throw ApiException(202, "Episodes are being prepared", freshness = result.freshness)
            result
        },
        active = { token == generation && active() },
        pending = { freshness ->
            if (token == generation) {
                source.value = source.value.copy(freshness = freshness)
                if (cursor == null && foreground) load.value = LoadState.Rechecking
            }
        },
        clock = clock,
    )

    private suspend fun readLatest(token: Long) {
        try {
            val latest = readPage(EpisodeQuery(), null, token, foreground = false)
            check(token)
            source.value = source.value.copy(episodes = latest.episodes.map { it.context(source.value) }, episodeCount = latest.total, freshness = latest.freshness)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            failure(error, token)
        }
    }

    private var refreshing: Job? = null

    private suspend fun refresh(token: Long, forced: Boolean) {
        if (refreshing?.isActive == true) return
        if (!forced && source.value.freshness?.state != FeedFreshness.State.stale && source.value.freshness?.recheckDelay(clock(), clock()) == null) return
        refreshing = currentCoroutineContext()[Job]
        val startedAt = clock()
        try {
            val before = source.value.freshness
            if (forced || before?.state == FeedFreshness.State.stale) {
                val admitted = refreshFeed(source.value)
                check(token)
                source.value = source.value.copy(freshness = admitted)
                if (admitted.content == FeedFreshness.Content.cached && admitted.checkedAtMs != before?.checkedAtMs) {
                    readLatest(token)
                    if (paging.value.episodes.isEmpty() && !paging.value.loading) requestPage(null)
                }
            }
            while (true) {
                val wait = source.value.freshness?.recheckDelay(startedAt, clock()) ?: break
                delay(wait)
                check(token)
                val previous = source.value.freshness
                readLatest(token)
                if (source.value.freshness?.checkedAtMs != previous?.checkedAtMs && paging.value.episodes.isEmpty() && !paging.value.loading) requestPage(null)
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            failure(error, token)
        }
    }

    private fun retryAt(error: Exception): Long = (error as? ApiException)?.let {
        it.freshness?.retryAtMs ?: it.retryAfterSeconds?.let { seconds -> clock() + seconds * 1000 }
    } ?: 0

    private fun failure(error: Exception, token: Long) {
        if (token != generation) return
        (error as? ApiException)?.freshness?.let { source.value = source.value.copy(freshness = it) }
        if (error is ApiException && error.status in listOf(401, 403, 404)) {
            clear()
            inaccessible.value = true
            source.value = Podcast(id = route.id, feed = "", title = "Podcast unavailable", isPrivate = route.isPrivate)
            load.value = LoadState.Failed
        }
    }

    private fun Episode.context(podcast: Podcast) = copy(
        feed = feed.ifEmpty { podcast.feed },
        podcastTitle = podcastTitle ?: podcast.title,
        cover = cover.ifEmpty { podcast.cover },
        isPrivate = isPrivate || podcast.isPrivate,
    )
}
