package app.podcst.model

import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

data class Chapter(
    val title: String,
    val start: Duration,
    val end: Duration? = null,
    val artwork: ChapterArtwork? = null,
    val isHidden: Boolean = false,
)

fun List<Chapter>.indexAt(time: Duration): Int? = indexOfLast { it.start <= time }.takeIf { it >= 0 }

fun List<Chapter>.endOf(index: Int, duration: Duration): Duration =
    if (index + 1 < size) this[index + 1].start else maxOf(duration, this[index].start)

data class Timestamp(val text: String, val range: IntRange, val position: Duration)

object ShowNotes {
    private const val TIMESTAMP = "(?<![A-Za-z0-9])(?:[0-9]{1,2}:)?[0-9]{1,2}:[0-5][0-9](?![A-Za-z0-9])"
    private val timestamp = Regex(TIMESTAMP)
    private val chapter = Regex("""^[\p{P}\p{S}]*[\s\p{Z}]*($TIMESTAMP)(?:[\])][\s\p{Z}]*|[\p{Pd}|.][\s\p{Z}]*|:(?![0-9])[\s\p{Z}]*|[\s\p{Z}]+)(.+)$""")
    private val trailingChapter = Regex("""^(.*[^\s\p{Z}])(?:[\s\p{Z}]+(?:\(([^()]*)\)|\[([^\[\]]*)\]|[\p{Pd}|][\s\p{Z}]+([^\s\p{Z}]+))|[\s\p{Z}]*:[\s\p{Z}]+([^\s\p{Z}]+))$""")
    private val chapterAnnotation = Regex("""^(?:(?:story|chapter|segment)[\s\p{Z}]+)?starts?[\s\p{Z}]+(?:at|around)[\s\p{Z}]+""", RegexOption.IGNORE_CASE)
    private val titleSeparator = Regex("""^[\p{Pd}:|.]+[\s\p{Z}]+""")
    private val lineBreak = Regex("<(br|/p|/li|/div|/h[1-6])[^>]*>", RegexOption.IGNORE_CASE)
    private val tag = Regex("<[^>]+>")
    private val entities = listOf("&nbsp;" to " ", "&amp;" to "&", "&#39;" to "'", "&quot;" to "\"")

    fun chapters(html: String): List<Chapter> {
        val chapters = plainText(lineBreak.replace(html, "\n")).lineSequence().mapNotNull { raw ->
            val line = raw.trim { it.isWhitespace() }
            val leading = chapter.find(line)
            val trailing = if (leading == null) trailingChapter.find(line) else null
            val value = (leading?.groupValues?.get(1) ?: trailing?.groupValues?.drop(2)?.firstOrNull { it.isNotEmpty() })
                ?.trim { it.isWhitespace() }?.replaceFirst(chapterAnnotation, "") ?: return@mapNotNull null
            if (!timestamp.matches(value)) return@mapNotNull null
            val start = position(value) ?: return@mapNotNull null
            val title = (leading?.groupValues?.get(2) ?: trailing?.groupValues?.get(1))
                ?.trim { it.isWhitespace() }?.replaceFirst(titleSeparator, "") ?: return@mapNotNull null
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
