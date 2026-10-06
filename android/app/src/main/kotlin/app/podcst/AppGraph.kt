package app.podcst

import android.app.Application
import android.net.ConnectivityManager
import android.net.Network
import app.podcst.artwork.ArtworkStore
import app.podcst.data.AccountChange
import app.podcst.data.AccountRepository
import app.podcst.data.CatalogRepository
import app.podcst.data.LibraryRepository
import app.podcst.data.Preferences
import app.podcst.data.ProgressRepository
import app.podcst.data.Scope
import app.podcst.data.Scopes
import app.podcst.data.SecureStore
import app.podcst.data.SessionRepository
import app.podcst.data.StarRepository
import app.podcst.data.starRemote
import app.podcst.data.WorkManagerScheduler
import app.podcst.network.PodcstApi
import app.podcst.playback.PlaybackCoordinator
import app.podcst.playback.PodcstRenderersFactory
import app.podcst.playback.audio.RustAudioStages
import app.podcst.playback.media.Downloads
import app.podcst.playback.media.DownloadsService
import app.podcst.playback.media.MediaStore
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlin.time.Duration.Companion.seconds
import okhttp3.Cache
import okhttp3.OkHttpClient
import java.io.File

class AppGraph(application: Application) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val incoming = kotlinx.coroutines.flow.MutableSharedFlow<Incoming>(replay = 1)
    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .cache(Cache(File(application.cacheDir, "http"), HTTP_CACHE))
        .build()
    val api = PodcstApi(client, SecureStore(application, "session"))
    val preferences = Preferences(application)
    val session = SessionRepository(application, api)
    val account = AccountRepository(api, session, preferences)
    val scopes = Scopes(application, session.user?.id)
    val scheduler = WorkManagerScheduler(application)
    val catalog = CatalogRepository(api, scopes)
    val library = LibraryRepository(api, scopes, catalog)
    val progress = ProgressRepository(api, scopes, scheduler)
    val stars = StarRepository(File(application.noBackupFilesDir, "episode-lists.json"), api.starRemote(), scope, session.user?.id)
    val media = MediaStore(application, client)
    val downloads = Downloads(application, media, DownloadsService::class.java, scope)
    val artwork = ArtworkStore(application, client, scopes.current.value.key)
    val playback = PlaybackCoordinator(
        application,
        media,
        scopes,
        progress,
        preferences,
        PodcstRenderersFactory(application, RustAudioStages),
        scope,
    )

    init {
        account.start(scope)
        session.suspendAccountWork = stars::suspendSync
        session.resumeAccountWork = stars::resumeSync
        application.getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { scope.launch { stars.refresh() } }
        })
        session.accountChange = AccountChange { accountId ->
            stars.suspendSync()
            playback.beginAccountChange()
            downloads.purge()
            stars.switchAccount(accountId, activate = false)
            scopes.switch(accountId)
            artwork.switch(Scope.key(accountId))
            playback.switchAccount()
        }
        scope.launch {
            combine(library.podcasts, library.newReleases, playback.state.map { it.queue.episodes }.distinctUntilChanged()) { podcasts, releases, queue ->
                podcasts.map { it.cover }.toSet() + (queue + releases.take(RETAINED_RELEASES)).flatMap { listOf(it.artwork, it.cover) }
            }.distinctUntilChanged().collect(artwork::retain)
        }
        scope.launch {
            session.session.map { it.user?.id to it.loading }.distinctUntilChanged().collect { (account, loading) ->
                if (account == null || loading || playback.state.value.queue.episodes.isNotEmpty()) return@collect
                runCatching { progress.restoreLatest() }.getOrNull()?.let { latest ->
                    if (playback.state.value.queue.episodes.isEmpty()) playback.restore(latest.episode, latest.position.seconds)
                }
            }
        }
    }

    private companion object {
        const val HTTP_CACHE = 16L * 1024 * 1024
        const val RETAINED_RELEASES = 3
    }
}
