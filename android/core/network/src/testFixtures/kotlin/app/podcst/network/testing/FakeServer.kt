package app.podcst.network.testing

import app.podcst.network.PodcstApi
import app.podcst.network.SessionCookieStore
import java.util.concurrent.CopyOnWriteArrayList
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

data class Reply(val body: String = "{}", val code: Int = 200, val cookie: String? = null)

data class Call(val path: String, val body: String, val query: String? = null)

class FakeServer(private val route: (Call) -> Reply) {
    val calls = CopyOnWriteArrayList<Call>()

    private val cookies = object : SessionCookieStore {
        @Volatile private var value: String? = null
        override fun read() = value
        override fun write(value: String) { this.value = value }
        override fun clear() { value = null }
    }

    private val client = OkHttpClient.Builder().addInterceptor { chain ->
        val request = chain.request()
        val call = Call(request.url.encodedPath, request.body?.let { body -> Buffer().also(body::writeTo).readUtf8() }.orEmpty(), request.url.query)
        calls += call
        val reply = route(call)
        Response.Builder()
            .request(request)
            .protocol(Protocol.HTTP_1_1)
            .code(reply.code)
            .message("")
            .apply { reply.cookie?.let { header("Set-Cookie", "session=$it; Path=/") } }
            .body(reply.body.toResponseBody("application/json".toMediaType()))
            .build()
    }.build()

    suspend fun awaitCall(predicate: (Call) -> Boolean): Call = withContext(Dispatchers.Default) {
        withTimeout(5_000) {
            while (calls.none(predicate)) delay(10)
            calls.first(predicate)
        }
    }

    val api = PodcstApi(client, cookies, "https://podcst.test/".toHttpUrl())

    companion object {
        const val USER = """{"user":{"id":"u1","email":"you@podcst.app","hasPasskey":true}}"""
    }
}
