package app.podcst.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import app.podcst.model.DownloadState
import app.podcst.model.Episode
import app.podcst.model.EpisodeProgress
import kotlin.time.Duration

@Immutable
data class EpisodeRowState(
    val episode: Episode,
    val progress: EpisodeProgress? = null,
    val starred: Boolean = false,
    val download: DownloadState = DownloadState.None,
    val playing: Boolean = false,
    val current: Boolean = false,
    val fresh: Boolean = false,
) {
    val played: Boolean get() = progress?.completed == true && !playing
}

data class SwipeAction(val label: String, val run: () -> Unit)

interface EpisodeActions {
    fun open(episode: Episode)
    fun play(episode: Episode)
    fun playNext(episode: Episode)
    fun enqueue(episode: Episode)
    fun star(episode: Episode, starred: Boolean)
    fun addToList(episode: Episode)
    fun download(episode: Episode)
    fun removeDownload(episode: Episode)
    fun markPlayed(episode: Episode)
    fun markUnplayed(episode: Episode)
    fun reapplyProgress(episode: Episode)
    fun share(episode: Episode)
}

@Composable
fun episodeMeta(state: EpisodeRowState, includeLength: Boolean = true): String {
    val progress = state.progress
    val duration = progress?.duration ?: state.episode.duration
    val parts = buildList {
        if (includeLength && duration != null && duration.isPositive()) add(Format.length(duration))
        when {
            state.played -> add(stringResource(R.string.played))
            progress?.started == true -> progress.remaining?.let { add(Format.left(it)) }
        }
    }
    return parts.joinToString(" · ")
}

