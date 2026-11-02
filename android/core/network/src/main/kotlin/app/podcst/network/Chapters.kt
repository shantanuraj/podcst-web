package app.podcst.network

import app.podcst.model.Chapter
import app.podcst.model.ChapterSource
import app.podcst.model.EpisodeChapters
import app.podcst.model.PlaybackRules
import kotlin.time.Duration.Companion.seconds
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
internal data class WireChapter(val title: String, val start: Double)

@Serializable
internal enum class WireChapterSource {
    @SerialName("embedded") Embedded,
    @SerialName("shownotes") ShowNotes,
    @SerialName("none") None,
}

@Serializable
internal data class WireEpisodeChapters(val chapters: List<WireChapter>, val source: WireChapterSource) {
    fun domain(): EpisodeChapters {
        require(if (source == WireChapterSource.None) chapters.isEmpty() else chapters.size >= PlaybackRules.MINIMUM_CHAPTERS)
        require(chapters.all { it.start.isFinite() && it.start >= 0 && it.title.isNotBlank() })
        require(chapters.zipWithNext().all { (a, b) -> a.start < b.start })
        return EpisodeChapters(chapters.map { Chapter(it.title, it.start.seconds) }, when (source) {
            WireChapterSource.Embedded -> ChapterSource.Embedded
            WireChapterSource.ShowNotes -> ChapterSource.ShowNotes
            WireChapterSource.None -> ChapterSource.None
        })
    }
}
