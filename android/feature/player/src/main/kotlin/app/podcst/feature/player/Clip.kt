package app.podcst.feature.player

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.podcst.designsystem.ButtonKind
import app.podcst.designsystem.Eyebrow
import app.podcst.designsystem.Format
import app.podcst.designsystem.LocalToaster
import app.podcst.designsystem.Pill
import app.podcst.designsystem.Podcst
import app.podcst.designsystem.PodcstButton
import app.podcst.designsystem.PodcstIcons
import app.podcst.designsystem.RoundIcon
import app.podcst.designsystem.speed
import app.podcst.playback.PlayerState
import app.podcst.playback.SharedClip

@Composable
internal fun ClipProgress(player: PlayerState, clip: SharedClip, onSeek: (kotlin.time.Duration) -> Unit, modifier: Modifier = Modifier) {
    val colors = Podcst.colors
    val duration = player.duration.takeIf { it.isPositive() }
    Column(modifier) {
        player.clipChapter?.let { Eyebrow(it.title, color = colors.accent) }
        SeekBar(
            player.position,
            clip.end,
            emptyList(),
            onSeek = onSeek,
            label = stringResource(R.string.position),
            start = clip.start,
            endLabel = stringResource(R.string.clip_ends, Format.clock(clip.end)),
        )
        if (duration != null) {
            val track = colors.track
            val accent = colors.accent
            Canvas(Modifier.fillMaxWidth().padding(top = 10.dp).height(4.dp)) {
                val from = size.width * (clip.start / duration).toFloat().coerceIn(0f, 1f)
                val to = size.width * (clip.end / duration).toFloat().coerceIn(0f, 1f)
                drawRoundRect(track, Offset(0f, size.height / 4), Size(size.width, size.height / 2), CornerRadius(size.height / 4))
                drawRoundRect(accent, Offset(from, 0f), Size((to - from).coerceAtLeast(2.dp.toPx()), size.height), CornerRadius(size.height / 2))
            }
        }
        Text(
            if (duration != null) stringResource(R.string.clip_range_of, Format.clock(clip.start), Format.clock(clip.end), Format.length(duration))
            else stringResource(R.string.clip_range, Format.clock(clip.start), Format.clock(clip.end)),
            style = Podcst.type.meta,
            color = colors.muted,
            modifier = Modifier.padding(top = 6.dp),
        )
    }
}

@Composable
internal fun ClipTransport(state: PlayerScreenState, viewModel: PlayerViewModel, modifier: Modifier = Modifier) {
    val colors = Podcst.colors
    val player = state.player
    val label = stringResource(if (player.requested) R.string.pause else R.string.play)
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        RoundIcon(PodcstIcons.Replay, stringResource(if (player.clip?.chapter != null) R.string.replay_chapter else R.string.replay_clip), viewModel::replayClip, size = 56.dp, iconSize = 24.dp)
        Box(
            Modifier
                .width(132.dp)
                .height(80.dp)
                .clip(RoundedCornerShape(28.dp))
                .background(colors.accent)
                .clickable(role = Role.Button, onClick = viewModel::toggle)
                .semantics { contentDescription = label },
            contentAlignment = Alignment.Center,
        ) {
            Icon(if (player.requested) PodcstIcons.Pause else PodcstIcons.Play, null, Modifier.size(36.dp), tint = colors.onAccent)
        }
        val speed = Format.speed(player.speed)
        val description = stringResource(R.string.speed_value, speed)
        Box(
            Modifier
                .size(56.dp)
                .clip(CircleShape)
                .background(colors.surface)
                .clickable(role = Role.Button, onClick = viewModel::cycleSpeed)
                .semantics { contentDescription = description },
            contentAlignment = Alignment.Center,
        ) {
            Text(Format.speed(player.effectiveSpeed), style = Podcst.type.chip, color = colors.ink)
        }
    }
}

@Composable
internal fun ClipActions(state: PlayerScreenState, viewModel: PlayerViewModel, modifier: Modifier = Modifier) {
    val toaster = LocalToaster.current
    val failed = stringResource(R.string.subscribe_failed)
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Pill(stringResource(R.string.play_full_episode), onClick = { viewModel.keepClip(play = false) })
        if (!state.following) Pill(stringResource(R.string.subscribe), onClick = { viewModel.subscribe { toaster.show(failed, it.message) } })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClipEndSheet(state: PlayerScreenState, viewModel: PlayerViewModel) {
    val player = state.player
    val clip = player.clip?.takeIf { it.ended } ?: return
    val episode = state.episode ?: return
    val colors = Podcst.colors
    val chapter = player.clipChapter
    val following = player.followingChapter
    ModalBottomSheet(
        onDismissRequest = viewModel::closeClip,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = colors.surface,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 22.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Eyebrow(
                clip.chapter?.let { stringResource(R.string.chapter_ended, it, player.chapters.size) }
                    ?: stringResource(R.string.clip_ended, stringResource(R.string.clip_range, Format.clock(clip.start), Format.clock(clip.end))),
            )
            Text(chapter?.title ?: episode.title, style = Podcst.type.headline, color = colors.ink, textAlign = TextAlign.Center)
            state.saved?.let {
                Text(stringResource(R.string.saved_place, Format.clock(it.position)), style = Podcst.type.caption, color = colors.tertiary, textAlign = TextAlign.Center)
            }
            Column(Modifier.fillMaxWidth().padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (following != null) {
                    val title = player.chapters.getOrNull(following.number - 1)?.title.orEmpty()
                    NextChapter(title, Format.length(following.end - following.start), viewModel::nextClipChapter)
                } else {
                    PodcstButton(
                        stringResource(R.string.keep_listening, Format.clock(clip.end)),
                        { viewModel.keepClip(play = true) },
                        Modifier.fillMaxWidth(),
                        icon = PodcstIcons.Play,
                        height = 52.dp,
                        corner = 16.dp,
                    )
                }
                PodcstButton(
                    stringResource(if (clip.chapter != null) R.string.replay_chapter else R.string.replay_clip),
                    viewModel::replayClip,
                    Modifier.fillMaxWidth(),
                    kind = ButtonKind.Surface,
                    height = 52.dp,
                    corner = 16.dp,
                )
                PodcstButton(stringResource(R.string.add_episode_to_queue), viewModel::queueClip, Modifier.fillMaxWidth(), kind = ButtonKind.Surface, height = 52.dp, corner = 16.dp)
                Box(
                    Modifier.fillMaxWidth().height(44.dp).clip(RoundedCornerShape(16.dp)).clickable(role = Role.Button, onClick = viewModel::closeClip),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(stringResource(R.string.close), style = Podcst.type.label, color = colors.secondary)
                }
            }
        }
    }
}

@Composable
private fun NextChapter(title: String, length: String, onClick: () -> Unit) {
    val colors = Podcst.colors
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 60.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(colors.accent)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(PodcstIcons.Play, null, Modifier.size(16.dp), tint = colors.onAccent)
        Column {
            Text(stringResource(R.string.next_chapter), style = Podcst.type.button, color = colors.onAccent)
            Text(listOf(title, length).filter { it.isNotEmpty() }.joinToString(" · "), style = Podcst.type.meta, color = colors.onAccent.copy(alpha = 0.85f))
        }
    }
}
