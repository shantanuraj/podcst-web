package app.podcst.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class AccountEpisodeList(val id: String, val kind: String, val name: String?, val revision: String, val itemCount: Int)

@Serializable
enum class ListAvailability {
    @SerialName("available") Available,
    @SerialName("content_missing") ContentMissing,
    @SerialName("unavailable") Unavailable,
}

@Serializable
data class ListMembership(val episodeId: Long, val addedAt: Long, val availability: ListAvailability)

@Serializable
data class ListSnapshot(val listId: String, val revision: String, val items: List<ListMembership>)

data class ListEpisodeItem(val membership: ListMembership, val episode: Episode?)

data class ListEpisodePage(val listId: String, val revision: String, val items: List<ListEpisodeItem>, val nextCursor: String?)

@Serializable
data class ListChange(val op: Operation, val episodeId: Long) {
    @Serializable
    enum class Operation {
        @SerialName("add") Add,
        @SerialName("remove") Remove,
    }
}

@Serializable
data class ListBatch(val clientId: String, val sequence: String, val changes: List<ListChange>)

@Serializable
data class ListChangeResult(val episodeId: Long, val status: Status) {
    @Serializable
    enum class Status {
        @SerialName("applied") Applied,
        @SerialName("unchanged") Unchanged,
        @SerialName("not_found") NotFound,
    }
}

@Serializable
data class ListAcknowledgement(val clientId: String, val sequence: String, val listId: String, val revision: String, val results: List<ListChangeResult>)
