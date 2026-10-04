package app.podcst.model

import kotlinx.serialization.Serializable

@Serializable
data class PlaybackQueue(
    val episodes: List<Episode> = emptyList(),
    val current: Int = 0,
    val active: Boolean = false,
) {
    val episode: Episode? get() = episodes.getOrNull(current)

    val upNext: List<Episode>
        get() = if (episode == null) episodes else episodes.drop(current + 1) + episodes.take(current)

    fun index(of: EpisodeIdentity): Int? = episodes.indexOfFirst { it.identity == of }.takeIf { it >= 0 }

    fun playing(episode: Episode): PlaybackQueue {
        val existing = index(episode.identity)
        return if (existing != null) {
            copy(episodes = episodes.replacing(existing, episode), current = existing, active = true)
        } else {
            copy(episodes = episodes + episode, current = episodes.size, active = true)
        }
    }

    fun enqueue(episode: Episode, next: Boolean = false): PlaybackQueue {
        if (index(episode.identity) != null) return this
        val inserted = if (next && episodes.isNotEmpty()) {
            episodes.toMutableList().apply { add(minOf(current + 1, size), episode) }
        } else {
            episodes + episode
        }
        return if (this.episode == null) copy(episodes = inserted, current = inserted.size - 1) else copy(episodes = inserted)
    }

    fun finished(): PlaybackQueue {
        if (episode == null) return this
        if (episodes.size <= 1) return PlaybackQueue()
        val remaining = episodes.toMutableList().apply { removeAt(current) }
        return copy(episodes = remaining, current = following(current, remaining), active = true)
    }

    fun markedPlayed(): PlaybackQueue = if (active) finished() else this

    fun next(): PlaybackQueue =
        if (episodes.isEmpty()) this else copy(current = if (current + 1 < episodes.size) current + 1 else 0, active = true)

    fun previous(): PlaybackQueue =
        if (episodes.isEmpty()) this else copy(current = if (current > 0) current - 1 else episodes.size - 1, active = true)

    fun removing(indices: Set<Int>): PlaybackQueue {
        if (indices.isEmpty() || episodes.isEmpty()) return this
        val remaining = episodes.filterIndexed { index, _ -> index !in indices }
        if (remaining.isEmpty()) return PlaybackQueue()
        return copy(episodes = remaining, current = following(current - indices.count { it < current }, remaining))
    }

    fun removingUpNext(offsets: Set<Int>): PlaybackQueue = rotatedToCurrent().removing(offsets.mapTo(mutableSetOf()) { it + 1 })

    fun movingUpNext(from: Int, to: Int): PlaybackQueue = rotatedToCurrent().moving(from + 1, to + 1)

    fun moving(from: Int, to: Int): PlaybackQueue {
        if (from !in episodes.indices) return this
        val destination = to.coerceIn(0, episodes.size)
        val reordered = episodes.toMutableList()
        val moved = reordered.removeAt(from)
        val insertion = minOf(if (from < destination) destination - 1 else destination, reordered.size)
        reordered.add(insertion, moved)
        val index = when {
            current == from -> minOf(insertion, reordered.size - 1)
            from < current -> (current - 1).let { if (insertion <= it) it + 1 else it }
            insertion <= current -> current + 1
            else -> current
        }
        return copy(episodes = reordered, current = index)
    }

    fun stopped(): PlaybackQueue = if (active) copy(active = false) else this

    fun reopened(): PlaybackQueue = if (episode != null && !active) copy(active = true) else this

    fun cleared(): PlaybackQueue = PlaybackQueue()

    fun updating(episode: Episode): PlaybackQueue =
        index(episode.identity)?.let { copy(episodes = episodes.replacing(it, episode)) } ?: this

    fun rotatedToCurrent(): PlaybackQueue =
        if (current > 0 && current in episodes.indices) copy(episodes = episodes.drop(current) + episodes.take(current), current = 0) else this
}

private fun following(index: Int, remaining: List<Episode>) = if (index < remaining.size) index else 0

private fun <T> List<T>.replacing(index: Int, value: T): List<T> = toMutableList().apply { set(index, value) }
