package app.podcst.playback

import android.content.Context
import android.net.Uri
import android.os.SystemClock
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.extractor.metadata.Chapter as EmbeddedChapter
import app.podcst.data.Preferences
import app.podcst.data.ProgressRepository
import app.podcst.data.Scopes
import app.podcst.database.PlayerEntity
import app.podcst.database.domain
import app.podcst.database.entity
import app.podcst.model.Artwork
import app.podcst.model.AudioEffects
import app.podcst.model.AudioSettings
import app.podcst.model.Chapter
import app.podcst.model.Episode
import app.podcst.model.PlaybackQueue
import app.podcst.model.PlaybackRules
import app.podcst.model.ShowNotes
import app.podcst.model.indexAt
import app.podcst.playback.audio.EffectState
import app.podcst.playback.audio.ProcessingAudioSink
import app.podcst.playback.media.MediaStore
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

enum class PlaybackStatus { Idle, Loading, Playing, Paused, Failed }

sealed interface SleepTimer {
    data object EndOfEpisode : SleepTimer
    data class At(val deadline: Long) : SleepTimer
}

data class PlayerState(
    val queue: PlaybackQueue = PlaybackQueue(),
    val status: PlaybackStatus = PlaybackStatus.Idle,
    val requested: Boolean = false,
    val position: Duration = Duration.ZERO,
    val duration: Duration = Duration.ZERO,
    val buffered: Duration = Duration.ZERO,
    val settings: AudioSettings = AudioSettings(),
    val heldDoubleSpeed: Boolean = false,
    val effectState: EffectState = EffectState.Inactive,
    val chapters: List<Chapter> = emptyList(),
    val sleepTimer: SleepTimer? = null,
) {
    val episode: Episode? get() = queue.episode
    val active: Boolean get() = queue.active && episode != null
    val speed: Double get() = settings.options(episode?.feed).speed
    val effects: AudioEffects get() = settings.options(episode?.feed).effects
    val effectiveSpeed: Double get() = if (heldDoubleSpeed) PlaybackRules.HELD_SPEED else speed
    val remaining: Duration get() = (duration - position).coerceAtLeast(Duration.ZERO)
    val progress: Float get() = if (duration.isPositive()) (position / duration).toFloat().coerceIn(0f, 1f) else 0f
    val chapterIndex: Int? get() = chapters.indexAt(position)
    val buffering: Boolean get() = requested && status == PlaybackStatus.Loading
}

