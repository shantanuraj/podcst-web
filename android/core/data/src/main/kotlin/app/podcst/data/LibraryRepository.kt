package app.podcst.data

import app.podcst.database.SubscriptionEntity
import app.podcst.database.domain
import app.podcst.model.Episode
import app.podcst.model.ImportResult
import app.podcst.model.Opml
import app.podcst.model.PlaybackRules
import app.podcst.model.Podcast
import app.podcst.network.ApiException
import app.podcst.network.PodcstApi
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map

class LibraryRepository(
    private val api: PodcstApi,
    private val scopes: Scopes,
    private val catalog: CatalogRepository,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    val podcasts: Flow<List<Podcast>> = scopes.current.flatMapLatest { scope ->
        scope.database.podcasts().observeSubscribed().map { rows -> rows.map { it.domain() } }
    }

    val subscribed: Flow<Set<String>> = scopes.current.flatMapLatest { scope ->
        scope.database.subscriptions().observeFeeds().map { it.toSet() }
    }

    val newReleases: Flow<List<Episode>> = scopes.current.flatMapLatest { scope ->
        scope.database.episodes().observeNewReleases(PlaybackRules.RELEASES_PER_PODCAST).map { rows -> rows.map { it.domain() } }
    }

    suspend fun refresh(force: Boolean = false) {
        val scope = scopes.current.value
        if (scope.accountId != null) {
            val podcasts = api.subscriptions()
            if (scopes.current.value !== scope) return
            catalog.store(podcasts)
            val now = clock()
            scope.database.subscriptions().replace(podcasts.mapIndexed { index, podcast -> SubscriptionEntity(podcast.feed, now - index) })
            return
        }
        var failure: Exception? = null
        scope.database.podcasts().subscribed().forEach { entity ->
            try {
                refreshGuest(entity.domain(), force)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                failure = error
            }
            if (scopes.current.value !== scope) return
        }
        failure?.let { throw it }
    }

    suspend fun toggle(podcast: Podcast, subscribed: Boolean) {
        val scope = scopes.current.value
        if (scope.accountId != null) {
            val id = podcast.id ?: podcast.itunesId?.let { api.resolve(it, podcast.itunesLocale ?: "us") }
                ?: catalog.load(podcast).id
                ?: throw ApiException(400, "Podcast ID required")
            if (subscribed) api.unsubscribe(id) else api.subscribe(id)
            refresh()
            return
        }
        if (podcast.isPrivate) throw ApiException(401, "Sign in to follow a private podcast")
        if (subscribed) {
            scope.database.subscriptions().delete(podcast.feed)
        } else {
            catalog.store(listOf(podcast))
            scope.database.subscriptions().insert(SubscriptionEntity(podcast.feed, clock()))
            refreshGuest(podcast, force = false)
        }
    }

    suspend fun import(feeds: List<String>): ImportResult {
        if (feeds.isEmpty()) return ImportResult(0, 0)
        val scope = scopes.current.value
        if (scope.accountId != null) {
            val result = api.importSubscriptions(feeds)
            refresh()
            return result
        }
        var succeeded = 0
        feeds.distinct().forEach { feed ->
            val podcast = try {
                api.podcast(feed).takeUnless { it.isPrivate }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                null
            }
            if (podcast != null && scopes.current.value === scope) {
                catalog.store(listOf(podcast))
                scope.database.subscriptions().insert(SubscriptionEntity(podcast.feed, clock()))
                succeeded++
            }
        }
        return ImportResult(succeeded, feeds.distinct().size - succeeded)
    }

    suspend fun opml(): String = Opml.document(scopes.database.podcasts().subscribed().map { it.domain() })

    private suspend fun refreshGuest(podcast: Podcast, force: Boolean) {
        val id = podcast.id
        val updated = when {
            force -> catalog.load(podcast, force = true)
            id != null -> api.episodes(id, limit = PlaybackRules.RELEASES_PER_PODCAST).let { page ->
                podcast.copy(episodes = page.episodes, episodeCount = page.total)
            }
            else -> api.podcast(podcast.feed)
        }
        catalog.store(listOf(updated))
    }
}
