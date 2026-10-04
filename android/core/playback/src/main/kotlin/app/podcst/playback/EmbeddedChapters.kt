package app.podcst.playback

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.ByteArrayOutputStream
import androidx.media3.common.C
import androidx.media3.common.Metadata
import androidx.media3.extractor.metadata.Chapter as MediaChapter
import androidx.media3.extractor.metadata.id3.ApicFrame
import androidx.media3.extractor.metadata.id3.ChapterFrame
import androidx.media3.extractor.metadata.id3.ChapterTocFrame
import app.podcst.model.Chapter
import app.podcst.model.ChapterArtwork
import app.podcst.model.ChapterMetadata
import kotlin.time.Duration.Companion.milliseconds

internal object EmbeddedChapters {
    fun decode(entries: List<Metadata.Entry>): ChapterMetadata {
        val contents = entries.filterIsInstance<ChapterTocFrame>().associateBy { it.elementId }
        val roots = contents.values.filter { it.isRoot }
        val visible = mutableSetOf<String>()
        val pending = ArrayDeque(roots.map { it.elementId })
        while (pending.isNotEmpty()) {
            val id = pending.removeLast()
            if (visible.add(id)) contents[id]?.children?.let { pending.addAll(it) }
        }
        var bytes = 0
        var number = 0
        val ids = mutableSetOf<String>()
        val chapters = entries.filterIsInstance<MediaChapter>()
            .filter { it.startTimeMs >= 0 && it.startTimeMs < 0xffffffffL }
            .sortedBy { it.startTimeMs }
            .take(1000)
            .mapNotNull { chapter ->
                val frame = chapter as? ChapterFrame
                if (frame != null && !ids.add(frame.chapterId)) return@mapNotNull null
                val end = chapter.endTimeMs.takeIf { it != C.TIME_UNSET && it != 0xffffffffL && it >= 0 }
                if (end != null && end <= chapter.startTimeMs) return@mapNotNull null
                val hidden = chapter.isHidden || (frame != null && roots.isNotEmpty() && frame.chapterId !in visible)
                if (!hidden) number++
                val artwork = frame?.let {
                    (0 until it.subFrameCount).asSequence().map(it::getSubFrame)
                        .filterIsInstance<ApicFrame>()
                        .filter { picture ->
                            picture.mimeType in listOf("image/png", "image/jpeg") &&
                                picture.pictureData.size in 1..4 * 1024 * 1024 &&
                                bytes + picture.pictureData.size <= 16 * 1024 * 1024
                        }
                        .mapNotNull { picture ->
                            artwork(picture.pictureData)?.also { bytes += picture.pictureData.size }
                        }
                        .firstOrNull()
                }
                Chapter(
                    title = chapter.title?.value?.trim()?.takeIf(String::isNotEmpty) ?: if (hidden) "" else "Chapter $number",
                    start = chapter.startTimeMs.milliseconds,
                    end = end?.milliseconds,
                    artwork = artwork,
                    isHidden = hidden,
                )
            }
        return ChapterMetadata(chapters)
    }

    private fun artwork(data: ByteArray): ChapterArtwork? {
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(data, 0, data.size, options)
        if (options.outWidth !in 1..16_384 || options.outHeight !in 1..16_384) return null
        options.inJustDecodeBounds = false
        options.inSampleSize = 1
        while (maxOf(options.outWidth, options.outHeight) / options.inSampleSize > 1024) options.inSampleSize *= 2
        while (options.inSampleSize <= 16_384) {
            val bitmap = BitmapFactory.decodeByteArray(data, 0, data.size, options) ?: return null
            val bytes = try {
                ByteArrayOutputStream().use { output ->
                    if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) return null
                    output.toByteArray()
                }
            } finally { bitmap.recycle() }
            if (bytes.size <= 512 * 1024) return ChapterArtwork(bytes)
            options.inSampleSize *= 2
        }
        return null
    }

}
