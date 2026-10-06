package app.podcst.data

import app.podcst.model.Episode
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

fun validStarId(id: Long?): Boolean = id != null && id in 1..9_007_199_254_740_991L

data class StarItem(val membership: ListMembership, val episode: Episode?) {
    val id: Long get() = membership.episodeId
}

@Serializable
internal data class StarIntent(val change: ListChange, val at: Long)

@Serializable
internal data class StarFlight(val batch: ListBatch, val intents: List<StarIntent>, val acknowledgement: ListAcknowledgement? = null)

@Serializable
internal data class StarScope(
    val clientId: String = UUID.randomUUID().toString(),
    var sequence: Long = 0,
    var listId: String? = null,
    var snapshot: ListSnapshot? = null,
    var episodes: Map<Long, Episode> = emptyMap(),
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
            .map { StarItem(it, episodes[it.episodeId].takeUnless { _ -> it.availability == ListAvailability.Unavailable }) }
    }

    fun enqueue(id: Long, op: ListChange.Operation, at: Long, episode: Episode? = null) {
        require(validStarId(id))
        if (episode != null) episodes = episodes + (id to episode)
        failures = failures - id
        queued = queued + StarIntent(ListChange(op, id), at)
    }

    fun freeze() {
        if (flight != null || queued.isEmpty() || listId == null || blocked != null) return
        check(sequence < Long.MAX_VALUE)
        val intents = queued.take(100)
        queued = queued.drop(intents.size)
        sequence++
        flight = StarFlight(ListBatch(clientId, sequence.toString(), intents.map { it.change }), intents)
    }

    fun acknowledge(ack: ListAcknowledgement) {
        val sent = checkNotNull(flight)
        check(ack.clientId == clientId && ack.sequence == sent.batch.sequence && ack.listId == listId)
        check(ack.revision.toLong() >= 0 && ack.results.size == sent.intents.size)
        check(ack.results.zip(sent.intents).all { (result, intent) -> result.episodeId == intent.change.episodeId })
        flight = sent.copy(acknowledgement = ack)
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
        check(value.listId == listId && value.revision.toLong() >= 0)
        check(value.revision.toLong() >= (snapshot?.revision?.toLong() ?: 0))
        check(value.revision.toLong() >= (flight?.acknowledgement?.revision?.toLong() ?: 0))
        check(value.items.map { it.episodeId }.toSet().size == value.items.size && value.items.all { validStarId(it.episodeId) })
        snapshot = value
        if (flight?.acknowledgement != null) flight = null
        val visible = project().map { it.id }.toSet()
        val unavailable = value.items.filter { it.availability == ListAvailability.Unavailable }.map { it.episodeId }.toSet()
        episodes = episodes.filterKeys { it in visible && it !in unavailable }
    }

    fun hydrate(page: ListEpisodePage) {
        val snapshot = snapshot ?: return
        if (page.listId != listId || page.revision != snapshot.revision) return
        val members = snapshot.items.associateBy { it.episodeId }.toMutableMap()
        for (item in page.items) {
            val id = item.membership.episodeId
            val member = members[id] ?: continue
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
    val target = root[key]?.copy() ?: StarScope()
    for (item in guest.project().asReversed()) target.enqueue(item.id, ListChange.Operation.Add, item.membership.addedAt, item.episode)
    root[key] = target
    root.remove(Scope.key(null))
}
