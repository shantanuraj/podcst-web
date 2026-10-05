package app.podcst.data

import app.podcst.model.AudioEffects
import app.podcst.model.AudioOptions
import app.podcst.model.AudioSettings
import app.podcst.network.testing.Call
import app.podcst.network.testing.FakeServer
import app.podcst.network.testing.Reply
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.plus
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
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
class AccountRepositoryTest {
    private val application = RuntimeEnvironment.getApplication()
    private val preferences = Preferences(application)
    private val override = mapOf("feed" to AudioOptions(speed = 2.0))

    @Before
    fun setUp() = runTest {
        preferences.updateAudio { AudioSettings(AudioOptions(speed = 0.75), override) }
    }

    private suspend fun TestScope.signedIn(account: String, route: (Call) -> Reply = { Reply() }): Pair<AccountRepository, FakeServer> {
        val server = FakeServer { call ->
            when (call.path) {
                "/api/auth/session" -> Reply(FakeServer.USER)
                "/api/account" -> Reply(account)
                else -> route(call)
            }
        }
        val session = SessionRepository(application, server.api)
        val repository = AccountRepository(server.api, session, preferences)
        repository.start(backgroundScope + UnconfinedTestDispatcher(testScheduler))
        session.restore()
        return repository to server
    }

    @Test
    fun serverDefaultsReplaceLocalDefaultsAndKeepOverrides() = runTest {
        val (repository, _) = signedIn(ACCOUNT.replace("PREFERENCES", """{"speed":1.25,"volumeBoost":false,"trimSilence":true}"""))
        val expected = AudioOptions(1.25, AudioEffects(trimSilence = true))
        assertEquals(expected, preferences.audio.first { it.defaults == expected }.defaults)
        assertEquals(override, preferences.audioSettings().overrides)
        val account = repository.account.first { it != null }!!
        assertEquals(listOf("iCloud Keychain", null), account.passkeys.map { it.provider })
    }

    @Test
    fun unsavedServerDefaultsReceiveTheLocalDefaults() = runTest {
        val (_, server) = signedIn(ACCOUNT.replace("PREFERENCES", "null")) { Reply("""{"speed":0.75,"volumeBoost":false,"trimSilence":false}""") }
        val saved = server.awaitCall { it.path == "/api/account/preferences" }
        assertEquals(Json.parseToJsonElement("""{"speed":0.75,"volumeBoost":false,"trimSilence":false}"""), Json.parseToJsonElement(saved.body))
    }

    @Test
    fun defaultChangesAfterLoadAreUploaded() = runTest {
        val (repository, server) = signedIn(ACCOUNT.replace("PREFERENCES", """{"speed":0.75,"volumeBoost":false,"trimSilence":false}""")) {
            Reply("""{"speed":1.5,"volumeBoost":true,"trimSilence":false}""")
        }
        repository.account.first { it != null }
        preferences.updateAudio { it.with(AudioOptions(1.5, AudioEffects(volumeBoost = true))) }
        val saved = server.awaitCall { it.path == "/api/account/preferences" }
        val body = Json.parseToJsonElement(saved.body) as JsonObject
        assertEquals("1.5", body["speed"].toString())
        assertEquals("true", body["volumeBoost"].toString())
        assertTrue(server.calls.none { it.path == "/api/account/preferences" && it != saved })
    }

    @Test
    fun removingAPasskeyDropsItFromTheAccount() = runTest {
        val (repository, server) = signedIn(ACCOUNT.replace("PREFERENCES", "null")) { Reply("""{"success":true}""") }
        repository.account.first { it != null }
        repository.removePasskey("pk-legacy")
        server.awaitCall { it.path == "/api/account/passkeys/pk-legacy" }
        assertEquals(listOf("pk-mac"), repository.account.first { it?.passkeys?.size == 1 }!!.passkeys.map { it.id })
    }

    private companion object {
        const val ACCOUNT = """{"createdAt":"2024-03-02T10:00:00.000Z","passkeys":[
            {"id":"pk-mac","provider":"iCloud Keychain","createdAt":"2024-03-02T10:05:00.000Z","lastUsedAt":"2026-10-05T08:00:00.000Z"},
            {"id":"pk-legacy","provider":null,"createdAt":"2025-06-10T12:00:00.000Z","lastUsedAt":null}],
            "preferences":PREFERENCES}"""
    }
}
