package app.podcst.feature.auth

import app.podcst.network.testing.Call
import app.podcst.network.testing.FakeServer
import app.podcst.network.testing.Reply

import app.podcst.data.CatalogRepository
import app.podcst.data.Preferences
import app.podcst.data.Scopes
import app.podcst.data.SessionRepository
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
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class OnboardingViewModelTest {
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

    private fun TestScope.viewModel(route: (Call) -> Reply): Pair<OnboardingViewModel, FakeServer> {
        val server = FakeServer(route)
        val model = OnboardingViewModel(CatalogRepository(server.api, scopes), preferences, SessionRepository(application, server.api))
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.state.collect {} }
        return model to server
    }

    @Test
    fun choosingRegionRefreshesItsChart() = runTest {
        val (model, server) = viewModel { Reply("[]") }
        model.setRegion(Region.NL)
        model.state.first { it.region == Region.NL }

        server.awaitCall { it.path == "/api/top" && it.query.orEmpty().contains("locale=nl") }
    }

    @Test
    fun passkeySignInFinishesOnboarding() = runTest {
        val (model, _) = viewModel { call ->
            when {
                call.path == "/api/auth/login" && call.body.contains("\"response\"") -> Reply("""{"verified":true}""", cookie = "token")
                call.path == "/api/auth/login" -> Reply("""{"options":{"challenge":"c"}}""")
                call.path == "/api/auth/session" -> Reply(FakeServer.USER)
                else -> Reply("[]")
            }
        }
        model.signIn { """{"id":"credential"}""" }

        assertEquals(true, preferences.onboarded.first { it })
    }

    @Test
    fun mosaicFillsWholeRowsOrPlaceholders() {
        assertEquals(List(12) { null }, mosaic(listOf("a", "b", "c")))
        assertEquals(listOf("a", "b", "c", "d"), mosaic(listOf("a", "b", "c", "d", "e")))
        assertEquals(12, mosaic(List(30) { "$it" }).size)
    }
}
