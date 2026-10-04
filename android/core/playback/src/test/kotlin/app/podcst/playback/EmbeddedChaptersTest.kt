package app.podcst.playback

import androidx.media3.common.Metadata
import androidx.media3.common.MediaMetadata
import android.net.Uri
import androidx.media3.extractor.metadata.id3.ApicFrame
import androidx.media3.extractor.metadata.id3.ChapterFrame
import androidx.media3.extractor.metadata.id3.ChapterTocFrame
import androidx.media3.extractor.metadata.id3.Id3Decoder
import app.podcst.model.Chapter
import app.podcst.model.ChapterMetadata
import java.io.File
import kotlin.time.Duration.Companion.seconds
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class EmbeddedChaptersTest {
    @Test
    fun bothId3VersionsPreserveImagesAndHideUnreferencedCues() {
        for (version in listOf(3, 4)) {
            val metadata = EmbeddedChapters.decode(fixture(version))
            assertEquals(4, metadata.entries.size)
            assertEquals(listOf("Opening", "No artwork", "Ending"), metadata.navigation.map { it.title })
            assertEquals(listOf(0.seconds, 4.seconds, 8.seconds), metadata.navigation.map { it.start })
            assertTrue(metadata.entries[1].isHidden)
            assertEquals(3.5.seconds, metadata.entries[1].end)
            assertEquals(3, metadata.entries.count { it.artwork != null })
            val red = metadata.navigation.first().artwork!!
            val blue = metadata.entries[1].artwork!!
            assertNotEquals(red.id, blue.id)
            assertEquals(blue, metadata.navigation.last().artwork)
            val cases = listOf(0.0 to red, 1.999 to red, 2.0 to blue, 3.499 to blue, 3.5 to red, 4.0 to null, 7.999 to null, 8.0 to blue, 11.999 to blue, 12.0 to null)
            cases.forEach { (time, expected) -> assertEquals("time $time", expected, metadata.artworkAt(time.seconds, 16.seconds)) }
            assertNull(metadata.artworkAt((-1).seconds, 16.seconds))
        }
    }

    @Test
    fun noTableKeepsAllChaptersVisibleAndCyclesAreBounded() {
        val entries = fixture(3)
        assertEquals(4, EmbeddedChapters.decode(entries.filterNot { it is ChapterTocFrame }).navigation.size)
        val cycle = ChapterTocFrame("cycle", true, true, arrayOf("cycle", "opening"), emptyArray())
        val metadata = EmbeddedChapters.decode(entries.filterNot { it is ChapterTocFrame } + cycle)
        assertEquals(listOf("Opening"), metadata.navigation.map { it.title })
        assertEquals(4, metadata.entries.size)
    }

    @Test
    fun invalidImagesDoNotHideTitlesOrBlockNavigation() {
        for (data in listOf(byteArrayOf(1, 2, 3), ByteArray(4 * 1024 * 1024 + 1))) {
            val chapter = ChapterFrame("bad", 0, 1000, -1, -1, arrayOf(ApicFrame("image/png", "", 0, data)))
            val result = EmbeddedChapters.decode(listOf(chapter))
            assertEquals(1, result.navigation.size)
            assertNull(result.entries.first().artwork)
        }
    }

    @Test
    fun unknownEndsUseNextVisibleChapterAndSeekDoesNotEnterHiddenNavigation() {
        val fixture = EmbeddedChapters.decode(fixture(3))
        val image = fixture.entries.first().artwork!!
        val metadata = ChapterMetadata(listOf(
            Chapter("First", 0.seconds, artwork = image),
            Chapter("", 2.seconds, 3.seconds, image, isHidden = true),
            Chapter("Second", 4.seconds),
        ))
        assertEquals(image, metadata.artworkAt(3.5.seconds, 8.seconds))
        assertNull(metadata.artworkAt(4.seconds, 8.seconds))
        val state = PlayerState(chapters = fixture.navigation, chapterMetadata = fixture, position = 2.5.seconds, duration = 16.seconds)
        assertEquals(0, state.chapterIndex)
        assertEquals(fixture.entries[1].artwork, state.chapterArtwork)
        assertNull(state.copy(position = 4.seconds).chapterArtwork)
        assertNull(state.copy(chapterMetadata = ChapterMetadata()).chapterArtwork)
    }

    @Test
    fun sessionArtworkPreservesEpisodeMetadataAndReturnsToItsCover() {
        val artwork = EmbeddedChapters.decode(fixture(3)).entries.first().artwork!!
        val cover = Uri.parse("https://example.com/episode.png")
        val base = MediaMetadata.Builder().setTitle("Episode").setArtworkUri(cover).build()
        val active = base.withChapterArtwork(artwork)
        assertEquals("Episode", active.title)
        assertNull(active.artworkUri)
        assertArrayEquals(artwork.data, active.artworkData)
        assertSame(base, base.withChapterArtwork(null))
        assertEquals(cover, base.withChapterArtwork(null).artworkUri)
    }

    private fun fixture(version: Int): List<Metadata.Entry> {
        val data = File(System.getProperty("podcst.contracts"), "fixtures/media/chapters-artwork-v2$version.mp3").readBytes()
        val metadata = Id3Decoder().decode(data, data.size)!!
        return (0 until metadata.length()).map { metadata[it] }
    }
}
