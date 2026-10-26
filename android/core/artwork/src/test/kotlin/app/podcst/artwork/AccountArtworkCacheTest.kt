package app.podcst.artwork

import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class AccountArtworkCacheTest {
    @Test fun erasureRemovesOnlyTheConfirmedAccountAndRefusesLateWrites() {
        val root = Files.createTempDirectory("artwork-deletion").toFile()
        val cache = AccountArtworkCache(root, 1024 * 1024)
        val account = "a".repeat(64)
        val other = "b".repeat(64)
        try {
            for (scope in listOf(account, other, "guest")) {
                val editor = requireNotNull(cache.openEditor("$scope:image"))
                editor.data.toFile().writeText(scope)
                editor.metadata.toFile().writeText("metadata")
                editor.commit()
            }
            cache.erase(account)
            assertNull(cache.openSnapshot("$account:image"))
            assertNull(cache.openEditor("$account:late"))
            assertFalse(root.resolve(account).exists())
            for (scope in listOf(other, "guest")) {
                requireNotNull(cache.openSnapshot("$scope:image")).use {
                    assertEquals(scope, it.data.toFile().readText())
                }
            }
            cache.shutdown()
            val restarted = AccountArtworkCache(root, 1024 * 1024)
            try {
                requireNotNull(restarted.openSnapshot("$other:image")).use {
                    assertEquals(other, it.data.toFile().readText())
                }
            } finally { restarted.shutdown() }
        } finally { cache.shutdown(); root.deleteRecursively() }
    }
}
