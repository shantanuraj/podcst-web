package app.podcst.feature.player

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.podcst.designsystem.Artwork
import app.podcst.designsystem.ArtworkEpisodeRow
import app.podcst.designsystem.ButtonKind
import app.podcst.designsystem.EpisodeActions
import app.podcst.designsystem.EpisodeRowState
import app.podcst.designsystem.Equalizer
import app.podcst.designsystem.Eyebrow
import app.podcst.designsystem.Format
import app.podcst.designsystem.Message
import app.podcst.designsystem.NotesText
import app.podcst.designsystem.Podcst
import app.podcst.designsystem.PodcstButton
import app.podcst.designsystem.PodcstIcons
import app.podcst.model.Episode
import app.podcst.model.endOf
import app.podcst.playback.PlaybackStatus

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlayerSheetHost(
    state: PlayerScreenState,
    viewModel: PlayerViewModel,
    actions: EpisodeActions,
    selected: PlayerSheet,
    onSelect: (PlayerSheet) -> Unit,
    onDismiss: () -> Unit,
    onOpenEpisode: (Episode) -> Unit,
    onOpenPodcast: (Episode) -> Unit,
) {
    val episode = state.episode ?: return
    val colors = Podcst.colors
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = colors.paper,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
    ) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.92f)) {
            CompactHeader(state, viewModel)
            SeekBar(
                state.player.position,
                state.player.duration,
                state.player.chapters,
                onSeek = viewModel::seek,
                height = 8.dp,
                showTimes = false,
                label = stringResource(R.string.position),
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 2.dp),
            )
            Tabs(state.player.chapters.isNotEmpty(), selected, onSelect, Modifier.padding(horizontal = 20.dp).padding(top = 10.dp))
            when (selected) {
                PlayerSheet.Chapters -> Chapters(state, viewModel)
                PlayerSheet.Notes -> Notes(episode, viewModel, onOpenEpisode, onOpenPodcast)
                PlayerSheet.UpNext -> UpNext(state, viewModel, actions)
            }
        }
    }
}

@Composable
private fun CompactHeader(state: PlayerScreenState, viewModel: PlayerViewModel) {
    val episode = state.episode ?: return
    val colors = Podcst.colors
    val player = state.player
    val label = stringResource(if (player.requested) R.string.pause else R.string.play)
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Artwork(episode.artwork, 56.dp, corner = 10.dp, bordered = false, chapterArtwork = player.chapterArtwork)
        Column(Modifier.weight(1f)) {
            Text(episode.title, style = Podcst.type.rowTitle, color = colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull(episode.podcastTitle, Format.remainingClock(player.remaining).takeIf { player.duration.isPositive() }).joinToString(" · "),
                style = Podcst.type.meta,
                color = colors.secondary,
                maxLines = 1,
            )
        }
        Icon(
            PodcstIcons.Replay10,
            stringResource(R.string.skip_back),
            Modifier.size(28.dp).clip(CircleShape).clickable(onClick = viewModel::skipBack),
            tint = colors.secondary,
        )
        Box(
            Modifier.size(44.dp).clip(CircleShape).background(colors.ink).clickable(role = Role.Button, onClick = viewModel::toggle).semantics { contentDescription = label },
            contentAlignment = Alignment.Center,
        ) {
            Icon(if (player.requested) PodcstIcons.Pause else PodcstIcons.Play, null, Modifier.size(22.dp), tint = colors.paper)
        }
    }
}

@Composable
private fun Tabs(hasChapters: Boolean, selected: PlayerSheet, onSelect: (PlayerSheet) -> Unit, modifier: Modifier = Modifier) {
    val colors = Podcst.colors
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(colors.ink.copy(alpha = 0.07f)).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        PlayerSheet.entries.filter { hasChapters || it != PlayerSheet.Chapters }.forEach { tab ->
            val active = tab == selected
            Box(
                Modifier
                    .weight(1f)
                    .height(36.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (active) colors.ink else androidx.compose.ui.graphics.Color.Transparent)
                    .clickable(role = Role.Tab) { onSelect(tab) }
                    .semantics { this.selected = active },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    stringResource(tab.label),
                    style = if (active) Podcst.type.label.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold) else Podcst.type.label,
                    color = if (active) colors.paper else colors.secondary,
                )
            }
        }
    }
}

