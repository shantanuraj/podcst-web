package app.podcst.network

import app.podcst.model.AudioEffects
import app.podcst.model.AudioOptions
import app.podcst.model.ListAvailability
import app.podcst.model.ListBatch
import app.podcst.model.ListChange
import app.podcst.model.ListChangeResult

import java.io.File
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.int
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ApiContractTest {
    private val fixtures = File(checkNotNull(System.getProperty("podcst.contracts")), "fixtures/api")
    private val client = OkHttpClient()
    private lateinit var api: PodcstApi

    @Test
    fun everyFixtureDecodesThroughTheClient() = runTest {
        val index = Json.parseToJsonElement(File(fixtures, "index.json").readText()).jsonObject
        val listed = index.keys
        val present = fixtures.listFiles().orEmpty().map { it.name }.filter { it != "index.json" }.toSet()
        assertEquals(present, listed)
        index.forEach { (name, entry) -> check(name, entry.jsonObject) }
    }

    private suspend fun check(name: String, entry: JsonObject) {
        val endpoint = entry.getValue("endpoint").jsonPrimitive.content
        val status = entry.getValue("status").jsonPrimitive.int
        val type = entry.getValue("decodesAs").jsonPrimitive.content
        val body = File(fixtures, name).readText()
        if (type == "RefreshStatus") {
            assertTrue(name, PodcstApi.json.decodeFromString<WireRefreshStatus>(body).status.isNotEmpty())
            return
        }
        val server = MockWebServer().apply { start() }
        api = PodcstApi(client, MemoryCookies().apply { write("token") }, server.url("/"))
        server.enqueue(MockResponse.Builder().code(status).body(body).addHeader("Content-Type", "application/json").build())
        server.enqueue(MockResponse.Builder().code(200).body(File(fixtures, "auth-session.user.json").readText()).build())
        val failure = runCatching { call(endpoint, type, body) }.exceptionOrNull()
        val request = server.takeRequest()
        val (method, path) = endpoint.split(' ')
        assertEquals(name, method, request.method)
        assertEquals(name, path, request.url.encodedPath)
        if (status in 200..299) {
            if (failure != null) throw AssertionError(name, failure)
        } else {
            assertTrue("$name should fail", failure is ApiException)
            val message = Json.parseToJsonElement(body).jsonObject["message"]?.jsonPrimitive?.content
            assertEquals(name, status, (failure as ApiException).status)
            assertEquals(name, message, failure.message)
        }
        server.close()
    }

    private suspend fun call(endpoint: String, type: String, body: String) {
        when (endpoint) {
            "GET /api/top" -> api.top("us", 30).forEach { assertTrue(it.feed.isNotEmpty()) }
            "POST /api/search" -> api.search("term", "us").forEach { assertTrue(it.feed.isNotEmpty()) }
            "GET /api/feed" -> api.podcast(1).episodes.forEach { assertTrue(it.guid.isNotEmpty()) }
            "POST /api/feed" -> api.podcast("https://example.com/feed.xml")
            "GET /api/feed/info" -> api.podcastInfo(1)
            "GET /api/feed/episodes" -> api.episodes(1).episodes.forEach { assertTrue(it.guid.isNotEmpty() && it.podcastId != null) }
            "POST /api/feed/resolve" -> assertTrue(api.resolve(1, "us") > 0)
            "POST /api/feed/refresh" -> api.refresh(1)
            "GET /api/auth/session" -> api.sessionUser()
            "POST /api/auth/verify" -> api.sendCode("someone@example.com")
            "POST /api/auth/email-login" -> api.signIn("someone@example.com", "123456")
            "POST /api/auth/login" -> if (type == "PasskeyLoginResult") api.signInWithPasskey("{}", null) else api.passkeyChallenge(null)
            "POST /api/auth/register" -> if (type == "PasskeyRegistrationResult") api.registerPasskey("{}") else api.passkeyRegistration()
            "POST /api/auth/logout" -> api.signOut()
            "GET /api/subscriptions" -> api.subscriptions().forEach { assertTrue(it.id != null) }
            "POST /api/subscriptions" -> if (type == "ImportResult") api.importSubscriptions(listOf("https://example.com/feed.xml")) else api.subscribe(1)
            "DELETE /api/subscriptions" -> api.unsubscribe(1)
            "GET /api/progress" -> api.currentProgress()
            "PUT /api/progress" -> api.saveProgress(1, 12.5, false)
            "GET /api/lists" -> assertEquals("9007199254740993", api.lists().first().revision)
            "GET /api/lists/:id/items" -> if (type == "ListSnapshot") {
                val snapshot = api.listMembership(":id")
                assertEquals("9007199254740993", snapshot.revision)
                assertEquals(listOf(ListAvailability.Available, ListAvailability.ContentMissing, ListAvailability.Unavailable), snapshot.items.map { it.availability })
            } else {
                val page = api.listEpisodes(":id")
                assertEquals(910001L, page.items.first().episode?.id)
                assertEquals(null, page.items.last().episode)
                assertEquals(null, page.nextCursor)
            }
            "POST /api/lists/:id/changes" -> {
                val result = api.changeList(":id", ListBatch("a7a2e014-b64f-4487-9c92-71cd59fc0cf7", "9007199254740993", listOf(ListChange(ListChange.Operation.Add, 910001), ListChange(ListChange.Operation.Remove, 910002), ListChange(ListChange.Operation.Add, 910003))))
                assertEquals("9007199254740993", result.sequence)
                assertEquals(listOf(ListChangeResult.Status.Applied, ListChangeResult.Status.Unchanged, ListChangeResult.Status.NotFound), result.results.map { it.status })
            }
            "GET /api/account" -> api.account().passkeys.forEach { assertTrue(it.id.isNotEmpty()) }
            "PUT /api/account/preferences" -> api.savePreferences(AudioOptions(1.5, AudioEffects(volumeBoost = true)))
            "DELETE /api/account/passkeys/:id" -> api.removePasskey(":id")
            else -> fail("Unmapped endpoint $endpoint")
        }
    }
}

class MemoryCookies : SessionCookieStore {
    private var value: String? = null
    override fun read() = value
    override fun write(value: String) { this.value = value }
    override fun clear() { value = null }
}
