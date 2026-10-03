package app.podcst.model

import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

data class Chapter(val title: String, val start: Duration)

fun List<Chapter>.indexAt(time: Duration): Int? = indexOfLast { it.start <= time }.takeIf { it >= 0 }

fun List<Chapter>.endOf(index: Int, duration: Duration): Duration =
    if (index + 1 < size) this[index + 1].start else maxOf(duration, this[index].start)

data class Timestamp(val text: String, val range: IntRange, val position: Duration)

object ShowNotes {
    private const val TIMESTAMP = "(?<![A-Za-z0-9])(?:[0-9]{1,2}:)?[0-9]{1,2}:[0-5][0-9](?![A-Za-z0-9])"
    private val timestamp = Regex(TIMESTAMP)
    private val chapter = Regex("^[\\s\\p{Z}\\p{P}\\p{S}]*($TIMESTAMP)[\\s\\p{Z}\\p{Pd}:|)\\].]*(.+)$")
    private val lineBreak = Regex("<(br|/p|/li|/div|/h[1-6])[^>]*>", RegexOption.IGNORE_CASE)
    private val tag = Regex("<[^>]+>")
    private val entities = listOf("&nbsp;" to " ", "&amp;" to "&", "&#39;" to "'", "&quot;" to "\"")

    fun chapters(html: String): List<Chapter> {
        val chapters = plainText(lineBreak.replace(html, "\n")).lineSequence().mapNotNull { line ->
            val match = chapter.find(line) ?: return@mapNotNull null
            val start = position(match.groupValues[1]) ?: return@mapNotNull null
            val title = match.groupValues[2].trim { it.isWhitespace() }
            title.takeIf { it.isNotEmpty() }?.let { Chapter(it, start) }
        }.toList()
        return chapters.takeIf { it.size >= PlaybackRules.MINIMUM_CHAPTERS && it.zipWithNext().all { (a, b) -> a.start < b.start } } ?: emptyList()
    }

    fun timestamps(text: String): List<Timestamp> = timestamp.findAll(text).mapNotNull { match ->
        position(match.value)?.let { Timestamp(match.value, match.range, it) }
    }.toList()

    fun position(timestamp: String): Duration? {
        val parts = timestamp.split(':').filter { it.isNotEmpty() }.mapNotNull { it.toIntOrNull() }
        if (parts.size !in 2..3 || parts.last() >= 60) return null
        if (parts.size == 2) return (parts[0] * 60 + parts[1]).seconds
        if (parts[1] >= 60) return null
        return (parts[0] * 3600 + parts[1] * 60 + parts[2]).seconds
    }

    fun plainText(html: String): String =
        entities.fold(tag.replace(html, " ")) { text, (entity, value) -> text.replace(entity, value) }
}
