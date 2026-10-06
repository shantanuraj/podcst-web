package app.podcst

import android.app.Application
import android.content.Intent
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.media3.cast.Cast
import androidx.work.Configuration
import app.podcst.data.PodcstWorkerFactory
import app.podcst.playback.PlaybackCoordinator
import app.podcst.playback.PlaybackHost
import app.podcst.playback.media.DownloadsHost
import app.podcst.playback.media.MediaStore
import coil3.ImageLoader
import coil3.SingletonImageLoader
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

class PodcstApplication : Application(), PlaybackHost, DownloadsHost, Configuration.Provider, SingletonImageLoader.Factory {
    val graph by lazy { AppGraph(this) }

    override val playback: PlaybackCoordinator get() = graph.playback
    override val media: MediaStore get() = graph.media
    override val starred: Flow<Set<Long>> get() = graph.stars.episodeIds

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(PodcstWorkerFactory({ graph.progress }, { graph.library })).build()

    override fun onCreate() {
        super.onCreate()
        Cast.getSingletonInstance(this).initialize()
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) = graph.playback.checkpoint()
        })
        graph.scheduler.refreshFeeds()
    }

    override fun toggleStar(episode: app.podcst.model.Episode) {
        graph.scope.launch { graph.stars.toggle(episode) }
    }

    override fun sessionActivity(): Intent = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)

    override fun newImageLoader(context: android.content.Context): ImageLoader = graph.artwork.loader
}
