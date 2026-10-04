package app.podcst.feature.player

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import app.podcst.designsystem.Artwork
import app.podcst.designsystem.EpisodeActions
import app.podcst.designsystem.EpisodeMenu
import app.podcst.designsystem.EpisodeRowState
import app.podcst.designsystem.Equalizer
import app.podcst.designsystem.Eyebrow
import app.podcst.designsystem.Podcst
import app.podcst.designsystem.PodcstIcons
import app.podcst.designsystem.ProgressLine
import app.podcst.designsystem.pressable
import app.podcst.playback.PlaybackStatus
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

@Composable
fun MiniPlayer(
    state: PlayerScreenState,
    actions: EpisodeActions,
    onOpen: () -> Unit,
    onToggle: () -> Unit,
    onNext: () -> Unit,
    onPrevious: () -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val episode = state.episode ?: return
    val player = state.player
    val colors = Podcst.colors
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val horizontal = remember { Animatable(0f) }
    val vertical = remember { Animatable(0f) }
    var menu by remember { mutableStateOf(false) }
    val skipThreshold = with(density) { 96.dp.toPx() }
    val stopThreshold = with(density) { 56.dp.toPx() }
    val queued = player.queue.episodes.size > 1
    val upNext = player.queue.upNext.firstOrNull()
    val playLabel = stringResource(if (player.requested) R.string.pause else R.string.play)
    val stopLabel = stringResource(R.string.stop_playback)

    Box(modifier.fillMaxWidth()) {
        if (vertical.value > stopThreshold / 3) {
            Row(
                Modifier
                    .align(Alignment.TopCenter)
                    .offset { IntOffset(0, (vertical.value / 2 - with(density) { 44.dp.toPx() }).roundToInt()) }
                    .clip(RoundedCornerShape(17.dp))
                    .background(colors.ink)
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(PodcstIcons.Stop, null, Modifier.size(14.dp), tint = colors.paper)
                Text(stringResource(if (vertical.value > stopThreshold) R.string.release_to_stop else R.string.swipe_to_stop), style = Podcst.type.label, color = colors.paper)
            }
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(64.dp)
                .offset { IntOffset(0, vertical.value.roundToInt()) }
                .graphicsLayer {
                    val progress = (vertical.value / stopThreshold).coerceIn(0f, 1f)
                    scaleX = 1f - progress * 0.04f
                    scaleY = 1f - progress * 0.04f
                    alpha = 1f - progress * 0.3f
                }
                .background(colors.surface)
                .pointerInput(queued) {
                    var axis: Boolean? = null
                    detectDragGestures(
                        onDragStart = { axis = null },
                        onDragEnd = {
                            val dx = horizontal.value
                            val dy = vertical.value
                            scope.launch {
                                when {
                                    axis == true && queued && dx < -skipThreshold -> onNext()
                                    axis == true && queued && dx > skipThreshold -> onPrevious()
                                    axis == false && dy > stopThreshold -> onStop()
                                }
                                launch { horizontal.animateTo(0f) }
                                vertical.animateTo(0f)
                            }
                        },
                        onDragCancel = { scope.launch { horizontal.animateTo(0f); vertical.animateTo(0f) } },
                    ) { change, drag ->
                        change.consume()
                        if (axis == null && (abs(drag.x) > 4 || abs(drag.y) > 4)) axis = abs(drag.x) > abs(drag.y)
                        scope.launch {
                            if (axis == true) horizontal.snapTo(horizontal.value + drag.x)
                            if (axis == false) vertical.snapTo((vertical.value + drag.y).coerceAtLeast(0f))
                        }
                    }
                }
                .pressable(onClick = onOpen, onLongClick = { menu = true })
                .semantics {
                    contentDescription = "${episode.title}, ${episode.podcastTitle.orEmpty()}"
                    customActions = listOfNotNull(
                        CustomAccessibilityAction(stopLabel) { onStop(); true },
                        if (queued) CustomAccessibilityAction(upNext?.title ?: "") { onNext(); true } else null,
                    )
                },
        ) {
            ProgressLine(player.progress, Modifier.align(Alignment.TopStart), buffering = player.buffering)
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(64.dp)
                    .offset { IntOffset(horizontal.value.roundToInt(), 0) }
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Artwork(episode.artwork, 44.dp, corner = 10.dp, bordered = false, chapterArtwork = player.chapterArtwork)
                Column(Modifier.weight(1f)) {
                    Text(episode.title, style = Podcst.type.label, color = colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val device = player.castDevice
                    if (device != null) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                            Icon(PodcstIcons.Cast, null, Modifier.size(12.dp), tint = colors.accent)
                            Text(device.ifEmpty { stringResource(R.string.cast) }, style = Podcst.type.meta, color = colors.accent, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    } else {
                        Text(
                            if (player.buffering) stringResource(R.string.loading) else episode.podcastTitle.orEmpty(),
                            style = Podcst.type.meta,
                            color = colors.secondary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                if (player.status == PlaybackStatus.Playing) Equalizer(playing = true)
                Box(
                    Modifier
                        .size(44.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(colors.accent)
                        .clickable(onClick = onToggle)
                        .semantics { contentDescription = playLabel },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(if (player.requested) PodcstIcons.Pause else PodcstIcons.Play, null, Modifier.size(24.dp), tint = colors.onAccent)
                }
            }
            if (horizontal.value < -skipThreshold / 3 && upNext != null) {
                Row(
                    Modifier.align(Alignment.CenterEnd).padding(end = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Column(horizontalAlignment = Alignment.End) {
                        Eyebrow(stringResource(R.string.next), color = colors.accent)
                        Text(upNext.podcastTitle ?: upNext.title, style = Podcst.type.label, color = colors.ink, maxLines = 1)
                    }
                }
            }
            EpisodeMenu(
                EpisodeRowState(
                    episode,
                    starred = state.currentStarred,
                    download = state.download(episode),
                    playing = player.requested,
                    current = true,
                ),
                actions,
                menu,
                onDismiss = { menu = false },
            )
        }
    }
}

