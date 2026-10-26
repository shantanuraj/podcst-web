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
import app.podcst.playback.ClipPreview
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
import okhttp3.OkHttpClient
import java.io.File

class AppGraph(application: Application) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val incoming = kotlinx.coroutines.flow.MutableSharedFlow<Incoming>(replay = 1)
    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
    val api = PodcstApi(client, SecureStore(application, "session"))
    val preferences = Preferences(application)
    val session = SessionRepository(application, api)
    val deletion = app.podcst.data.AccountDeletionRepository(application, api, session)
    val account = AccountRepository(api, session, preferences)
    val scopes = Scopes(application, null)
    val scheduler = WorkManagerScheduler(application)
    val catalog = CatalogRepository(api, scopes)
    val retained = app.podcst.data.RetainedState(scopes, api, catalog)
    val library = LibraryRepository(api, scopes, catalog)
    val progress = ProgressRepository(api, scopes, scheduler)
    val recovery = app.podcst.data.StateRecovery(api, scopes)
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
    val preview = ClipPreview(application, media, scope)

    init {
        session.deletionBlocked = deletion::blocked
        api.deletionBlocked = { session.user?.id?.let(deletion::blocked) == true }
        media.blocked = deletion::blocked
        deletion.suspend = { accountId ->
            if (session.user?.id == accountId) {
                playback.checkpointAndSuspend()
                preview.stop()
                scopes.checkpoint()
                stars.checkpoint()
                scopes.suspendSync()
                stars.suspendSync()
                api.beginAuthentication()
            }
        }
        deletion.clean = { accountId, step ->
            when (step) {
                app.podcst.model.AccountDeletion.Cleanup.Retire -> {
                    deletion.suspend?.invoke(accountId)
                }
                app.podcst.model.AccountDeletion.Cleanup.Media -> {
                    downloads.erase(accountId)
                    artwork.erase(Scope.key(accountId))
                }
                app.podcst.model.AccountDeletion.Cleanup.Data -> eraseAcknowledgedAccount(accountId)
                app.podcst.model.AccountDeletion.Cleanup.Credentials -> session.forgetDeletedAccount(accountId)
                app.podcst.model.AccountDeletion.Cleanup.Complete -> Unit
            }
        }
        scopes.retainedMediaIdentities = { downloads.states.value.values.mapTo(mutableSetOf()) { it.identity } }
        account.start(scope)
        session.checkpointAccountWork = {
            playback.checkpointAndSuspend()
            scopes.checkpoint()
            stars.checkpoint()
        }
        session.suspendAccountWork = { stars.suspendSync(); scopes.suspendSync(); playback.beginAccountChange(); preview.stop() }
        session.resumeAccountWork = { account ->
            scopes.resumeSync(account)
            stars.resumeSync(account)
            playback.resumeAccountWork()
            scope.launch { progress.sync(); runCatching { library.refresh() } }
        }
        application.getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { scope.launch { deletion.resume(); stars.refresh(); progress.sync(); runCatching { library.refresh() } } }
        })
        session.accountChange = AccountChange { accountId ->
            stars.suspendSync()
            playback.checkpointAndSuspend()
            stars.switchAccount(accountId, activate = false)
            scopes.switch(accountId)
            media.accountId = accountId
            downloads.scopeChanged()
            artwork.switch(Scope.key(accountId))
            playback.switchAccount()
        }
        scope.launch { deletion.resume() }
        scope.launch {
            combine(library.podcasts, library.newReleases, playback.state.map { it.queue.episodes }.distinctUntilChanged()) { podcasts, releases, queue ->
                podcasts.map { it.cover }.toSet() + (queue + releases.take(RETAINED_RELEASES)).flatMap { listOf(it.artwork, it.cover) }
            }.distinctUntilChanged().collect(artwork::retain)
        }
    }

    suspend fun eraseAcknowledgedAccount(accountId: String) {
        check(scopes.current.value.accountId != accountId)
        scopes.erase(accountId)
        stars.erase(accountId)
    }

    private companion object {
        const val RETAINED_RELEASES = 3
    }
}
