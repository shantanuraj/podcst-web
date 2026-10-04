package app.podcst.feature.settings

import app.podcst.network.testing.Call
import app.podcst.network.testing.FakeServer
import app.podcst.network.testing.Reply

import app.cash.turbine.test
import app.podcst.data.Appearance
import app.podcst.data.CatalogRepository
import app.podcst.data.LibraryRepository
import app.podcst.data.Preferences
import app.podcst.data.Scopes
import app.podcst.data.SessionRepository
import app.podcst.model.AudioEffects
import app.podcst.model.AudioOptions
import app.podcst.model.AudioSettings
import app.podcst.model.ImportResult
import app.podcst.model.Region
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SettingsViewModelTest {
    private val application = RuntimeEnvironment.getApplication()
    private val scopes = Scopes(application, null)
    private val preferences = Preferences(application)

    @Before
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun tearDown() {
        scopes.database.close()
        Dispatchers.resetMain()
    }

    private fun TestScope.viewModel(route: (Call) -> Reply): Triple<SettingsViewModel, SessionRepository, FakeServer> {
        val server = FakeServer(route)
        val session = SessionRepository(application, server.api)
        val model = SettingsViewModel(session, preferences, LibraryRepository(server.api, scopes, CatalogRepository(server.api, scopes)))
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.state.collect {} }
        return Triple(model, session, server)
    }

    @Test
    fun preferencesFlowIntoState() = runTest {
        preferences.updateAudio { AudioSettings(overrides = mapOf("feed" to AudioOptions(speed = 2.0))) }
        val (model, _, _) = viewModel { Reply() }
        model.setAppearance(Appearance.Dark)
        model.setRegion(Region.SE)
        model.setSpeed(1.5)
        model.setVolumeBoost(true)
        model.setTrimSilence(true)

        val expected = AudioOptions(speed = 1.5, effects = AudioEffects(volumeBoost = true, trimSilence = true))
        val state = model.state.first { it.appearance == Appearance.Dark && it.region == Region.SE && it.audio == expected }
        assertFalse(state.subscribed)
        assertNull(state.user)
        assertEquals(mapOf("feed" to AudioOptions(speed = 2.0)), preferences.audio.first().overrides)
    }

    @Test
    fun importReportsFailedFeeds() = runTest {
        val (model, _, server) = viewModel { Reply("""{"error":"Feed unavailable"}""", code = 502) }
        val opml = """<opml><body><outline xmlUrl="https://a.example/rss"/><outline xmlUrl='https://b.example/rss?x=1&amp;y=2'/></body></opml>"""
        model.events.test {
            model.import(opml)
            assertEquals(SettingsEvent.Imported(ImportResult(0, 2)), awaitItem())
        }
        assertTrue(server.calls.any { it.query.orEmpty().contains("y=2") })
        assertFalse(model.state.value.importing)
    }

    @Test
    fun passkeyFailureIsReported() = runTest {
        val (model, _, _) = viewModel { Reply("""{"error":"Sign in first"}""", code = 401) }
        model.events.test {
            model.addPasskey { error("unreachable") }
            assertEquals(SettingsEvent.Failed("Sign in first"), awaitItem())
        }
    }

    @Test
    fun signOutClearsUserAndLeaves() = runTest {
        val (model, session, _) = viewModel { call ->
            when (call.path) {
                "/api/auth/email-login" -> Reply("""{"verified":true}""", cookie = "token")
                "/api/auth/session" -> Reply("""{"user":{"id":"u1","email":"you@podcst.app"}}""")
                else -> Reply("[]")
            }
        }
        assertTrue(session.signIn("you@podcst.app", "123456"))
        model.state.first { it.user?.email == "you@podcst.app" }

        model.events.test {
            model.signOut()
            assertEquals(SettingsEvent.SignedOut, awaitItem())
        }
        assertNull(model.state.first { it.user == null }.user)
    }
}
