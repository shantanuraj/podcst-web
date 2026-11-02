package app.podcst

import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.v2.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class NavigatorTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun restorationKeepsSelectedTabBackStacksAndOpenPlayer() {
        val restoration = StateRestorationTester(compose)
        lateinit var navigator: Navigator
        restoration.setContent { navigator = rememberNavigator() }

        compose.runOnIdle {
            navigator.push(SearchRoute)
            navigator.select(Tab.Library)
            navigator.push(SettingsRoute)
            navigator.nowPlaying = true
        }

        restoration.emulateSavedInstanceStateRestore()

        compose.runOnIdle {
            assertEquals(Tab.Library, navigator.tab)
            assertEquals(listOf(LibraryRoute, SettingsRoute), navigator.stack.toList())
            assertTrue(navigator.nowPlaying)
            navigator.back()
            assertFalse(navigator.nowPlaying)
            navigator.select(Tab.Queue)
            assertEquals(listOf(QueueRoute), navigator.stack.toList())
            navigator.select(Tab.Library)
            assertEquals(SettingsRoute, navigator.stack.last())
            navigator.back()
            assertEquals(LibraryRoute, navigator.stack.last())
            navigator.back()
            assertEquals(Tab.Discover, navigator.tab)
            assertEquals(SearchRoute, navigator.stack.last())
            navigator.select(Tab.Discover)
            assertEquals(listOf(DiscoverRoute), navigator.stack.toList())
            assertFalse(navigator.back())
        }

        restoration.emulateSavedInstanceStateRestore()

        compose.runOnIdle {
            assertEquals(Tab.Discover, navigator.tab)
            assertEquals(listOf(DiscoverRoute), navigator.stack.toList())
            assertFalse(navigator.nowPlaying)
        }
    }
}
