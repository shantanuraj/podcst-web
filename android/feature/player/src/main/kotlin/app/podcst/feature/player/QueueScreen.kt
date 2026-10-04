package app.podcst.feature.player

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.podcst.designsystem.Artwork
import app.podcst.designsystem.ArtworkEpisodeRow
import app.podcst.designsystem.EpisodeActions
import app.podcst.designsystem.EpisodeRowState
import app.podcst.designsystem.Equalizer
import app.podcst.designsystem.Eyebrow
import app.podcst.designsystem.Format
import app.podcst.designsystem.Message
import app.podcst.designsystem.Podcst
import app.podcst.designsystem.SwipeAction
import app.podcst.designsystem.PodcstIcons
import app.podcst.designsystem.pressable
import app.podcst.model.Episode
import app.podcst.playback.PlaybackStatus
import kotlin.time.Duration

@Composable
fun QueueScreen(
    state: PlayerScreenState,
    viewModel: PlayerViewModel,
    actions: EpisodeActions,
    onOpenPlayer: () -> Unit,
    contentPadding: PaddingValues,
) {
    val colors = Podcst.colors
    val player = state.player
    val current = state.episode
    val upNext = player.queue.upNext
    val remaining = player.remaining + upNext.fold(Duration.ZERO) { total, episode -> total + (episode.duration ?: Duration.ZERO) }
    val list = rememberLazyListState()
    var dragging by remember { mutableStateOf<Int?>(null) }
    var offset by remember { mutableFloatStateOf(0f) }
    val moveUp = stringResource(R.string.move_up)
    val moveDown = stringResource(R.string.move_down)

    LazyColumn(Modifier.fillMaxSize().statusBarsPadding(), state = list, contentPadding = contentPadding) {
        item {
            Column(Modifier.padding(horizontal = 20.dp).padding(top = 12.dp)) {
                Text(stringResource(R.string.queue), style = Podcst.type.largeTitle, color = colors.ink)
                if (player.queue.episodes.isNotEmpty()) {
                    Eyebrow(
                        stringResource(R.string.queue_summary, player.queue.episodes.size, Format.left(remaining)),
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
            }
        }
        if (current == null) {
            item { Message(stringResource(R.string.queue_empty), detail = stringResource(R.string.queue_empty_detail)) }
            return@LazyColumn
        }
        item { NowPlayingCard(state, current, onOpenPlayer) }
        if (upNext.isNotEmpty()) {
            item {
                Eyebrow(stringResource(R.string.up_next), modifier = Modifier.padding(start = 20.dp, top = 14.dp, bottom = 8.dp))
            }
        }
        itemsIndexed(upNext, key = { _, episode -> episode.identity.value }) { index, episode ->
            val lifted = dragging == index
            Box(
                Modifier
                    .graphicsLayer {
                        translationY = if (lifted) offset else 0f
                        shadowElevation = if (lifted) 16f else 0f
                    }
                    .semantics {
                        customActions = listOfNotNull(
                            if (index > 0) CustomAccessibilityAction(moveUp) { viewModel.moveUpNext(index, index - 1); true } else null,
                            if (index < upNext.lastIndex) CustomAccessibilityAction(moveDown) { viewModel.moveUpNext(index, index + 2); true } else null,
                        )
                    },
            ) {
                ArtworkEpisodeRow(
                    EpisodeRowState(episode, starred = episode.identity.value in state.starred, download = state.download(episode)),
                    actions,
                    subtitle = episode.podcastTitle,
                    remove = SwipeAction(stringResource(R.string.remove)) { viewModel.removeUpNext(index) },
                    trailing = {
                        Icon(
                            PodcstIcons.Drag,
                            stringResource(R.string.reorder),
                            Modifier
                                .size(28.dp)
                                .pointerInput(index) {
                                    detectDragGestures(
                                        onDragStart = { dragging = index; offset = 0f },
                                        onDragEnd = {
                                            val height = list.layoutInfo.visibleItemsInfo.firstOrNull { it.key == episode.identity.value }?.size ?: 1
                                            val moved = (offset / height).let { kotlin.math.round(it).toInt() }
                                            val target = (index + moved).coerceIn(0, upNext.lastIndex)
                                            if (target != index) viewModel.moveUpNext(index, if (target > index) target + 1 else target)
                                            dragging = null
                                            offset = 0f
                                        },
                                        onDragCancel = { dragging = null; offset = 0f },
                                    ) { change, amount ->
                                        change.consume()
                                        offset += amount.y
                                    }
                                },
                            tint = colors.muted,
                        )
                    },
                )
            }
        }
    }
}

@Composable
private fun NowPlayingCard(state: PlayerScreenState, episode: Episode, onOpen: () -> Unit) {
    val colors = Podcst.colors
    val player = state.player
    Row(
        Modifier
            .padding(horizontal = 12.dp)
            .padding(top = 16.dp, bottom = 6.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(colors.accentSubtle)
            .pressable(onClick = onOpen)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Artwork(episode.artwork, 52.dp, corner = 10.dp, bordered = false)
        Column(Modifier.weight(1f)) {
            Eyebrow(stringResource(R.string.now_playing), color = colors.accent)
            Text(episode.title, style = Podcst.type.episodeTitle, color = colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
            Text(
                listOfNotNull(episode.podcastTitle, Format.left(player.remaining).takeIf { player.duration.isPositive() }).joinToString(" · "),
                style = Podcst.type.meta,
                color = colors.secondary,
                maxLines = 1,
            )
        }
        Equalizer(playing = player.status == PlaybackStatus.Playing, modifier = Modifier.padding(end = 4.dp))
    }
}
