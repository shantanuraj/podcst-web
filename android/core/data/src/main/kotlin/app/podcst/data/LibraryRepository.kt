package app.podcst.data

import app.podcst.database.SubscriptionEntity
import app.podcst.database.domain
import app.podcst.model.*
import app.podcst.network.ApiException
import app.podcst.network.PodcstApi
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class LibraryRepository(
    private val api: PodcstApi,
    private val scopes: Scopes,
    private val catalog: CatalogRepository,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val durable = scopes.durable
    private val sender = Mutex()
    private var retryAt = 0L
    val status = durable.status
    val podcasts: Flow<List<Podcast>> = scopes.current.flatMapLatest { scope ->
        combine(if (scope.accountId == null) scope.database.podcasts().observeSubscribed() else scope.database.podcasts().observeAll(), durable.revision) { rows, _ ->
            val account = scope.accountId
            if (account == null) rows.map { it.domain() } else {
                val state = runCatching { durable.account(account) }.getOrNull()
                val unavailable = state?.follows.orEmpty().filter { it.availability == StateAvailability.unavailable }.map { it.podcastId.value.toLong() }.toSet()
                rows.filter { it.id in state?.followed().orEmpty() && it.id !in unavailable }.map { it.domain() }
            }
        }
    }
    val subscribed: Flow<Set<String>> = scopes.current.flatMapLatest { owner ->
        combine(podcasts, durable.revision) { podcasts, _ ->
            owner.accountId?.let { account -> runCatching { durable.account(account).followed().mapTo(mutableSetOf()) { "podcast:$it" } }.getOrDefault(emptySet()) }
                ?: podcasts.mapTo(mutableSetOf()) { it.identity }
        }
    }
    val unavailable: Flow<List<Long>> = scopes.current.flatMapLatest { owner -> durable.revision.map {
        owner.accountId?.let { account -> runCatching { durable.account(account).let { state -> state.follows.filter { it.availability == StateAvailability.unavailable && it.podcastId.value.toLong() in state.followed() }.map { it.podcastId.value.toLong() } } }.getOrDefault(emptyList()) }.orEmpty()
    } }
    suspend fun removeUnavailable(id: Long) {
        val account = scopes.current.value.accountId ?: return
        durable.queueFollow(account, StateFollowChange(StateID(id.toString()), false))
        runCatching { refresh() }.onFailure { if (it is CancellationException) throw it }
    }
    val newReleases: Flow<List<Episode>> = scopes.current.flatMapLatest { scope ->
        combine(scope.database.episodes().observeNewReleases(PlaybackRules.RELEASES_PER_PODCAST), podcasts) { rows, podcasts ->
            val ids = podcasts.mapNotNull { it.id }.toSet()
            rows.filter { scope.accountId == null || it.podcastId in ids }.map { it.domain() }
        }
    }

    suspend fun refresh(force: Boolean = false) {
        val owner = scopes.current.value
        if (owner.accountId == null) {
            durable.importGuestSource(owner.database.podcasts().subscribed().map { it.domain() })
            owner.database.subscriptions().replace(durable.guestFollows().map { SubscriptionEntity(it.feed, clock()) })
            for (podcast in durable.guestFollows()) {
                if (scopes.current.value !== owner) return
                catalog.store(listOf(podcast), owner = owner)
                owner.database.subscriptions().insert(SubscriptionEntity(podcast.feed, clock()))
                refreshGuest(podcast, force)
            }
            return
        }
        val account = owner.accountId
        val epoch = scopes.epoch
        if (!active(owner, epoch) || clock() < retryAt) return
        sender.withLock {
            try {
                if (durable.account(account).followBlocked != null) return@withLock
                val snapshot = api.followState()
                if (!active(owner, epoch)) return@withLock
                durable.installFollows(account, snapshot)
                for (guest in durable.guestFollows()) {
                    val resolved = if (guest.id != null) guest else api.podcast(guest.feed)
                    if (!active(owner, epoch)) return@withLock
                    if (resolved.id != null) durable.unionGuest(account, listOf(resolved.copy(feed = guest.feed)))
                }
                do {
                    val flight = durable.freezeFollows(account).followFlight ?: break
                    if (flight.ack == null) {
                        val ack = api.changeFollows(flight.batch)
                        if (!active(owner, epoch)) return@withLock
                        durable.acknowledgeFollows(account, ack)
                    }
                    val value = api.followState()
                    if (!active(owner, epoch)) return@withLock
                    durable.installFollows(account, value)
                } while (durable.account(account).followQueued.isNotEmpty())
                val hydrated = api.subscriptions()
                if (!active(owner, epoch)) return@withLock
                val current = durable.account(account)
                val unavailable = current.follows.filter { it.availability == StateAvailability.unavailable }.map { it.podcastId.value.toLong() }.toSet()
                val visible = hydrated.filter { it.id in current.followed() && it.id !in unavailable }
                catalog.store(visible, owner = owner)
                owner.database.subscriptions().replace(visible.mapIndexed { index, podcast -> SubscriptionEntity(podcast.feed, clock() - index) })
                durable.clearError(account)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                if (!active(owner, epoch)) return@withLock
                durable.error(account, "Follow sync paused: ${failure.message}. Pending work retained.")
                if (failure is ApiException && failure.status == 401) scopes.suspendSync()
                else if (failure is IllegalArgumentException || failure is IllegalStateException || failure is ApiException && (failure.code == "invalid_response" || failure.status in listOf(400, 403, 404, 409, 413, 426)))
                    durable.change(account) { it.copy(followBlocked = "Follow sync blocked: ${failure.message}") }
                else retryAt = clock() + ((failure as? ApiException)?.retryAfterSeconds?.coerceIn(1, 86400) ?: 30) * 1000
                throw failure
            }
        }
    }
    private fun active(owner: Scope, epoch: Long) = scopes.current.value === owner && scopes.epoch == epoch && scopes.verified

    suspend fun toggle(podcast: Podcast, subscribed: Boolean) {
        val owner = scopes.current.value
        try {
            if (owner.accountId == null) {
                if (podcast.isPrivate) throw ApiException(401, "Sign in to follow a private podcast")
                durable.importGuestSource(owner.database.podcasts().subscribed().map { it.domain() })
                durable.guestFollow(podcast, !subscribed)
            } else {
                val resolved = if (podcast.id != null) podcast else catalog.load(podcast)
                if (scopes.current.value !== owner) return
                val id = resolved.id ?: error("Resolve this podcast before following")
                durable.queueFollow(owner.accountId, StateFollowChange(StateID(id.toString()), !subscribed))
            }
            catalog.store(listOf(podcast), owner = owner)
            if (subscribed) owner.database.subscriptions().delete(podcast.feed)
            else owner.database.subscriptions().insert(SubscriptionEntity(podcast.feed, clock()))
        } catch (failure: Exception) { durable.error(owner.accountId, "Follow could not be saved: ${failure.message}"); throw failure }
        runCatching { refresh() }.onFailure { if (it is CancellationException) throw it }
    }

    suspend fun import(feeds: List<String>): ImportResult {
        if (feeds.isEmpty()) return ImportResult(0, 0)
        val owner = scopes.current.value
        val account = owner.accountId
        var succeeded = 0
        if (account != null) {
            check(scopes.verified) { "Verify your account before importing" }
            val epoch = scopes.epoch
            val snapshot = api.followState()
            check(active(owner, epoch))
            durable.installFollows(account, snapshot)
            durable.change(account) { it.copy(importFeeds = (it.importFeeds + feeds).distinct()) }
            for (batch in feeds.distinct().chunked(20)) {
                val result = api.resolveSubscriptions(account, snapshot.generation, batch)
                check(active(owner, epoch))
                validateStateScope(result.protocol, result.accountId, result.generation, account, snapshot.generation)
                check(result.items.map { it.index } == batch.indices.toList())
                for (item in result.items) {
                    check(item.status in listOf("resolved", "unavailable") && (item.podcastId != null) == (item.status == "resolved"))
                    if (item.podcastId != null) {
                        durable.change(account) { state -> state.copy(importFeeds = state.importFeeds - batch[item.index], followQueued = state.followQueued.filterNot { it.podcastId == item.podcastId } + StateFollowChange(checkNotNull(item.podcastId), true)) }
                        succeeded++
                    }
                }
            }
            if (succeeded != feeds.distinct().size) durable.error(account, "Some imported feeds are unavailable. Retry import to resolve retained failures.")
            return ImportResult(succeeded, feeds.distinct().size - succeeded)
        }
        for (feed in feeds.distinct()) {
            val podcast = api.podcast(feed)
            if (scopes.current.value !== owner) break
            if (!podcast.isPrivate) { toggle(podcast, false); succeeded++ }
        }
        return ImportResult(succeeded, feeds.distinct().size - succeeded)
    }
    suspend fun retryImports(): ImportResult = scopes.current.value.accountId?.let { import(durable.account(it).importFeeds) } ?: ImportResult(0, 0)
    suspend fun opml(): String = Opml.document(scopes.database.podcasts().subscribed().map { it.domain() })

    private suspend fun refreshGuest(podcast: Podcast, force: Boolean) {
        val owner = scopes.current.value
        val updated = when {
            force -> catalog.load(podcast, force = true)
            podcast.id != null -> api.episodes(checkNotNull(podcast.id), limit = PlaybackRules.RELEASES_PER_PODCAST).let { podcast.copy(episodes = it.episodes, episodeCount = it.total) }
            else -> api.podcast(podcast.feed)
        }
        catalog.store(listOf(updated), owner = owner)
    }
}
