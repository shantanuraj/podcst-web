package app.podcst.network

import app.podcst.model.*
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
    private val GENERATION = "17adbd84-d0e4-4e2d-ad9f-b084efee3211"
    private val CLIENT = "a7a2e014-b64f-4487-9c92-71cd59fc0cf7"
    private val fixtures = File(checkNotNull(System.getProperty("podcst.contracts")), "fixtures/api")
    private val client = OkHttpClient()
    private lateinit var api: PodcstApi

    @Test
    fun passkeyFlowsAreForwardedAndAccountChangesCancelSubmission() = runTest {
        val server = MockWebServer().apply { start() }
        try {
            val api = PodcstApi(client, MemoryCookies().apply { write("token") }, server.url("/"))
            server.enqueue(MockResponse.Builder().code(200).body(File(fixtures, "auth-register.options.json").readText()).build())
            val challenge = api.passkeyRegistration()
            assertTrue(challenge.flowId.isNotBlank())
            server.enqueue(MockResponse.Builder().code(200).body("""{"verified":true}""").build())
            api.registerPasskey("{}", challenge)
            server.takeRequest()
            val verified = server.takeRequest()
            assertEquals("native", verified.headers["X-Podcst-Client"])
            val payload = Json.parseToJsonElement(verified.body!!.utf8()).jsonObject
            assertEquals(challenge.flowId, payload.getValue("flowId").jsonPrimitive.content)
            assertTrue("visitorId" !in payload)
            api.clearSession()
            val failure = runCatching { api.registerPasskey("{}", challenge) }.exceptionOrNull()
            assertTrue(failure is kotlinx.coroutines.CancellationException)
            assertEquals(2, server.requestCount)
        } finally { server.close() }
    }

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
        if (endpoint == "DELETE /api/subscriptions") {
            assertEquals("Replace obsolete success fixture with update-required", 426, status)
            assertEquals("update_required", PodcstApi.json.decodeFromString<StateErrorBody>(body).code)
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
        assertEquals(name, "native", request.headers["X-Podcst-Client"])
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
            "POST /api/auth/login" -> if (type == "PasskeyLoginResult") api.signInWithPasskey("{}", PasskeyChallenge("{}", "fixture-flow", 0)) else api.passkeyChallenge()
            "POST /api/auth/register" -> if (type == "PasskeyRegistrationResult") api.registerPasskey("{}", PasskeyChallenge("{}", "fixture-flow", 0)) else api.passkeyRegistration()
            "POST /api/auth/logout" -> api.signOut()
            "GET /api/subscriptions" -> if (body.trimStart().startsWith("{" ) && body.contains("\"protocol\"")) api.followState() else api.subscriptions().forEach { assertTrue(it.id != null) }
            "POST /api/subscriptions" -> api.changeFollows(StateBatch(1, "fixture-account-a", GENERATION, CLIENT, StateID("1"), listOf(StateFollowChange(StateID("1"), true))))
            "POST /api/subscriptions/resolve" -> api.resolveSubscriptions("fixture-account-a", GENERATION, listOf("https://example.test/feed.xml"))
            "GET /api/progress" -> if (body.contains("\"protocol\"")) api.progressState() else api.currentProgress()
            "PUT /api/progress" -> api.changeProgress(StateBatch(1, "fixture-account-a", GENERATION, CLIENT, StateID("1"), listOf(StateProgressChange(StateID("1"), 12, false))))
            "GET /api/lists" -> assertEquals("9007199254740993", api.lists().lists.first().revision)
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
            "POST /api/lists/:id/changes", "POST /api/lists/:id/migration" -> {
                val result = api.changeList(":id", ListBatch("a7a2e014-b64f-4487-9c92-71cd59fc0cf7", "9007199254740993", listOf(ListChange(ListChange.Operation.Add, 910001), ListChange(ListChange.Operation.Remove, 910002), ListChange(ListChange.Operation.Add, 910003))), "fixture-account-a", GENERATION, endpoint.endsWith("/migration"))
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
