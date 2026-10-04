package app.podcst.feature.podcast

import app.podcst.model.Episode
import app.podcst.model.EpisodeSort
import app.podcst.model.SortDirection
import java.text.Collator

data class EpisodeOrder(
    val sort: EpisodeSort = EpisodeSort.Published,
    val direction: SortDirection = SortDirection.Descending,
) {
    companion object {
        val all: List<EpisodeOrder> = listOf(
            EpisodeOrder(EpisodeSort.Published, SortDirection.Descending),
            EpisodeOrder(EpisodeSort.Published, SortDirection.Ascending),
            EpisodeOrder(EpisodeSort.Title, SortDirection.Ascending),
            EpisodeOrder(EpisodeSort.Title, SortDirection.Descending),
            EpisodeOrder(EpisodeSort.Duration, SortDirection.Descending),
            EpisodeOrder(EpisodeSort.Duration, SortDirection.Ascending),
        )
    }
}

internal fun List<Episode>.arranged(order: EpisodeOrder, query: String, collator: Collator): List<Episode> {
    val needle = query.trim()
    val matching = if (needle.isEmpty()) this else filter { it.title.contains(needle, ignoreCase = true) }
    val ascending: Comparator<Episode> = when (order.sort) {
        EpisodeSort.Published -> compareBy(nullsFirst()) { it.published }
        EpisodeSort.Title -> compareBy(collator) { it.title }
        EpisodeSort.Duration -> compareBy(nullsFirst()) { it.duration }
    }
    return matching.sortedWith(if (order.direction == SortDirection.Ascending) ascending else ascending.reversed())
}
