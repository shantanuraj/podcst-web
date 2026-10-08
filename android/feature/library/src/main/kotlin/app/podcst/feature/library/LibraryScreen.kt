package app.podcst.feature.library

import app.podcst.model.EpisodeList

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.podcst.designsystem.Artwork
import app.podcst.designsystem.ArtworkEpisodeRow
import app.podcst.designsystem.Card
import app.podcst.designsystem.EpisodeActions
import app.podcst.designsystem.ListRow
import app.podcst.designsystem.Message
import app.podcst.designsystem.Podcst
import app.podcst.designsystem.PodcstIcons
import app.podcst.designsystem.RoundIcon
import app.podcst.designsystem.SectionHeader
import app.podcst.designsystem.pressable
import app.podcst.model.Podcast
import app.podcst.designsystem.R as DesignR

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryScreen(
    state: LibraryState,
    actions: EpisodeActions,
    onRefresh: () -> Unit,
    onSettings: () -> Unit,
    onList: (EpisodeList) -> Unit,
    onPodcast: (Podcast) -> Unit,
    onRemoveUnavailable: (Long) -> Unit,
    onTransferGuestProgress: (app.podcst.data.GuestProgressSelection) -> Unit,
) {
    PullToRefreshBox(
        isRefreshing = state.refresh == Refresh.Running,
        onRefresh = onRefresh,
        modifier = Modifier.fillMaxSize().statusBarsPadding(),
    ) {
        LazyColumn(Modifier.fillMaxSize()) {
            item { Header(onSettings) }
            item { Lists(state, onList) }
            if (state.guestProgress.isNotEmpty()) {
                item { SectionHeader("Choose a guest position to use in this account", Modifier.padding(20.dp)) }
                items(state.guestProgress, key = { "guest:${it.accountId}:${it.sourceToken}" }) { selection ->
                    androidx.compose.material3.TextButton(
                        enabled = selection.canTransfer && state.refresh != Refresh.Running,
                        onClick = { onTransferGuestProgress(selection) },
                    ) {
                        Text(if (selection.canTransfer) "Use ${selection.positionSeconds}s${if (selection.completed) " (played)" else ""}: ${selection.episode.title}"
                            else "Resolve this guest episode before transferring: ${selection.episode.title}")
                    }
                }
            }
            items(state.legacyProgress, key = { "legacy:${it.identity.value}" }) { episode ->
                androidx.compose.material3.TextButton(onClick = { actions.reapplyProgress(episode) }) {
                    Text("Reapply old saved progress: ${episode.title}")
                }
            }
            items(state.unavailable, key = { "unavailable:$it" }) { id ->
                androidx.compose.material3.TextButton(onClick = { onRemoveUnavailable(id) }) {
                    Text("Unavailable podcast $id — Unfollow")
                }
            }
            if (state.episodes.isNotEmpty()) {
                item {
                    SectionHeader(stringResource(R.string.continue_and_new), Modifier.padding(start = 20.dp, end = 20.dp, top = 22.dp)) {
                        Text(
                            stringResource(R.string.see_all),
                            style = Podcst.type.chip,
                            color = Podcst.colors.accent,
                            modifier = Modifier.minimumInteractiveComponentSize().pressable(onClick = { onList(EpisodeList.NewReleases) }),
                        )
                    }
                }
                items(state.episodes, key = { it.episode.identity.value }) { row -> ArtworkEpisodeRow(row, actions) }
            }
            when {
                state.podcasts.isNotEmpty() -> {
                    item {
                        SectionHeader(stringResource(R.string.subscriptions), Modifier.padding(start = 20.dp, end = 20.dp, top = 22.dp)) {
                            Text(
                                pluralStringResource(R.plurals.shows, state.podcasts.size, state.podcasts.size),
                                style = Podcst.type.caption,
                                color = Podcst.colors.tertiary,
                            )
                        }
                    }
                    items(state.podcasts.chunked(COLUMNS), key = { row -> row.first().feed }) { row ->
                        Row(Modifier.padding(start = 20.dp, end = 20.dp, top = 14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            row.forEach { podcast -> Cover(podcast, podcast.feed in state.fresh, { onPodcast(podcast) }, Modifier.weight(1f)) }
                            repeat(COLUMNS - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
                !state.loaded || state.refresh == Refresh.Running -> item {
                    Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = Podcst.colors.accent)
                    }
                }
                state.refresh == Refresh.Failed -> item {
                    Message(
                        stringResource(R.string.library_failed),
                        detail = stringResource(R.string.library_failed_detail),
                        action = stringResource(DesignR.string.retry),
                        onAction = onRefresh,
                    )
                }
                else -> item { Message(stringResource(R.string.library_empty), detail = stringResource(R.string.library_empty_detail)) }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun Header(onSettings: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(start = 20.dp, end = 14.dp, top = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            stringResource(R.string.library),
            style = Podcst.type.largeTitle,
            color = Podcst.colors.ink,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        RoundIcon(
            PodcstIcons.Settings,
            stringResource(R.string.settings),
            onSettings,
            Modifier.minimumInteractiveComponentSize(),
            tint = Podcst.colors.secondary,
        )
    }
}

@Composable
private fun Lists(state: LibraryState, onList: (EpisodeList) -> Unit) {
    Card(Modifier.padding(start = 20.dp, end = 20.dp, top = 16.dp).fillMaxWidth()) {
        Column {
            listOf(EpisodeList.Starred to state.starred, EpisodeList.Downloads to state.downloads).forEachIndexed { index, (list, count) ->
                ListRow(
                    stringResource(list.title),
                    onClick = { onList(list) },
                    value = "$count",
                    leading = { ListTile(list.icon, 32.dp, 8.dp) },
                    divider = index == 0,
                )
            }
        }
    }
}

@Composable
private fun Cover(podcast: Podcast, fresh: Boolean, onClick: () -> Unit, modifier: Modifier) {
    val colors = Podcst.colors
    val description = stringResource(if (fresh) R.string.podcast_fresh else R.string.podcast_description, podcast.title, podcast.author)
    BoxWithConstraints(
        modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(10.dp))
            .pressable(onClick = onClick)
            .semantics(mergeDescendants = true) {
                contentDescription = description
                role = Role.Button
            },
    ) {
        Artwork(podcast.cover, maxWidth, corner = 10.dp)
        if (fresh) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(5.dp)
                    .size(13.dp)
                    .clip(CircleShape)
                    .background(colors.accent)
                    .border(2.dp, colors.paper, CircleShape),
            )
        }
    }
}

private const val COLUMNS = 3
