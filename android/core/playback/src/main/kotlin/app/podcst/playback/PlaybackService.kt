package app.podcst.playback

import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import androidx.media3.common.ForwardingSimpleBasePlayer
import androidx.media3.common.Player
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlin.time.Duration.Companion.milliseconds

interface PlaybackHost {
    val playback: PlaybackCoordinator
    val starred: kotlinx.coroutines.flow.Flow<Set<String>>
    fun toggleStar(identity: String)
    fun sessionActivity(): Intent
}

class PlaybackService : MediaSessionService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        val host = application as PlaybackHost
        val coordinator = host.playback
        val player = QueuePlayer(coordinator)
        val activity = PendingIntent.getActivity(this, 0, host.sessionActivity(), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val created = MediaSession.Builder(this, player)
            .setSessionActivity(activity)
            .setCallback(Callback(host))
            .setMediaButtonPreferences(buttons(starred = false))
            .build()
        session = created
        setMediaNotificationProvider(DefaultMediaNotificationProvider.Builder(this).build().apply { setSmallIcon(R.drawable.ic_notification) })
        scope.launch {
            coordinator.state.collect { player.refresh() }
        }
        scope.launch {
            combine(coordinator.state, host.starred) { state, starred -> state.episode?.identity?.value in starred }
                .distinctUntilChanged()
                .collect { starred -> created.setMediaButtonPreferences(buttons(starred)) }
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = session?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        (application as PlaybackHost).playback.checkpoint()
        scope.cancel()
        session?.run {
            player.release()
            release()
        }
        session = null
        super.onDestroy()
    }

    private fun buttons(starred: Boolean) = listOf(
        CommandButton.Builder(CommandButton.ICON_SKIP_BACK_10)
            .setPlayerCommand(Player.COMMAND_SEEK_BACK)
            .setDisplayName(getString(R.string.skip_back))
            .setSlots(CommandButton.SLOT_BACK)
            .build(),
        CommandButton.Builder(CommandButton.ICON_SKIP_FORWARD_30)
            .setPlayerCommand(Player.COMMAND_SEEK_FORWARD)
            .setDisplayName(getString(R.string.skip_forward))
            .setSlots(CommandButton.SLOT_FORWARD)
            .build(),
        CommandButton.Builder(if (starred) CommandButton.ICON_STAR_FILLED else CommandButton.ICON_STAR_UNFILLED)
            .setSessionCommand(STAR)
            .setDisplayName(getString(if (starred) R.string.unstar else R.string.star))
            .setSlots(CommandButton.SLOT_OVERFLOW)
            .build(),
    )

    private class Callback(private val host: PlaybackHost) : MediaSession.Callback {
        override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult =
            MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon().add(STAR).build())
                .build()

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle,
        ): ListenableFuture<SessionResult> {
            if (customCommand == STAR) host.playback.state.value.episode?.let { host.toggleStar(it.identity.value) }
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }
    }

    private class QueuePlayer(private val coordinator: PlaybackCoordinator) : ForwardingSimpleBasePlayer(coordinator.player) {
        override fun getState(): State {
            val state = super.getState()
            val queued = coordinator.state.value.queue.episodes.size > 1
            val commands = state.availableCommands.buildUpon()
                .addAll(Player.COMMAND_PLAY_PAUSE, Player.COMMAND_SEEK_BACK, Player.COMMAND_SEEK_FORWARD)
                .apply {
                    if (queued) addAll(Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM, Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                }
                .build()
            return state.buildUpon().setAvailableCommands(commands).build()
        }

        override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
            if (playWhenReady) coordinator.resume() else coordinator.pause()
            return Futures.immediateVoidFuture()
        }

        override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
            when (seekCommand) {
                Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> coordinator.next()
                Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> coordinator.previous()
                Player.COMMAND_SEEK_BACK -> coordinator.skipBack()
                Player.COMMAND_SEEK_FORWARD -> coordinator.skipForward()
                else -> coordinator.seek(positionMs.coerceAtLeast(0).milliseconds)
            }
            return Futures.immediateVoidFuture()
        }

        override fun handleStop(): ListenableFuture<*> {
            coordinator.stop()
            return Futures.immediateVoidFuture()
        }

        override fun handleRelease(): ListenableFuture<*> = Futures.immediateVoidFuture()

        fun refresh() = invalidateState()
    }

    private companion object {
        val STAR = SessionCommand("app.podcst.STAR", Bundle.EMPTY)
    }
}
