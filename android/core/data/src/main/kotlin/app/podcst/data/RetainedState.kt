package app.podcst.data

import app.podcst.network.PodcstApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest

/** Read-only legacy material stays device-local until this explicit, source-scoped resolution. */
class RetainedState(private val scopes: Scopes, private val api: PodcstApi, private val catalog: CatalogRepository) {
    val episodes = scopes.current.flatMapLatest { owner -> owner.database.episodes().observeUnresolved() }
    val podcasts = scopes.current.flatMapLatest { owner -> owner.database.podcasts().observeUnresolved() }
    val count = combine(episodes, podcasts) { episodes, podcasts -> episodes.size + podcasts.size }

    suspend fun resolve() {
        val owner = scopes.current.value
        check(owner.accountId == null || scopes.verified) { "Verify your account before resolving retained data" }
        try {
            val feeds = owner.database.episodes().unresolved().map { it.feed } + owner.database.podcasts().unresolved().map { it.feed }
            for (feed in feeds.distinct()) {
                // Only feed/GUID within the original source may establish a mapping. Catalog's
                // transactional upsert moves references only when exactly one old record matches.
                val podcast = api.podcast(feed)
                if (scopes.current.value !== owner) throw CancellationException("Account changed")
                if (podcast.feed != feed || podcast.id == null) continue
                val complete = catalog.load(podcast)
                if (scopes.current.value !== owner) throw CancellationException("Account changed")
                if (complete.feed == feed) catalog.store(listOf(complete), complete = true, owner = owner)
            }
            scopes.durable.clearError(owner.accountId)
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            scopes.durable.error(owner.accountId, "Some retained items could not be resolved. Original source remains on this device.")
            throw failure
        }
    }
}
