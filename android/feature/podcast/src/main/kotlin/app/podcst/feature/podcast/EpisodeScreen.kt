package app.podcst.feature.podcast

import android.text.format.DateUtils
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.podcst.designsystem.Artwork
import app.podcst.designsystem.ButtonKind
import app.podcst.designsystem.EpisodeActions
import app.podcst.designsystem.Eyebrow
import app.podcst.designsystem.Format
import app.podcst.designsystem.Hairline
import app.podcst.designsystem.MenuDivider
import app.podcst.designsystem.MenuEntry
import app.podcst.designsystem.NotesText
import app.podcst.designsystem.Podcst
import app.podcst.designsystem.PodcstButton
import app.podcst.designsystem.PodcstIcons
import app.podcst.designsystem.pressable
import app.podcst.model.DownloadState
import app.podcst.model.Episode
import app.podcst.model.EpisodeProgress
import app.podcst.designsystem.R as DesignR

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EpisodeScreen(
    state: EpisodeScreenState,
    viewModel: EpisodeViewModel,
    actions: EpisodeActions,
    onBack: () -> Unit,
    onOpenPodcast: () -> Unit,
) {
    val colors = Podcst.colors
    val episode = state.episode
    val website = webpage(episode.link)
    val uri = LocalUriHandler.current
    Column(Modifier.fillMaxSize().background(colors.paper)) {
        TopAppBar(
            title = {
                Text(episode.podcastTitle.orEmpty(), style = Podcst.type.callout, color = colors.accent, maxLines = 1, overflow = TextOverflow.Ellipsis)
            },
            navigationIcon = {
                IconButton(onClick = onBack) { Icon(PodcstIcons.Back, stringResource(DesignR.string.back), tint = colors.accent) }
            },
            actions = { Overflow(state, actions, onOpenPodcast) },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = colors.paper, actionIconContentColor = colors.ink),
        )
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 28.dp)) {
            Row(Modifier.padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Bottom) {
                Artwork(episode.artwork, 96.dp, corner = 12.dp)
                Eyebrow(dateline(episode))
            }
            Text(episode.title, style = Podcst.type.title, color = colors.ink, modifier = Modifier.padding(top = 18.dp).semantics { heading() })
            Byline(episode, onOpenPodcast, Modifier.padding(top = 6.dp))
            Row(Modifier.padding(top = 20.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PrimaryAction(state.button, onClick = { actions.play(episode) }, modifier = Modifier.weight(1f))
                StarButton(state.starred, onStar = { actions.star(episode, !state.starred) }, onAddToList = { actions.addToList(episode) })
                Square(PodcstIcons.Queue, stringResource(DesignR.string.add_to_queue), onClick = { actions.enqueue(episode) })
            }
            state.progress?.let { LastPlayed(it, Modifier.padding(top = 8.dp)) }
            Hairline(Modifier.padding(top = 22.dp, bottom = 18.dp))
            if (episode.notes.isBlank()) {
                Text(stringResource(R.string.no_notes), style = Podcst.type.notes, color = colors.secondary)
            } else {
                NotesText(episode.notes, onTimestamp = viewModel::seek)
            }
            if (website != null) {
                Box(Modifier.padding(top = 12.dp).heightIn(min = 48.dp).clickable(role = Role.Button) { uri.openUri(website.url) }, contentAlignment = Alignment.CenterStart) {
                    Text(stringResource(R.string.open_episode_website), style = Podcst.type.label, color = colors.accent)
                }
            }
        }
    }
}

