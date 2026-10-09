package app.podcst.data

import app.podcst.model.validateStateScope
import app.podcst.model.StateRevision
import app.podcst.model.Episode
import app.podcst.model.FeedFreshness
import app.podcst.model.ListAcknowledgement
import app.podcst.model.ListAvailability
import app.podcst.model.ListBatch
import app.podcst.model.ListChange
import app.podcst.model.ListChangeResult
import app.podcst.model.ListEpisodePage
import app.podcst.model.ListMembership
import app.podcst.model.ListSnapshot
import java.util.UUID
import kotlinx.serialization.Serializable

fun validStarId(id: Long?): Boolean = id != null && id > 0

data class StarItem(val membership: ListMembership, val episode: Episode?, val freshness: FeedFreshness? = null) {
    val id: Long get() = membership.episodeId
}

@Serializable
internal data class StarIntent(val change: ListChange, val at: Long)

@Serializable
internal data class StarFlight(val batch: ListBatch, val intents: List<StarIntent>, val acknowledgement: ListAcknowledgement? = null, val legacy: Boolean = true, val legacyAcknowledgement: ListAcknowledgement? = null)

@Serializable
internal data class StarScope(
    var identityVersion: Int = 1,
    val clientId: String = UUID.randomUUID().toString(),
    var sequence: Long = 0,
    var accountId: String? = null,
    var generation: String? = null,
    var listId: String? = null,
    var snapshot: ListSnapshot? = null,
    var episodes: Map<Long, Episode> = emptyMap(),
    @kotlinx.serialization.Transient var freshness: Map<Long, FeedFreshness> = emptyMap(),
    var queued: List<StarIntent> = emptyList(),
    var flight: StarFlight? = null,
    var blocked: Int? = null,
    var failures: Set<Long> = emptySet(),
) {
    fun project(): List<StarItem> {
        val members = snapshot?.items.orEmpty().associateBy { it.episodeId }.toMutableMap()
        val sent = flight?.let { flight -> flight.intents.filterIndexed { index, _ -> flight.acknowledgement?.results?.get(index)?.status != ListChangeResult.Status.NotFound } }.orEmpty()
        for (intent in sent + queued) {
            val id = intent.change.episodeId
            if (intent.change.op == ListChange.Operation.Remove) members.remove(id)
            else members.putIfAbsent(id, ListMembership(id, intent.at, ListAvailability.ContentMissing))
        }
        return members.values.sortedWith(compareByDescending<ListMembership> { it.addedAt }.thenByDescending { it.episodeId })
            .map { StarItem(it, episodes[it.episodeId].takeUnless { _ -> it.availability == ListAvailability.Unavailable }, freshness[it.episodeId].takeUnless { _ -> it.availability == ListAvailability.Unavailable }) }
    }

    fun enqueue(id: Long, op: ListChange.Operation, at: Long, episode: Episode? = null) {
        require(validStarId(id))
        if (episode != null) episodes = episodes + (id to episode)
        failures = failures - id
        queued = queued + StarIntent(ListChange(op, id), at)
    }

    fun freeze() {
        if (flight != null || queued.isEmpty() || listId == null || blocked != null || generation == null) return
        check(sequence < Long.MAX_VALUE)
        val intents = queued.take(100)
        queued = queued.drop(intents.size)
        sequence++
        flight = StarFlight(ListBatch(clientId, sequence.toString(), intents.map { it.change }), intents, legacy = false)
    }

    fun acknowledge(ack: ListAcknowledgement) {
        val sent = checkNotNull(flight)
        validateStateScope(checkNotNull(ack.protocol), checkNotNull(ack.accountId), checkNotNull(ack.generation), checkNotNull(accountId), generation)
        StateRevision(ack.revision)
        check(ack.clientId == clientId && ack.sequence == sent.batch.sequence && ack.listId == listId)
        check(ack.revision.toLong() >= 0 && ack.results.size == sent.intents.size)
        check(ack.results.zip(sent.intents).all { (result, intent) -> result.episodeId == intent.change.episodeId })
        flight = sent.copy(acknowledgement = ack, legacy = false, legacyAcknowledgement = if (sent.legacy) sent.acknowledgement else sent.legacyAcknowledgement)
        for (result in ack.results) {
            failures = failures - result.episodeId
            if (result.status == ListChangeResult.Status.NotFound) {
                failures = failures + result.episodeId
                episodes = episodes - result.episodeId
                snapshot = snapshot?.let { snapshot -> snapshot.copy(items = snapshot.items.map { if (it.episodeId == result.episodeId) it.copy(availability = ListAvailability.Unavailable) else it }) }
            }
        }
    }

    fun install(value: ListSnapshot) {
        validateStateScope(checkNotNull(value.protocol), checkNotNull(value.accountId), checkNotNull(value.generation), checkNotNull(accountId), generation)
        StateRevision(value.revision)
        check(value.listId == listId && value.revision.toLong() >= 0)
        if (value.revision.toLong() < (snapshot?.revision?.toLong() ?: 0) || value.revision.toLong() < (flight?.acknowledgement?.revision?.toLong() ?: 0)) throw java.io.IOException("Star snapshot is behind; overlay retained")
        check(value.items.map { it.episodeId }.toSet().size == value.items.size && value.items.all { validStarId(it.episodeId) })
        snapshot = value
        if (flight?.acknowledgement != null) flight = null
        if (flight?.legacy != true && queued.none { it.change.episodeId > 9_007_199_254_740_991L }) identityVersion = 2
        val visible = project().map { it.id }.toSet()
        val unavailable = value.items.filter { it.availability == ListAvailability.Unavailable }.map { it.episodeId }.toSet()
        episodes = episodes.filterKeys { it in visible && it !in unavailable }
    }

    fun hydrate(page: ListEpisodePage) {
        validateStateScope(checkNotNull(page.protocol), checkNotNull(page.accountId), checkNotNull(page.generation), checkNotNull(accountId), generation)
        val snapshot = snapshot ?: return
        if (page.listId != listId || page.revision != snapshot.revision) return
        val members = snapshot.items.associateBy { it.episodeId }.toMutableMap()
        for (item in page.items) {
            val id = item.membership.episodeId
            val member = members[id] ?: continue
            freshness = if (item.freshness != null && item.membership.availability != ListAvailability.Unavailable) freshness + (id to checkNotNull(item.freshness)) else freshness - id
            if (item.membership.availability == ListAvailability.Unavailable) {
                members[id] = member.copy(availability = ListAvailability.Unavailable)
                episodes = episodes - id
            } else if (member.availability != ListAvailability.Unavailable && item.episode?.id == id) {
                episodes = episodes + (id to item.episode!!)
            }
        }
        this.snapshot = snapshot.copy(items = snapshot.items.map { members.getValue(it.episodeId) })
    }
}

internal fun mergeGuest(root: MutableMap<String, StarScope>, accountId: String) {
    val guest = root[Scope.key(null)] ?: return
    val key = Scope.key(accountId)
    val target = root[key]?.copy() ?: StarScope(identityVersion = 2)
    val unresolved = guest.project().filter { guest.identityVersion == 1 && it.id > 9_007_199_254_740_991L }
    for (item in guest.project().asReversed().filterNot { it in unresolved }) target.enqueue(item.id, ListChange.Operation.Add, item.membership.addedAt, item.episode)
    root[key] = target
    if (unresolved.isEmpty()) root.remove(Scope.key(null)) else root[Scope.key(null)] = guest.copy(
        queued = unresolved.map { StarIntent(ListChange(ListChange.Operation.Add, it.id), it.membership.addedAt) },
        snapshot = null, episodes = guest.episodes.filterKeys { id -> unresolved.any { it.id == id } }, blocked = 409,
    )
}
