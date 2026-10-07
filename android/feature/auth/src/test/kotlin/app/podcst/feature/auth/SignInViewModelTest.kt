package app.podcst.feature.auth

import app.podcst.network.testing.Call
import app.podcst.network.testing.FakeServer
import app.podcst.network.testing.Reply

import app.podcst.data.SessionRepository
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
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
class SignInViewModelTest {
    @Before
    fun setUp() = Dispatchers.setMain(StandardTestDispatcher())

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun TestScope.viewModel(route: (Call) -> Reply): Pair<SignInViewModel, FakeServer> {
        val server = FakeServer(route)
        val model = SignInViewModel(SessionRepository(RuntimeEnvironment.getApplication(), server.api))
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.state.collect {} }
        return model to server
    }

    @Test
    fun submitRequiresTrimmedEmailThenCode() = runTest {
        val (model, server) = viewModel { Reply("""{"sent":true}""") }
        model.setEmail("   ")
        runCurrent()
        assertFalse(model.state.value.canSubmit)
        model.submit()
        runCurrent()
        assertTrue(server.calls.isEmpty())

        model.setEmail("  you@podcst.app ")
        runCurrent()
        assertTrue(model.state.value.canSubmit)
        model.submit()
        val sent = model.state.first { it.codeSent && !it.working }

        assertEquals("/api/auth/verify", server.calls.single().path)
        assertTrue(server.calls.single().body.contains("\"you@podcst.app\""))
        assertFalse(sent.canSubmit)
        model.setCode("12a34567")
        runCurrent()
        assertEquals("123456", model.state.value.code)
        assertTrue(model.state.value.canSubmit)
    }

    @Test
    fun failedSendStaysOnEmailWithError() = runTest {
        val (model, _) = viewModel { Reply("""{"message":"Invalid email"}""", code = 400) }
        model.setEmail("nobody")
        model.submit()
        val state = model.state.first { it.error != null }

        assertEquals("Invalid email", state.error)
        assertFalse(state.codeSent)
        assertFalse(state.signedIn)
    }

    @Test
    fun codeSignsIn() = runTest {
        val (model, server) = viewModel { call ->
            when (call.path) {
                "/api/auth/verify" -> Reply("""{"sent":true}""")
                "/api/auth/email-login" -> Reply("""{"verified":true,"userId":"u1"}""", cookie = "token")
                else -> Reply(FakeServer.USER)
            }
        }
        model.setEmail("you@podcst.app")
        model.submit()
        model.state.first { it.codeSent && !it.working }
        model.setCode("482913")
        model.submit()
        val state = model.state.first { it.signedIn && !it.working }

        assertFalse(state.working)
        assertNull(state.error)
        assertTrue(server.calls.any { it.path == "/api/auth/email-login" && it.body.contains("482913") })
    }

    @Test
    fun passkeySignsInWithResponse() = runTest {
        val (model, server) = viewModel { call ->
            when {
                call.path == "/api/auth/login" && call.body.contains("\"response\"") -> Reply("""{"verified":true}""", cookie = "token")
                call.path == "/api/auth/login" -> Reply("""{"options":{"challenge":"c"},"flowId":"flow"}""")
                else -> Reply(FakeServer.USER)
            }
        }
        model.passkey { request ->
            assertTrue(request.contains("\"challenge\""))
            """{"id":"credential"}"""
        }
        val state = model.state.first { it.signedIn && !it.working }

        assertNull(state.error)
        assertTrue(server.calls.any { it.body.contains("\"credential\"") && it.body.contains("\"discoverable\"").not() })
    }

    @Test
    fun cancelledPasskeyIsQuiet() = runTest {
        val (model, _) = viewModel { Reply("""{"options":{"challenge":"c"},"flowId":"flow"}""") }
        model.passkey { throw CancellationException("cancelled") }
        runCurrent()
        val state = model.state.first { !it.working }

        assertNull(state.error)
        assertFalse(state.signedIn)
    }
}
