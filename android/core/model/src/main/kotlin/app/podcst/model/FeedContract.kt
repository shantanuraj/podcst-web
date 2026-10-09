package app.podcst.model

import kotlinx.serialization.Serializable

@Serializable
data class FeedFreshness(
    val content: Content,
    val state: State,
    val checkedAtMs: Long?,
    val retryAtMs: Long?,
) {
    @Serializable enum class Content { cached, missing }
    @Serializable enum class State { fresh, stale, pending, backoff, unavailable }

    init {
        require(listOfNotNull(checkedAtMs, retryAtMs).all { it in 0..9007199254740991L })
        require(state != State.fresh || content == Content.cached && checkedAtMs != null)
        require((state == State.pending || state == State.backoff) == (retryAtMs != null))
    }
}

@Serializable
data class FeedRefreshResponse(val podcastId: StateID, val freshness: FeedFreshness)

@Serializable
data class FeedResolutionItem(
    val index: Int,
    val podcastId: StateID?,
    val status: Status,
    val retryAfterSeconds: Int?,
) {
    @Serializable enum class Status { resolved, retry, unavailable }

    init {
        require(index in 0..<20)
        require((status == Status.resolved) == (podcastId != null))
        require((status == Status.retry) == (retryAfterSeconds != null))
        require(retryAfterSeconds == null || retryAfterSeconds in 1..86400)
    }
}