@Composable
private fun Chapters(state: PlayerScreenState, viewModel: PlayerViewModel) {
    val colors = Podcst.colors
    val player = state.player
    val chapters = player.chapters
    val current = player.chapterIndex
    val total = player.duration
    LazyColumn(Modifier.fillMaxWidth()) {
        item {
            Eyebrow(
                stringResource(R.string.chapters_summary, chapters.size, Format.length(total)),
                modifier = Modifier.padding(start = 20.dp, top = 20.dp, bottom = 8.dp),
            )
        }
        itemsIndexed(chapters) { index, chapter ->
            val end = chapters.endOf(index, total)
            val length = end - chapter.start
            val playing = index == current
            val played = current != null && index < current
            val fill = if (playing && length.isPositive()) ((player.position - chapter.start) / length).toFloat().coerceIn(0f, 1f) else 0f
            Box(
                Modifier
                    .fillMaxWidth()
                    .alpha(if (played) 0.5f else 1f)
                    .clickable { viewModel.seek(chapter.start) }
                    .drawBehind {
                        drawLine(colors.rule, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx())
                    },
            ) {
                if (fill > 0f) Box(Modifier.matchParentSize().padding(end = 0.dp).fillMaxWidth(fill).background(colors.accent.copy(alpha = 0.12f)))
                Row(
                    Modifier.padding(horizontal = 20.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text(Format.clock(chapter.start), style = Podcst.type.tabular.copy(fontSize = Podcst.type.caption.fontSize), color = if (playing) colors.accent else colors.tertiary, modifier = Modifier.width(52.dp))
                    Column(Modifier.weight(1f)) {
                        Text(chapter.title, style = Podcst.type.rowTitle, color = colors.ink)
                        if (length.isPositive()) Text(Format.length(length), style = Podcst.type.meta, color = colors.tertiary, modifier = Modifier.padding(top = 2.dp))
                    }
                    if (playing) Equalizer(playing = player.status == PlaybackStatus.Playing)
                }
            }
        }
    }
}

@Composable
private fun Notes(episode: Episode, viewModel: PlayerViewModel, onOpenEpisode: (Episode) -> Unit, onOpenPodcast: (Episode) -> Unit) {
    val colors = Podcst.colors
    Box(Modifier.fillMaxWidth()) {
        LazyColumn(Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
            item {
                Eyebrow(
                    listOfNotNull(episode.published?.let(Format::date), episode.duration?.let(Format::length)).joinToString(" · "),
                    modifier = Modifier.padding(top = 22.dp, bottom = 14.dp),
                )
            }
            item {
                NotesText(episode.notes.ifEmpty { stringResource(R.string.no_notes) }, onTimestamp = viewModel::seek)
            }
            item { Box(Modifier.height(96.dp)) }
        }
        Row(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(colors.paper).padding(horizontal = 20.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            PodcstButton(stringResource(R.string.episode_page), { onOpenEpisode(episode) }, Modifier.weight(1f), kind = ButtonKind.Surface, icon = PodcstIcons.ChevronRight)
            PodcstButton(stringResource(R.string.go_to_podcast), { onOpenPodcast(episode) }, Modifier.weight(1f), kind = ButtonKind.Surface, icon = PodcstIcons.Library)
        }
    }
}

@Composable
private fun UpNext(state: PlayerScreenState, viewModel: PlayerViewModel, actions: EpisodeActions) {
    val upNext = state.player.queue.upNext
    if (upNext.isEmpty()) {
        Message(stringResource(R.string.queue_empty), detail = stringResource(R.string.queue_empty_detail))
        return
    }
    LazyColumn(Modifier.fillMaxWidth().padding(top = 8.dp)) {
        itemsIndexed(upNext, key = { _, episode -> episode.identity.value }) { _, episode ->
            ArtworkEpisodeRow(
                EpisodeRowState(episode, starred = episode.id in state.starred, download = state.download(episode)),
                actions,
                subtitle = episode.podcastTitle,
            )
        }
    }
}
