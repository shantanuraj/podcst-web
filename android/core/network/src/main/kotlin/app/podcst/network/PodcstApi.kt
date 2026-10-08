package app.podcst.network

import app.podcst.model.*
import app.podcst.model.AccountEpisodeList
import app.podcst.model.ListAcknowledgement
import app.podcst.model.ListBatch
import app.podcst.model.ListEpisodePage
import app.podcst.model.ListSnapshot
import app.podcst.model.AudioOptions
import app.podcst.model.EpisodePage
import app.podcst.model.EpisodeSort
import app.podcst.model.ImportResult
import app.podcst.model.PlaybackProgress
import app.podcst.model.SavedEpisodeProgress
import app.podcst.model.Podcast
import app.podcst.model.SortDirection
import app.podcst.model.User
import java.io.IOException
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

class ApiException(val status: Int, message: String, val code: String? = null, val retryAfterSeconds: Long? = null) : IOException(message)

data class PasskeyChallenge(val requestJson: String, val flowId: String, internal val revision: Long)

class PodcstApi(
    private val client: OkHttpClient,
    private val cookies: SessionCookieStore,
    private val baseUrl: HttpUrl = PRODUCTION,
) {
    private val revision = AtomicLong()

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

    suspend fun publicEpisode(episodeId: Long, podcastId: Long): Episode =
        get<WirePublicEpisode>("api/episodes/$episodeId", "podcastId" to "$podcastId", session = false).let { found ->
            found.episode.domain(found.podcast.id, found.podcast.feed, found.podcast.cover, found.podcast.title)
        }

    suspend fun resolve(itunesId: Long, locale: String): Long =
        post<WireIdentity>("api/feed/resolve", body { put("itunes_id", itunesId.toString()); put("locale", locale) }).id

    suspend fun refresh(podcastId: Long): Podcast =
        post<WirePodcast>("api/feed/refresh", body { put("podcastId", podcastId.toString()) }).domain()

    suspend fun sessionUser(): User? = get<WireSession>("api/auth/session").user?.domain()

    suspend fun sendCode(email: String) {
        post<WireSent>("api/auth/verify", body { put("email", email) })
    }

    suspend fun signIn(email: String, code: String): User? {
        beginAuthentication()
        post<WireVerified>("api/auth/email-login", body { put("email", email); put("code", code) })
        return sessionUser()
    }

    suspend fun passkeyChallenge(): PasskeyChallenge {
        beginAuthentication()
        val expected = revision.get()
        val start = post<WirePasskeyStart>("api/auth/login", body { put("discoverable", true) })
        return PasskeyChallenge(start.options.toString(), start.flowId, expected)
    }

    suspend fun signInWithPasskey(responseJson: String, challenge: PasskeyChallenge): User? {
        checkPasskeyScope(challenge)
        val result = post<WireVerified>("api/auth/login", body {
            put("response", Json.parseToJsonElement(responseJson))
            put("flowId", challenge.flowId)
        })
        if (!result.verified) throw ApiException(400, "Passkey verification failed")
        return sessionUser()
    }

    suspend fun passkeyRegistration(): PasskeyChallenge {
        val expected = revision.get()
        val start = post<WirePasskeyStart>("api/auth/register", body {})
        return PasskeyChallenge(start.options.toString(), start.flowId, expected)
    }

    suspend fun registerPasskey(responseJson: String, challenge: PasskeyChallenge) {
        checkPasskeyScope(challenge)
        val result = post<WireVerified>("api/auth/register", body {
            put("response", Json.parseToJsonElement(responseJson))
            put("flowId", challenge.flowId)
        })
        if (!result.verified) throw ApiException(400, "Passkey registration failed")
    }

    private fun checkPasskeyScope(challenge: PasskeyChallenge) {
        if (revision.get() != challenge.revision) throw kotlinx.coroutines.CancellationException("Account changed")
    }

    suspend fun signOut() {
        val cookie = cookies.read()
        clearSession()
        val request = Request.Builder().url(baseUrl.resolve("api/auth/logout")!!)
            .header("X-Podcst-Client", "native")
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

    suspend fun followState(): StateSnapshot<StateFollowItem> = get("api/subscriptions", "view" to "membership")

    suspend fun changeFollows(batch: StateBatch<StateFollowChange>): StateAcknowledgement<StateFollowResult> =
        post("api/subscriptions", json.encodeToJsonElement(StateBatch.serializer(StateFollowChange.serializer()), batch))

    suspend fun resolveSubscriptions(accountId: String, generation: String, feeds: List<String>): FollowResolution =
        post("api/subscriptions/resolve", body {
            put("protocol", 1); put("accountId", accountId); put("generation", generation)
            putJsonArray("feedUrls") { feeds.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } }
        })

    suspend fun progressState(ids: List<Long>? = null): StateSnapshot<StateProgressItem> =
        if (ids == null) get("api/progress", "view" to "state", "recent" to "1")
        else { require(ids.size in 1..200 && ids.distinct().size == ids.size)
            get("api/progress", "view" to "state", "episodeIds" to ids.joinToString(",")) }

    suspend fun changeProgress(batch: StateBatch<StateProgressChange>): StateAcknowledgement<StateProgressResult> =
        send("PUT", url("api/progress"), json.encodeToJsonElement(StateBatch.serializer(StateProgressChange.serializer()), batch))

    suspend fun currentProgress(): PlaybackProgress? =
        get<WireProgress?>("api/progress")?.let { PlaybackProgress(it.episode.domain(), it.position) }

    suspend fun episodeProgress(episodeIds: List<Long>): List<SavedEpisodeProgress> {
        val token = revision.get()
        return episodeIds.distinct().sorted().chunked(200).flatMap { batch ->
            if (revision.get() != token) throw CancellationException("Session changed")
            get<List<WireSavedProgress>>("api/progress", "episodeIds" to batch.joinToString(",")).map { SavedEpisodeProgress(it.episodeId, it.position, it.completed) }
        }
    }

    suspend fun lists(): AccountLists = get("api/lists")

    suspend fun listMembership(id: String): ListSnapshot = get<WireListSnapshot>("api/lists/$id/items", "view" to "membership").let {
        ListSnapshot(it.listId, it.revision.value, it.items.map { row -> ListMembership(row.episodeId, row.addedAt, row.availability) }, it.protocol, it.accountId, it.generation)
    }

    suspend fun listEpisodes(id: String, cursor: String? = null): ListEpisodePage =
        get<WireListEpisodePage>("api/lists/$id/items", "view" to "episodes", "cursor" to cursor).domain()

    suspend fun changeList(id: String, batch: ListBatch, accountId: String, generation: String, legacy: Boolean): ListAcknowledgement {
        val payload = if (legacy) body {
            put("protocol", 1); put("accountId", accountId); put("generation", generation)
            put("batch", json.encodeToJsonElement(ListBatch.serializer(), batch))
        } else json.encodeToJsonElement(StateBatch.serializer(StringListChange.serializer()), StateBatch(1, accountId, generation, batch.clientId, StateID(batch.sequence), batch.changes.map { StringListChange(it.op, it.episodeId) }))
        return post<StringListAcknowledgement>("api/lists/$id/" + if (legacy) "migration" else "changes", payload).domain()
    }

    suspend fun account(): Account = get<WireAccount>("api/account").domain()

    suspend fun savePreferences(options: AudioOptions): AudioOptions =
        send<WirePreferences>("PUT", url("api/account/preferences"), json.encodeToJsonElement(WirePreferences.serializer(), options.wire())).domain()

    suspend fun removePasskey(id: String) {
        send<WireSuccess>("DELETE", baseUrl.resolve("api/account/passkeys")!!.newBuilder().addPathSegment(id).build(), null)
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
            .header("X-Podcst-Client", "native")
            .method(method, body?.toString()?.toRequestBody(JSON))
            .apply { if (session) cookies.read()?.let { header("Cookie", "session=$it") } }
            .build()
        return client.newCall(request).await().use { response ->
            if (session && revision.get() != token) throw CancellationException("Session changed")
            if (session) persistCookie(response)
            val text = response.body.string()
            if (!response.isSuccessful) throw ApiException(response.code, errorMessage(text) ?: response.message.ifEmpty { "HTTP ${response.code}" }, runCatching { json.decodeFromString<WireError>(text).code }.getOrNull(), response.header("Retry-After")?.toLongOrNull())
            try {
                json.decodeFromString(strategy, text.ifEmpty { "{}" })
            } catch (failure: IllegalArgumentException) {
                throw ApiException(response.code, "Invalid API response", "invalid_response")
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
            explicitNulls = true
            coerceInputValues = false
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
