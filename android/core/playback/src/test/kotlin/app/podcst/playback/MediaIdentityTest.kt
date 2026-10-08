package app.podcst.playback

import app.podcst.model.Episode
import app.podcst.model.EpisodeFile
import app.podcst.playback.media.MediaStore
import java.security.MessageDigest
import org.junit.Assert.*
import org.junit.Test

class MediaIdentityTest {
    private val episode = Episode(id = 9007199254740993, guid = "same", feed = "https://one.test/rss", title = "Episode", file = EpisodeFile("https://one.test/audio"))
    private fun hash(seed: String) = MessageDigest.getInstance("SHA-256").digest(seed.toByteArray()).joinToString("") { "%02x".format(it) }
    @Test fun existingCanonicalMediaBytesSurviveFeedAndEnclosureMoves() {
        assertEquals(hash("episode:9007199254740993"), MediaStore.key(episode))
        assertEquals(MediaStore.key(episode), MediaStore.key(episode.copy(feed = "moved", file = EpisodeFile("https://moved.test/audio"))))
        assertNotEquals(MediaStore.key(episode), MediaStore.key(episode.copy(id = 9007199254740992)))
    }
    @Test fun retainedFallbackMappingPreventsSilentRedownloadAfterExactResolution() {
        val oldSeed = "https://one.test/rss\u001Fsame"
        val local = episode.copy(id = null)
        assertEquals(hash(oldSeed), MediaStore.key(local))
        assertEquals(MediaStore.key(local), MediaStore.key(episode.copy(mediaIdentity = oldSeed)))
        assertNotEquals(MediaStore.key(local), MediaStore.key(local.copy(feed = "https://two.test/rss")))
    }
}
