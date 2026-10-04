package app.podcst.model

import java.security.MessageDigest
import kotlin.time.Duration

class ChapterArtwork(data: ByteArray) {
    val data: ByteArray = data.copyOf()
    val id: String = MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it) }

    override fun equals(other: Any?): Boolean = other is ChapterArtwork && id == other.id
    override fun hashCode(): Int = id.hashCode()
}

class ChapterMetadata(entries: List<Chapter> = emptyList()) {
    val entries: List<Chapter> = entries.filter { it.start.isFinite() && it.start >= Duration.ZERO }.sortedBy { it.start }
    val navigation: List<Chapter> = this.entries.filterNot { it.isHidden }.distinctBy { it.start }
    private val hidden = this.entries.filter { it.isHidden }

    fun artworkAt(time: Duration, duration: Duration): ChapterArtwork? {
        if (!time.isFinite() || time < Duration.ZERO) return null
        hidden.withIndex().reversed().forEach { (index, chapter) ->
            val end = chapter.end ?: hidden.getOrNull(index + 1)?.start ?: duration
            if (time >= chapter.start && time < end && chapter.artwork != null) return chapter.artwork
        }
        val index = navigation.indexAt(time) ?: return null
        val chapter = navigation[index]
        val end = minOf(chapter.end ?: Duration.INFINITE, navigation.endOf(index, duration))
        return chapter.artwork.takeIf { time < end }
    }
}