@Composable
fun DatedEpisodeRow(
    state: EpisodeRowState,
    actions: EpisodeActions,
    modifier: Modifier = Modifier,
) {
    EpisodeGestures(state, actions, modifier) {
        Row(
            Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(Modifier.alpha(if (state.played) 0.5f else 1f)) { DateBlock(state.episode.published) }
            Column(Modifier.weight(1f).alpha(if (state.played) 0.5f else 1f)) {
                Text(state.episode.title, style = Podcst.type.episodeTitle, color = Podcst.colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                MetaLine(state, Modifier.padding(top = 3.dp))
            }
            PlayCircle(state, actions)
        }
    }
}

@Composable
fun ArtworkEpisodeRow(
    state: EpisodeRowState,
    actions: EpisodeActions,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    remove: SwipeAction? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    EpisodeGestures(state, actions, modifier, remove) {
        Row(
            Modifier.heightIn(min = 64.dp).padding(horizontal = 20.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Artwork(state.episode.artwork, 48.dp, modifier = Modifier.alpha(if (state.played) 0.5f else 1f))
            Column(Modifier.weight(1f).alpha(if (state.played) 0.5f else 1f)) {
                Text(state.episode.title, style = Podcst.type.compactTitle, color = Podcst.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                MetaLine(state, Modifier.padding(top = 4.dp), subtitle)
            }
            trailing?.invoke() ?: PlayCircle(state, actions, size = 32)
        }
    }
}

@Composable
private fun MetaLine(state: EpisodeRowState, modifier: Modifier = Modifier, subtitle: String? = null) {
    val colors = Podcst.colors
    val meta = listOfNotNull(subtitle, episodeMeta(state).takeIf { it.isNotEmpty() }).joinToString(" · ")
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        val progress = state.progress
        if (progress?.started == true) progress.fraction?.let { MiniProgress(it) }
        if (state.fresh && progress?.started != true && progress?.completed != true) {
            Box(Modifier.size(7.dp).clip(CircleShape).background(colors.accent))
        }
        if (state.starred) Icon(PodcstIcons.StarFilled, stringResource(R.string.starred), Modifier.size(12.dp), tint = colors.accent)
        when {
            state.download.stored -> Icon(PodcstIcons.Download, stringResource(R.string.downloaded), Modifier.size(12.dp), tint = colors.tertiary)
            state.download.active -> Icon(PodcstIcons.Download, stringResource(R.string.downloading), Modifier.size(12.dp), tint = colors.accent)
        }
        if (meta.isNotEmpty()) Text(meta, style = Podcst.type.meta, color = colors.tertiary, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun PlayCircle(state: EpisodeRowState, actions: EpisodeActions, size: Int = 34) {
    val colors = Podcst.colors
    val label = stringResource(if (state.playing) R.string.pause else R.string.play)
    Box(
        Modifier
            .size(size.dp)
            .clip(CircleShape)
            .border(1.dp, colors.rule, CircleShape)
            .pressable(onClick = { actions.play(state.episode) }),
        contentAlignment = Alignment.Center,
    ) {
        if (state.current && state.playing) {
            Equalizer(playing = true, modifier = Modifier.height(12.dp))
        } else {
            Icon(PodcstIcons.Play, label, Modifier.size(14.dp), tint = colors.ink)
        }
    }
}

@Composable
private fun EpisodeGestures(
    state: EpisodeRowState,
    actions: EpisodeActions,
    modifier: Modifier,
    remove: SwipeAction? = null,
    content: @Composable () -> Unit,
) {
    val colors = Podcst.colors
    var menu by remember { mutableStateOf(false) }
    val swipe = rememberSwipeToDismissBoxState()
    val starLabel = stringResource(if (state.starred) R.string.unstar else R.string.star)
    LaunchedEffect(swipe.currentValue) {
        when (swipe.currentValue) {
            SwipeToDismissBoxValue.StartToEnd -> actions.star(state.episode, !state.starred)
            SwipeToDismissBoxValue.EndToStart -> remove?.run?.invoke()
            SwipeToDismissBoxValue.Settled -> return@LaunchedEffect
        }
        swipe.reset()
    }
    SwipeToDismissBox(
        state = swipe,
        enableDismissFromEndToStart = remove != null,
        backgroundContent = {
            if (swipe.dismissDirection == SwipeToDismissBoxValue.EndToStart && remove != null) {
                Box(Modifier.fillMaxSize().background(PodcstColors.Light.accent).padding(end = 18.dp), contentAlignment = Alignment.CenterEnd) {
                    Text(remove.label, style = Podcst.type.button, color = colors.onAccent)
                }
            } else {
                Box(Modifier.fillMaxSize().background(colors.accent).padding(start = 24.dp), contentAlignment = Alignment.CenterStart) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Icon(if (state.starred) PodcstIcons.Star else PodcstIcons.StarFilled, null, Modifier.size(20.dp), tint = colors.onAccent)
                        Text(starLabel, style = Podcst.type.meta, color = colors.onAccent)
                    }
                }
            }
        },
        modifier = modifier,
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .background(colors.paper)
                .drawBehind { drawLine(colors.rule, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }
                .pressable(onClick = { actions.open(state.episode) }, onLongClick = { menu = true })
                .semantics {
                    customActions = listOfNotNull(
                        CustomAccessibilityAction(starLabel) { actions.star(state.episode, !state.starred); true },
                        remove?.let { CustomAccessibilityAction(it.label) { it.run(); true } },
                    )
                },
        ) {
            content()
            EpisodeMenu(state, actions, menu, onDismiss = { menu = false })
        }
    }
}

@Composable
fun EpisodeMenu(state: EpisodeRowState, actions: EpisodeActions, expanded: Boolean, onDismiss: () -> Unit) {
    val colors = Podcst.colors
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        offset = DpOffset(20.dp, 0.dp),
        shape = RoundedCornerShape(14.dp),
        containerColor = colors.elevated,
    ) {
        val episode = state.episode
        MenuEntry(stringResource(R.string.play_next), PodcstIcons.PlayNext) { onDismiss(); actions.playNext(episode) }
        MenuEntry(stringResource(R.string.add_to_queue), PodcstIcons.Queue) { onDismiss(); actions.enqueue(episode) }
        MenuDivider()
        MenuEntry(stringResource(if (state.starred) R.string.unstar else R.string.star), if (state.starred) PodcstIcons.StarFilled else PodcstIcons.Star, tint = if (state.starred) colors.accent else colors.secondary) {
            onDismiss()
            actions.star(episode, !state.starred)
        }
        MenuEntry(stringResource(R.string.add_to_list), PodcstIcons.AddToList) { onDismiss(); actions.addToList(episode) }
        MenuDivider()
        if (!state.download.removable) {
            MenuEntry(stringResource(R.string.download), PodcstIcons.Download) { onDismiss(); actions.download(episode) }
        } else {
            MenuEntry(stringResource(R.string.remove_download), PodcstIcons.Download) { onDismiss(); actions.removeDownload(episode) }
        }
        MenuEntry("Reapply saved progress", PodcstIcons.CheckCircle) { onDismiss(); actions.reapplyProgress(episode) }
        if (state.progress?.completed == true) MenuEntry("Mark unplayed", PodcstIcons.CheckCircle) { onDismiss(); actions.markUnplayed(episode) }
        if (state.progress?.completed != true) MenuEntry(stringResource(R.string.mark_played), PodcstIcons.CheckCircle) { onDismiss(); actions.markPlayed(episode) }
        if (episode.shareUrl != null) MenuEntry(stringResource(R.string.share), PodcstIcons.Share) { onDismiss(); actions.share(episode) }
    }
}

@Composable
fun MenuEntry(
    text: String,
    icon: ImageVector?,
    detail: String? = null,
    tint: Color = Podcst.colors.secondary,
    emphasized: Boolean = false,
    onClick: () -> Unit,
) {
    DropdownMenuItem(
        text = {
            Column(Modifier.width(200.dp)) {
                Text(text, style = if (emphasized) Podcst.type.callout else Podcst.type.body.copy(fontSize = Podcst.type.callout.fontSize), color = Podcst.colors.ink)
                if (detail != null) Text(detail, style = Podcst.type.meta, color = Podcst.colors.tertiary, modifier = Modifier.padding(top = 2.dp))
            }
        },
        trailingIcon = icon?.let { { Icon(it, null, Modifier.size(18.dp), tint = tint) } },
        onClick = onClick,
    )
}

@Composable
fun MenuDivider() {
    HorizontalDivider(Modifier.padding(vertical = 2.dp), thickness = 8.dp, color = Color.Black.copy(alpha = 0.25f))
}

@Composable
fun RemainingLabel(duration: Duration?, position: Duration): String? =
    duration?.takeIf { it.isPositive() }?.let { Format.left((it - position).coerceAtLeast(Duration.ZERO)) }

@Composable
fun Spacing(height: Int) = Spacer(Modifier.height(height.dp))