@Composable
private fun Overflow(state: EpisodeScreenState, actions: EpisodeActions, onOpenPodcast: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    val episode = state.episode
    Box {
        IconButton(onClick = { open = true }) { Icon(PodcstIcons.MoreVertical, stringResource(DesignR.string.more)) }
        DropdownMenu(open, onDismissRequest = { open = false }, shape = RoundedCornerShape(14.dp), containerColor = Podcst.colors.elevated) {
            if (episode.shareUrl() != null) MenuEntry(stringResource(DesignR.string.share), PodcstIcons.Share) { open = false; actions.share(episode) }
            if (!state.download.removable) {
                MenuEntry(stringResource(DesignR.string.download), PodcstIcons.Download) { open = false; actions.download(episode) }
            } else {
                MenuEntry(stringResource(DesignR.string.remove_download), PodcstIcons.Download) { open = false; actions.removeDownload(episode) }
            }
            MenuEntry("Reapply saved progress", PodcstIcons.CheckCircle) { open = false; actions.reapplyProgress(episode) }
            if (state.progress?.completed == true) MenuEntry("Mark unplayed", PodcstIcons.CheckCircle) { open = false; actions.markUnplayed(episode) }
            if (state.progress?.completed != true) MenuEntry(stringResource(DesignR.string.mark_played), PodcstIcons.CheckCircle) { open = false; actions.markPlayed(episode) }
            MenuDivider()
            MenuEntry(stringResource(R.string.go_to_podcast), PodcstIcons.ChevronRight) { open = false; onOpenPodcast() }
        }
    }
}

@Composable
private fun Byline(episode: Episode, onOpenPodcast: () -> Unit, modifier: Modifier = Modifier) {
    val colors = Podcst.colors
    val podcast = episode.podcastTitle?.takeIf { it.isNotBlank() }
    val author = episode.author?.takeIf { it.isNotBlank() && it != podcast }
    if (podcast == null && author == null) return
    val text = buildAnnotatedString {
        if (podcast != null) {
            withLink(LinkAnnotation.Clickable(podcast, TextLinkStyles(SpanStyle(color = colors.ink))) { onOpenPodcast() }) { append(podcast) }
        }
        if (podcast != null && author != null) append(" · ")
        if (author != null) append(author)
    }
    Text(text, style = Podcst.type.body, color = colors.secondary, modifier = modifier)
}

@Composable
private fun PrimaryAction(button: PlayButton, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val label = when (button) {
        PlayButton.Play -> stringResource(DesignR.string.play)
        PlayButton.Played -> stringResource(R.string.play_again)
        is PlayButton.Pause -> stringResource(DesignR.string.pause)
        is PlayButton.Resume -> button.remaining?.let { stringResource(R.string.resume_left, Format.left(it)) } ?: stringResource(R.string.resume)
    }
    val fraction = when (button) {
        is PlayButton.Pause -> button.fraction
        is PlayButton.Resume -> button.fraction
        else -> null
    }
    PodcstButton(label, onClick, modifier, icon = if (button is PlayButton.Pause) PodcstIcons.Pause else PodcstIcons.Play, progress = fraction)
}

@Composable
private fun StarButton(starred: Boolean, onStar: () -> Unit, onAddToList: () -> Unit) {
    val addToList = stringResource(DesignR.string.add_to_list)
    Square(
        if (starred) PodcstIcons.StarFilled else PodcstIcons.Star,
        stringResource(if (starred) DesignR.string.unstar else DesignR.string.star),
        onClick = onStar,
        onLongClick = onAddToList,
        tint = if (starred) Podcst.colors.accent else Podcst.colors.ink,
        modifier = Modifier.semantics { customActions = listOf(CustomAccessibilityAction(addToList) { onAddToList(); true }) },
    )
}

@Composable
private fun Square(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    onLongClick: (() -> Unit)? = null,
    tint: Color = Podcst.colors.ink,
) {
    val colors = Podcst.colors
    val shape = RoundedCornerShape(14.dp)
    Box(
        modifier
            .size(48.dp)
            .clip(shape)
            .background(colors.surface)
            .border(1.dp, colors.rule, shape)
            .pressable(onClick, onLongClick)
            .semantics {
                contentDescription = label
                role = Role.Button
            },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, Modifier.size(20.dp), tint = tint)
    }
}

@Composable
private fun LastPlayed(progress: EpisodeProgress, modifier: Modifier = Modifier) {
    val now = System.currentTimeMillis()
    val relative = DateUtils.getRelativeTimeSpanString(progress.updated.toEpochMilliseconds(), now, DateUtils.MINUTE_IN_MILLIS).toString()
    Text(stringResource(R.string.last_played, relative), style = Podcst.type.tabular, color = Podcst.colors.tertiary, modifier = modifier)
}

private fun dateline(episode: Episode): String = listOfNotNull(
    episode.published?.let(Format::date),
    episode.duration?.takeIf { it.isPositive() }?.let(Format::length),
).joinToString(" · ")
