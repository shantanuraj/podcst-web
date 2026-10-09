package app.podcst.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class FeedFreshness(
    val content: Content,
    val state: State,
    val checkedAtMs: Long?,
    val retryAtMs: Long?,
) {
    @Serializable enum class Content { cached, missing }
    @Serializable enum class State { fresh, stale, pending, backoff, unavailable }

    fun recheckDelay(startedAt: Long, now: Long = System.currentTimeMillis()): Long? {
        if (state != State.pending && state != State.backoff) return null
        val delay = maxOf(FeedLimits.RECHECK_SECONDS * 1000L, (retryAtMs ?: now + FeedLimits.RECHECK_SECONDS * 1000L) - now)
        return delay.takeIf { it < FeedLimits.POLL_WINDOW_SECONDS * 1000L - (now - startedAt) }
    }

    val message: String get() = when (state) {
        State.pending -> if (content == Content.missing) "Preparing episodes…" else "Refreshing. Cached episodes remain available."
        State.backoff -> "Updates delayed. Existing content is retained."
        State.unavailable -> "Content temporarily unavailable. Existing follows are retained."
        State.stale -> "Cached episodes. Updates have not been checked recently."
        State.fresh -> "Up to date"
    }

    init {
        require(listOfNotNull(checkedAtMs, retryAtMs).all { it in 0..9007199254740991L })
        require(state != State.fresh || content == Content.cached && checkedAtMs != null)
        require((state == State.pending || state == State.backoff) == (retryAtMs != null))
    }
}

@Serializable
data class FeedImportRequest(val protocol: Int, val accountId: String, val generation: String, val feedUrls: List<String>) {
    companion object {
        fun batches(accountId: String, generation: String, feeds: List<String>): List<List<String>> {
            val batches = mutableListOf<List<String>>()
            var batch = mutableListOf<String>()
            fun fits(urls: List<String>) = Json.encodeToString(serializer(), FeedImportRequest(1, accountId, generation, urls)).toByteArray(Charsets.UTF_8).size <= FeedLimits.BODY_BYTES
            for (feed in feeds) {
                require(feed.isNotEmpty() && feed.length <= 4096)
                if (batch.size == FeedLimits.IMPORT_ITEMS || !fits(batch + feed)) {
                    if (batch.isNotEmpty()) batches.add(batch)
                    batch = mutableListOf()
                }
                batch.add(feed)
                require(fits(batch))
            }
            if (batch.isNotEmpty()) batches.add(batch)
            return batches
        }
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
        require(index in 0..<FeedLimits.IMPORT_ITEMS)
        require((status == Status.resolved) == (podcastId != null))
        require((status == Status.retry) == (retryAfterSeconds != null))
        require(retryAfterSeconds == null || retryAfterSeconds in 1..86400)
    }
}
