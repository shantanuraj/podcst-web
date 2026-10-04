package app.podcst.feature.discover

import app.podcst.data.Preferences
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class RecentSearchesTest {
    private val preferences = Preferences(RuntimeEnvironment.getApplication())

    @Before
    fun clear() = runTest { preferences.clearRecent() }

    @Test
    fun keepsTheEightMostRecentTermsNewestFirst() = runTest {
        (1..10).forEach { preferences.remember("term $it") }
        assertEquals((10 downTo 3).map { "term $it" }, preferences.recentSearches.first())
    }

    @Test
    fun deduplicatesIgnoringCaseAndMovesTheTermToTheFront() = runTest {
        listOf("history", "science", "History").forEach { preferences.remember(it) }
        assertEquals(listOf("History", "science"), preferences.recentSearches.first())
    }

    @Test
    fun clearsEverything() = runTest {
        preferences.remember("history")
        preferences.clearRecent()
        assertTrue(preferences.recentSearches.first().isEmpty())
    }
}