class PlaybackCoordinator(
    private val context: Context,
    private val media: MediaStore,
    private val scopes: Scopes,
    private val progress: ProgressRepository,
    private val preferences: Preferences,
    private val renderers: PodcstRenderersFactory,
    private val scope: CoroutineScope,
) {
    private val mutable = MutableStateFlow(PlayerState())
    val state: StateFlow<PlayerState> = mutable.asStateFlow()

    val player: ExoPlayer = ExoPlayer.Builder(context, renderers)
        .setMediaSourceFactory(DefaultMediaSourceFactory(media.dataSource))
        .setAudioAttributes(
            AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(),
            true,
        )
        .setHandleAudioBecomingNoisy(true)
        .setWakeMode(C.WAKE_MODE_NETWORK)
        .setSeekBackIncrementMs(PlaybackRules.skipBack.inWholeMilliseconds)
        .setSeekForwardIncrementMs(PlaybackRules.skipForward.inWholeMilliseconds)
        .build()

    private var loaded: String? = null
    private var changingAccount = false
    private var playingSince: Long? = null
    private var playedSinceProgress = 0L
    private var ticker: Job? = null
    private var sleep: Job? = null
    private var embeddedChapters: Pair<String, List<Chapter>>? = null

    init {
        player.addListener(Listener())
        scope.launch { preferences.audio.collect { settings -> update { it.copy(settings = settings) }; applyAudio() } }
        scope.launch { renderers.sink.effectState.collect { effect -> update { it.copy(effectState = effect) } } }
        scope.launch { restore() }
    }

    fun play(episode: Episode, at: Duration? = null) {
        if (changingAccount) return
        saveOutgoing()
        val queue = state.value.queue.playing(episode)
        val start = at ?: Duration.ZERO
        update { it.copy(queue = queue, position = start, duration = episode.duration ?: Duration.ZERO) }
        load(episode, start, autoplay = true)
        persist()
    }

    fun restore(episode: Episode, at: Duration) {
        if (changingAccount) return
        saveOutgoing()
        update { it.copy(queue = it.queue.playing(episode), position = at, duration = episode.duration ?: Duration.ZERO, status = PlaybackStatus.Paused) }
        unload()
        persist()
    }

    fun toggle() = if (state.value.requested) pause() else resume()

    fun pause() {
        if (!state.value.active) return
        player.playWhenReady = false
        capturePosition()
        update { it.copy(requested = false, status = PlaybackStatus.Paused) }
        persist()
        emitProgress(completed = false)
    }

    fun resume() {
        val current = state.value
        val episode = current.episode ?: return
        if (changingAccount) return
        if (loaded != episode.identity.value || player.playbackState == Player.STATE_IDLE || current.status == PlaybackStatus.Failed) {
            load(episode, current.position, autoplay = true)
        } else {
            update { it.copy(requested = true, status = if (player.isPlaying) PlaybackStatus.Playing else PlaybackStatus.Loading) }
            player.playWhenReady = true
        }
        update { it.copy(queue = it.queue.reopened()) }
        persist()
    }

    fun seek(to: Duration) {
        val current = state.value
        if (current.episode == null) return
        val target = to.coerceAtLeast(Duration.ZERO).let { if (current.duration.isPositive()) it.coerceAtMost(current.duration) else it }
        update { it.copy(position = target) }
        if (loaded == current.episode?.identity?.value && player.playbackState != Player.STATE_IDLE) {
            player.seekTo(target.inWholeMilliseconds)
        } else {
            emitProgress(completed = false)
        }
        persist()
    }

    fun skipBack() = seek(state.value.position - PlaybackRules.skipBack)

    fun skipForward() = seek(state.value.position + PlaybackRules.skipForward)

    fun previousChapter() {
        val current = state.value
        val index = current.chapterIndex ?: return previous()
        val chapter = current.chapters[index]
        seek(if (current.position - chapter.start > PlaybackRules.chapterRestartThreshold || index == 0) chapter.start else current.chapters[index - 1].start)
    }

    fun nextChapter() {
        val current = state.value
        current.chapters.firstOrNull { it.start > current.position + PlaybackRules.chapterLookahead }?.let { seek(it.start) } ?: next()
    }

    fun next() = advance { it.next() }

    fun previous() = advance { it.previous() }

    fun enqueue(episode: Episode, next: Boolean = false) {
        update { it.copy(queue = it.queue.enqueue(episode, next)) }
        persist()
    }

    fun remove(indices: Set<Int>) {
        val before = state.value.queue
        if (before.current in indices) saveOutgoing()
        val after = before.removing(indices)
        update { it.copy(queue = after) }
        if (after.episode?.identity != before.episode?.identity) {
            unload()
            update { it.copy(position = Duration.ZERO, duration = after.episode?.duration ?: Duration.ZERO, status = if (after.active) PlaybackStatus.Paused else PlaybackStatus.Idle, requested = false) }
        }
        persist()
    }

    fun removeUpNext(offsets: Set<Int>) {
        update { it.copy(queue = it.queue.rotatedToCurrent()) }
        remove(offsets.mapTo(mutableSetOf()) { it + 1 })
    }

    fun moveUpNext(from: Int, to: Int) {
        update { it.copy(queue = it.queue.movingUpNext(from, to)) }
        persist()
    }

    fun stop() {
        val current = state.value
        if (!current.active) return
        capturePosition()
        unload()
        update { it.copy(queue = it.queue.stopped(), status = PlaybackStatus.Idle, requested = false, sleepTimer = null) }
        sleep?.cancel()
        persist()
        emitProgress(completed = false)
    }

    fun reopen() {
        val current = state.value
        if (changingAccount || current.episode == null || current.active) return
        update { it.copy(queue = it.queue.reopened(), status = PlaybackStatus.Paused) }
        persist()
    }

    fun markPlayed() {
        if (changingAccount || !state.value.active) return
        finishCurrent()
    }

    fun clear() {
        saveOutgoing()
        unload()
        update { it.copy(queue = PlaybackQueue(), position = Duration.ZERO, duration = Duration.ZERO, status = PlaybackStatus.Idle, requested = false) }
        persist()
    }

    fun holdDoubleSpeed(held: Boolean) {
        if (state.value.heldDoubleSpeed == held) return
        update { it.copy(heldDoubleSpeed = held) }
        applyAudio()
    }

    fun setSpeed(speed: Double) {
        val feed = state.value.episode?.feed
        scope.launch { preferences.updateAudio { it.withSpeed(speed, feed) } }
    }

    fun setEffects(effects: AudioEffects) {
        val feed = state.value.episode?.feed
        scope.launch {
            preferences.updateAudio { settings ->
                val target = feed?.takeIf(settings::hasOverride)
                settings.with(settings.options(feed).copy(effects = effects), target)
            }
        }
    }

    fun setSleepTimer(timer: SleepTimer?) {
        sleep?.cancel()
        update { it.copy(sleepTimer = timer) }
        if (timer is SleepTimer.At) {
            sleep = scope.launch {
                delay((timer.deadline - System.currentTimeMillis()).coerceAtLeast(0))
                update { it.copy(sleepTimer = null) }
                pause()
            }
        }
    }

    fun checkpoint() {
        if (!state.value.active) return
        capturePosition()
        persist()
        emitProgress(completed = false)
    }

    fun beginAccountChange() {
        pause()
        changingAccount = true
        unload()
    }

    suspend fun switchAccount() {
        update { PlayerState(settings = it.settings, effectState = it.effectState) }
        restore()
        changingAccount = false
    }

    private fun advance(transform: (PlaybackQueue) -> PlaybackQueue) {
        val before = state.value.queue
        if (changingAccount || before.episodes.isEmpty()) return
        saveOutgoing()
        val after = transform(before)
        val episode = after.episode ?: return
        update { it.copy(queue = after, position = Duration.ZERO, duration = episode.duration ?: Duration.ZERO) }
        load(episode, Duration.ZERO, autoplay = true)
        persist()
    }

    private fun finishCurrent() {
        val current = state.value
        val episode = current.episode ?: return
        update { it.copy(position = it.duration.takeIf(Duration::isPositive) ?: episode.duration ?: it.position) }
        emitProgress(completed = true)
        val after = current.queue.finished()
        val next = after.episode
        if (current.sleepTimer == SleepTimer.EndOfEpisode) update { it.copy(sleepTimer = null) }
        if (next == null || current.sleepTimer == SleepTimer.EndOfEpisode) {
            unload()
            update { it.copy(queue = if (next == null) after else after.stopped(), position = Duration.ZERO, duration = next?.duration ?: Duration.ZERO, status = PlaybackStatus.Idle, requested = false) }
        } else {
            update { it.copy(queue = after, position = Duration.ZERO, duration = next.duration ?: Duration.ZERO) }
            load(next, Duration.ZERO, autoplay = true)
        }
        persist()
    }

    private fun load(episode: Episode, at: Duration, autoplay: Boolean) {
        loaded = episode.identity.value
        embeddedChapters = null
        playedSinceProgress = 0
        player.setMediaItem(item(episode), at.inWholeMilliseconds)
        player.prepare()
        player.playWhenReady = autoplay
        update { it.copy(status = PlaybackStatus.Loading, requested = autoplay, chapters = parsedChapters(episode)) }
        applyAudio()
    }

    private fun unload() {
        loaded = null
        player.stop()
        player.clearMediaItems()
        stopTicker()
    }

    private fun item(episode: Episode): MediaItem = MediaItem.Builder()
        .setMediaId(episode.identity.value)
        .setUri(episode.file.url)
        .setCustomCacheKey(MediaStore.key(episode))
        .setMimeType(episode.file.type.takeIf { it.startsWith("audio/") && it != "audio/mpeg3" })
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(episode.title)
                .setArtist(episode.podcastTitle ?: episode.author)
                .setAlbumTitle(episode.podcastTitle)
                .setArtworkUri(episode.artwork.takeIf { it.isNotBlank() }?.let { Uri.parse(Artwork.url(it, NOW_PLAYING_ARTWORK)) })
                .setMediaType(MediaMetadata.MEDIA_TYPE_PODCAST_EPISODE)
                .setIsPlayable(true)
                .setIsBrowsable(false)
                .build(),
        )
        .build()

    private fun applyAudio() {
        val current = state.value
        player.playbackParameters = PlaybackParameters(current.effectiveSpeed.toFloat())
        renderers.sink.setEffects(current.effects)
    }

    private fun parsedChapters(episode: Episode): List<Chapter> {
        embeddedChapters?.takeIf { it.first == episode.identity.value }?.second?.takeIf { it.isNotEmpty() }?.let { return it }
        return ShowNotes.chapters(episode.notes)
    }

    private fun capturePosition() {
        if (loaded != null && player.playbackState != Player.STATE_IDLE) {
            update { it.copy(position = player.currentPosition.coerceAtLeast(0).milliseconds) }
        }
    }

    private fun saveOutgoing() {
        if (loaded == null) return
        capturePosition()
        emitProgress(completed = false)
    }

    private fun emitProgress(completed: Boolean) {
        val current = state.value
        val episode = current.episode ?: return
        playedSinceProgress = 0
        playingSince = if (current.status == PlaybackStatus.Playing) SystemClock.elapsedRealtime() else null
        val position = current.position
        scope.launch { progress.record(episode.copy(duration = current.duration.takeIf(Duration::isPositive) ?: episode.duration), position, completed) }
    }

    private fun persist() {
        val current = state.value
        val queue = current.queue
        val database = scopes.database
        scope.launch {
            database.episodes().upsert(queue.episodes.map { it.entity() })
            database.player().save(
                queue.episodes.map { it.identity.value },
                PlayerEntity(current = queue.episode?.identity?.value, positionMs = current.position.inWholeMilliseconds, active = queue.active),
            )
        }
    }

    private suspend fun restore() {
        val database = scopes.database
        val player = database.player().player()
        val episodes = database.episodes().queue().map { it.domain() }
        if (episodes.isEmpty()) return
        val index = player?.current?.let { identity -> episodes.indexOfFirst { it.identity.value == identity } }?.takeIf { it >= 0 } ?: 0
        val queue = PlaybackQueue(episodes, index, player?.active ?: false)
        update {
            it.copy(
                queue = queue,
                position = (player?.positionMs ?: 0).milliseconds,
                duration = queue.episode?.duration ?: Duration.ZERO,
                status = if (queue.active) PlaybackStatus.Paused else PlaybackStatus.Idle,
                chapters = queue.episode?.let(::parsedChapters).orEmpty(),
            )
        }
    }

    private fun update(transform: (PlayerState) -> PlayerState) = mutable.update(transform)

    private fun startTicker() {
        if (ticker?.isActive == true) return
        ticker = scope.launch {
            while (isActive) {
                tick()
                delay(TICK)
            }
        }
    }

    private fun stopTicker() {
        ticker?.cancel()
        ticker = null
    }

    private fun tick() {
        if (loaded == null) return
        val position = player.currentPosition.coerceAtLeast(0).milliseconds
        val duration = player.duration.takeIf { it != C.TIME_UNSET && it > 0 }?.milliseconds
        update { it.copy(position = position, duration = duration ?: it.duration, buffered = player.bufferedPosition.milliseconds) }
        val since = playingSince ?: return
        if (playedSinceProgress + SystemClock.elapsedRealtime() - since >= PlaybackRules.progressInterval.inWholeMilliseconds) {
            emitProgress(completed = false)
            persist()
        }
    }

    private inner class Listener : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            val now = SystemClock.elapsedRealtime()
            playingSince?.let { playedSinceProgress += now - it }
            playingSince = if (isPlaying) now else null
            if (isPlaying) startTicker() else { tick(); stopTicker() }
            update {
                it.copy(status = when {
                    isPlaying -> PlaybackStatus.Playing
                    it.requested && player.playbackState != Player.STATE_ENDED -> PlaybackStatus.Loading
                    it.status == PlaybackStatus.Failed -> PlaybackStatus.Failed
                    loaded == null -> it.status
                    else -> PlaybackStatus.Paused
                })
            }
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            when (playbackState) {
                Player.STATE_READY -> {
                    tick()
                    if (!player.playWhenReady) update { it.copy(status = PlaybackStatus.Paused) }
                }
                Player.STATE_ENDED -> if (loaded != null) finishCurrent()
                else -> Unit
            }
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST) return
            if (!playWhenReady && state.value.requested) {
                capturePosition()
                update { it.copy(requested = false, status = PlaybackStatus.Paused) }
                persist()
                emitProgress(completed = false)
            }
        }

        override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
            if (reason != Player.DISCONTINUITY_REASON_SEEK) return
            update { it.copy(position = newPosition.positionMs.milliseconds) }
            emitProgress(completed = false)
            persist()
        }

        override fun onPlayerError(error: PlaybackException) {
            capturePosition()
            update { it.copy(status = PlaybackStatus.Failed, requested = false) }
            persist()
        }

        override fun onTracksChanged(tracks: Tracks) {
            val identity = loaded ?: return
            val chapters = tracks.groups.asSequence()
                .flatMap { group -> (0 until group.length).asSequence().map { group.getTrackFormat(it) } }
                .mapNotNull { it.metadata }
                .flatMap { metadata -> (0 until metadata.length()).asSequence().map { metadata[it] } }
                .filterIsInstance<EmbeddedChapter>()
                .filterNot { it.isHidden }
                .mapIndexed { index, chapter -> Chapter(chapter.title?.value?.takeIf(String::isNotBlank) ?: "Chapter ${index + 1}", chapter.startTimeMs.milliseconds) }
                .sortedBy { it.start }
                .toList()
            if (chapters.size < 2) return
            embeddedChapters = identity to chapters
            update { it.copy(chapters = chapters) }
        }
    }

    private companion object {
        const val TICK = 250L
        const val NOW_PLAYING_ARTWORK = 1024
    }
}
