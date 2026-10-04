package app.podcst.network

import app.podcst.model.EpisodePage
import app.podcst.model.EpisodeSort
import app.podcst.model.ImportResult
import app.podcst.model.PlaybackProgress
import app.podcst.model.Podcast
import app.podcst.model.SortDirection
import app.podcst.model.User
import java.io.IOException
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.cancellation.CancellationException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.serializer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

interface SessionCookieStore {
    fun read(): String?
    fun write(value: String)
    fun clear()
}

class ApiException(val status: Int, message: String) : IOException(message)

sealed interface PasskeyChallenge {
    data class Ready(val requestJson: String, val userId: String?) : PasskeyChallenge
    data object NoAccount : PasskeyChallenge
    data object NoPasskey : PasskeyChallenge
}

class PodcstApi(
    private val client: OkHttpClient,
    private val cookies: SessionCookieStore,
    private val baseUrl: HttpUrl = PRODUCTION,
) {
    private val revision = AtomicLong()
    private val visitorId = UUID.randomUUID().toString()

    val hasSession: Boolean get() = !cookies.read().isNullOrEmpty()

    suspend fun top(locale: String, limit: Int): List<Podcast> =
        get<List<WirePodcast>>("api/top", "limit" to "$limit", "locale" to locale, session = false).map { it.domain() }

    suspend fun search(term: String, locale: String): List<Podcast> =
        post<List<WirePodcast>>("api/search", body { put("term", term); put("locale", locale) })
            .map { it.domain(locale = locale) }

    suspend fun podcast(feed: String): Podcast =
        if (hasSession) post<WirePodcast>("api/feed", body { put("url", feed) }).domain(feed)
        else get<WirePodcast>("api/feed", "url" to feed).domain(feed)

    suspend fun podcast(id: Long): Podcast = get<WirePodcast>("api/feed", "id" to "$id").domain()

    suspend fun podcastInfo(id: Long): Podcast = get<WirePodcast>("api/feed/info", "id" to "$id").domain()

    suspend fun episodes(
        podcastId: Long,
        cursor: Int? = null,
        search: String? = null,
        sort: EpisodeSort = EpisodeSort.Published,
        direction: SortDirection = SortDirection.Descending,
        limit: Int = 20,
    ): EpisodePage = get<WireEpisodePage>(
        "api/feed/episodes",
        "podcastId" to "$podcastId",
        "limit" to "$limit",
        "sortBy" to sort.field,
        "sortDir" to direction.value,
        "cursor" to cursor?.toString(),
        "search" to search?.takeIf { it.isNotEmpty() },
    ).domain(podcastId)

    suspend fun resolve(itunesId: Long, locale: String): Long =
        post<WireIdentity>("api/feed/resolve", body { put("itunes_id", itunesId); put("locale", locale) }).id

    suspend fun refresh(podcastId: Long): Podcast =
        post<WirePodcast>("api/feed/refresh", body { put("podcastId", podcastId) }).domain()

    suspend fun sessionUser(): User? = get<WireSession>("api/auth/session").user?.domain()

    suspend fun sendCode(email: String) {
        post<WireSent>("api/auth/verify", body { put("email", email) })
    }

    suspend fun signIn(email: String, code: String): User? {
        beginAuthentication()
        post<WireVerified>("api/auth/email-login", body { put("email", email); put("code", code) })
        return sessionUser()
    }

    suspend fun passkeyChallenge(email: String?): PasskeyChallenge {
        beginAuthentication()
        val start = post<WirePasskeyStart>("api/auth/login", body {
            email?.let { put("email", it) }
            put("visitorId", visitorId)
            put("discoverable", email == null)
        })
        return when {
            start.options != null -> PasskeyChallenge.Ready(start.options.toString(), start.userId)
            start.exists == false -> PasskeyChallenge.NoAccount
            else -> PasskeyChallenge.NoPasskey
        }
    }

    suspend fun signInWithPasskey(responseJson: String, userId: String?): User? {
        val result = post<WireVerified>("api/auth/login", body {
            put("response", Json.parseToJsonElement(responseJson))
            userId?.let { put("userId", it) }
            put("visitorId", visitorId)
        })
        if (!result.verified) throw ApiException(400, "Passkey verification failed")
        return sessionUser()
    }

    suspend fun passkeyRegistration(): String =
        post<WirePasskeyStart>("api/auth/register", body { put("visitorId", visitorId) }).options?.toString()
            ?: throw ApiException(400, "Passkey registration is unavailable")

    suspend fun registerPasskey(responseJson: String) {
        val result = post<WireVerified>("api/auth/register", body {
            put("response", Json.parseToJsonElement(responseJson))
            put("visitorId", visitorId)
        })
        if (!result.verified) throw ApiException(400, "Passkey registration failed")
    }

    suspend fun signOut() {
        val cookie = cookies.read()
        clearSession()
        val request = Request.Builder().url(baseUrl.resolve("api/auth/logout")!!)
            .post(ByteArray(0).toRequestBody())
            .apply { cookie?.let { header("Cookie", "session=$it") } }
            .build()
        runCatching { client.newCall(request).await().close() }
    }

    fun beginAuthentication() {
        revision.incrementAndGet()
    }

    fun clearSession() {
        revision.incrementAndGet()
        cookies.clear()
    }

    suspend fun subscriptions(): List<Podcast> = get<List<WirePodcast>>("api/subscriptions").map { it.domain() }

    suspend fun subscribe(podcastId: Long) {
        post<WireSuccess>("api/subscriptions", body { put("podcastId", podcastId) })
    }

    suspend fun unsubscribe(podcastId: Long) {
        send<WireSuccess>("DELETE", url("api/subscriptions", "podcastId" to "$podcastId"), null)
    }

    suspend fun importSubscriptions(feeds: List<String>): ImportResult =
        post<ImportResult>("api/subscriptions", body { putJsonArray("feedUrls") { feeds.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } } })

    suspend fun currentProgress(): PlaybackProgress? =
        get<WireProgress?>("api/progress")?.let { PlaybackProgress(it.episode.domain(), it.position) }

    suspend fun saveProgress(episodeId: Long, position: Double, completed: Boolean) {
        send<WireSuccess>("PUT", url("api/progress"), body {
            put("episodeId", episodeId)
            put("position", position.toLong())
            put("completed", completed)
        })
    }

    private suspend inline fun <reified T> get(path: String, vararg query: Pair<String, String?>, session: Boolean = true): T =
        send("GET", url(path, *query), null, session)

    private suspend inline fun <reified T> post(path: String, body: JsonElement): T = send("POST", url(path), body)

    private suspend inline fun <reified T> send(method: String, url: HttpUrl, body: JsonElement?, session: Boolean = true): T =
        request(method, url, body, session, json.serializersModule.serializer<T>())

    private suspend fun <T> request(
        method: String,
        url: HttpUrl,
        body: JsonElement?,
        session: Boolean,
        strategy: DeserializationStrategy<T>,
    ): T {
        val token = revision.get()
        val request = Request.Builder().url(url)
            .header("Accept", "application/json")
            .method(method, body?.toString()?.toRequestBody(JSON))
            .apply { if (session) cookies.read()?.let { header("Cookie", "session=$it") } }
            .build()
        return client.newCall(request).await().use { response ->
            if (session && revision.get() != token) throw CancellationException("Session changed")
            if (session) persistCookie(response)
            val text = response.body.string()
            if (!response.isSuccessful) throw ApiException(response.code, errorMessage(text) ?: response.message.ifEmpty { "HTTP ${response.code}" })
            try {
                json.decodeFromString(strategy, text.ifEmpty { "{}" })
            } catch (failure: IllegalArgumentException) {
                throw ApiException(response.code, "Invalid API response")
            }
        }
    }

    private fun persistCookie(response: Response) {
        response.headers("Set-Cookie").firstNotNullOfOrNull { header ->
            header.substringBefore(';').takeIf { it.startsWith("session=") }?.removePrefix("session=")
        }?.let(cookies::write)
    }

    private fun errorMessage(text: String) = runCatching { json.decodeFromString<WireError>(text) }.getOrNull()?.message

    private fun url(path: String, vararg query: Pair<String, String?>): HttpUrl =
        baseUrl.resolve(path)!!.newBuilder().apply {
            query.forEach { (name, value) -> value?.let { addQueryParameter(name, it) } }
        }.build()

    private fun body(build: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit): JsonElement = buildJsonObject(build)

    companion object {
        val PRODUCTION = "https://www.podcst.app/".toHttpUrl()
        private val JSON = "application/json".toMediaType()
        internal val json = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
            coerceInputValues = true
        }
    }
}

suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onResponse(call: Call, response: Response) = continuation.resume(response) { _, value, _ -> value.close() }
        override fun onFailure(call: Call, e: IOException) = continuation.resumeWithException(e)
    })
}
