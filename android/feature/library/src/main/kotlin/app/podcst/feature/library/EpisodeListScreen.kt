package app.podcst.feature.library

import app.podcst.model.EpisodeList

import android.text.format.Formatter
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import app.podcst.designsystem.ArtworkEpisodeRow
import app.podcst.designsystem.ButtonKind
import app.podcst.designsystem.EpisodeActions
import app.podcst.designsystem.SwipeAction
import app.podcst.designsystem.EpisodeRowState
import app.podcst.designsystem.Facet
import app.podcst.designsystem.Format
import app.podcst.designsystem.LocalToaster
import app.podcst.designsystem.MenuEntry
import app.podcst.designsystem.Message
import app.podcst.designsystem.Podcst
import app.podcst.designsystem.PodcstButton
import app.podcst.designsystem.PodcstIcons
import app.podcst.designsystem.RoundIcon
import app.podcst.model.DownloadState
import app.podcst.model.ReleaseSection
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.time.Clock
import kotlin.time.Duration
import app.podcst.designsystem.R as DesignR

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EpisodeListScreen(state: EpisodeListState, model: EpisodeListViewModel, actions: EpisodeActions, onBack: () -> Unit) {
    val content = @Composable {
        LazyColumn(Modifier.fillMaxSize()) {
            item { Header(state, onBack) }
            when {
                !state.loaded -> Unit
                state.rows.isEmpty() -> item { Empty(state.list) }
                else -> when (state.list) {
                    EpisodeList.Starred -> starred(state, model, actions)
                    EpisodeList.Downloads -> downloads(state, model, actions)
                    EpisodeList.NewReleases -> releases(state, actions)
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
    if (state.list == EpisodeList.NewReleases) {
        PullToRefreshBox(state.refresh == Refresh.Running, model::refresh, Modifier.fillMaxSize().statusBarsPadding()) { content() }
    } else {
        Box(Modifier.fillMaxSize().statusBarsPadding()) { content() }
    }
}

@Composable
private fun Header(state: EpisodeListState, onBack: () -> Unit) {
    val colors = Podcst.colors
    val context = LocalContext.current
    val count = pluralStringResource(R.plurals.episodes, state.rows.size, state.rows.size)
    val extent = when (state.list) {
        EpisodeList.Downloads -> state.rows.sumOf { (it.download as? DownloadState.Available)?.bytes ?: 0L }.takeIf { it > 0 }?.let { Formatter.formatShortFileSize(context, it) }
        else -> state.rows.fold(Duration.ZERO) { total, row -> total + (row.episode.duration ?: Duration.ZERO) }.takeIf { it.isPositive() }?.let(Format::length)
    }
    Column {
        Row(
            Modifier
                .padding(start = 4.dp, top = 4.dp)
                .height(48.dp)
                .clip(RoundedCornerShape(24.dp))
                .clickable(role = Role.Button, onClick = onBack)
                .padding(start = 4.dp, end = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(PodcstIcons.Back, null, Modifier.size(22.dp), tint = colors.accent)
            Text(stringResource(R.string.library), style = Podcst.type.body, color = colors.accent)
        }
        Row(Modifier.padding(start = 20.dp, end = 20.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ListTile(state.list.icon, 52.dp, 12.dp)
            Column {
                Text(stringResource(state.list.title), style = Podcst.type.title, color = colors.ink, modifier = Modifier.semantics { heading() })
                if (state.loaded) {
                    Text(
                        extent?.let { stringResource(R.string.list_meta, count, it) } ?: count,
                        style = Podcst.type.caption,
                        color = colors.tertiary,
                        modifier = Modifier.padding(top = 3.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun Empty(list: EpisodeList) {
    val (title, detail) = when (list) {
        EpisodeList.Starred -> R.string.starred_empty to R.string.starred_empty_detail
        EpisodeList.Downloads -> R.string.downloads_empty to R.string.downloads_empty_detail
        EpisodeList.NewReleases -> R.string.releases_empty to R.string.releases_empty_detail
    }
    Message(stringResource(title), detail = stringResource(detail))
}

private fun LazyListScope.starred(state: EpisodeListState, model: EpisodeListViewModel, actions: EpisodeActions) {
    item {
        val context = LocalContext.current
        val toaster = LocalToaster.current
        Row(Modifier.padding(start = 20.dp, end = 20.dp, top = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PodcstButton(stringResource(R.string.play_all), model::playAll, Modifier.weight(1f), kind = ButtonKind.Ink, icon = PodcstIcons.Play, height = 44.dp, corner = 22.dp)
            PodcstButton(
                stringResource(DesignR.string.add_to_queue),
                {
                    val added = model.enqueueAll()
                    toaster.show(context.resources.getQuantityString(R.plurals.added_to_queue, added, added))
                },
                Modifier.weight(1f),
                kind = ButtonKind.Outline,
                icon = PodcstIcons.Queue,
                height = 44.dp,
                corner = 22.dp,
            )
        }
    }
    item {
        Row(
            Modifier.horizontalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            state.facets.forEach { facet ->
                Facet(facet.filter.label(), facet.count, facet == state.selected, { model.select(facet.filter) })
            }
        }
    }
    item {
        val selected = state.selected ?: return@item
        Caption(stringResource(R.string.filter_count, selected.filter.label(), selected.count)) { SortMenu(state.sort, model::sort) }
    }
    items(state.visible, key = { it.episode.identity.value }) { row ->
        ArtworkEpisodeRow(row, actions, subtitle = row.episode.podcastTitle, trailing = {
            RoundIcon(
                PodcstIcons.StarFilled,
                stringResource(DesignR.string.unstar),
                { actions.star(row.episode, false) },
                Modifier.minimumInteractiveComponentSize(),
                size = 40.dp,
                background = Color.Transparent,
                tint = Podcst.colors.accent,
            )
        })
    }
}

@Composable
private fun ListFilter.label(): String = when (this) {
    ListFilter.All -> stringResource(R.string.filter_all)
    ListFilter.Unplayed -> stringResource(R.string.filter_unplayed)
    ListFilter.InProgress -> stringResource(R.string.filter_in_progress)
    ListFilter.Downloaded -> stringResource(R.string.filter_downloaded)
    is ListFilter.Show -> title
}

@Composable
private fun SortMenu(sort: ListSort, onSort: (ListSort) -> Unit) {
    val colors = Podcst.colors
    var expanded by remember { mutableStateOf(false) }
    val label = sort.label()
    val description = stringResource(R.string.sort_by, label)
    Box {
        Row(
            Modifier
                .minimumInteractiveComponentSize()
                .clickable(role = Role.Button) { expanded = true }
                .semantics { contentDescription = description },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(label, style = Podcst.type.caption, color = colors.ink)
            Icon(PodcstIcons.ChevronDown, null, Modifier.size(14.dp), tint = colors.ink)
        }
        DropdownMenu(expanded, { expanded = false }, shape = RoundedCornerShape(14.dp), containerColor = colors.elevated) {
            ListSort.entries.forEach { option ->
                MenuEntry(option.label(), PodcstIcons.Check.takeIf { option == sort }, tint = colors.accent) {
                    expanded = false
                    onSort(option)
                }
            }
        }
    }
}

@Composable
private fun ListSort.label(): String = stringResource(
    when (this) {
        ListSort.Recent -> R.string.sort_recent
        ListSort.Newest -> R.string.sort_newest
        ListSort.Oldest -> R.string.sort_oldest
    },
)

private fun LazyListScope.downloads(state: EpisodeListState, model: EpisodeListViewModel, actions: EpisodeActions) {
    state.storage?.let { storage -> item { StorageLine(storage) } }
    val (ready, pending) = state.visible.partition { it.download.stored }
    if (pending.isNotEmpty()) {
        item { Caption(stringResource(R.string.downloading_count, pending.size)) }
        items(pending, key = { it.episode.identity.value }) { row ->
            ArtworkEpisodeRow(row, actions, subtitle = progressLabel(row.download), remove = removal(row, actions), trailing = {
                DownloadControl(row.download, { model.pause(row.episode) }, { model.resume(row.episode) }, { actions.download(row.episode) })
            })
        }
    }
    if (ready.isNotEmpty()) {
        item { Caption(stringResource(R.string.ready_count, ready.size)) }
        items(ready, key = { it.episode.identity.value }) { row ->
            ArtworkEpisodeRow(row, actions, subtitle = row.episode.podcastTitle, remove = removal(row, actions), trailing = {
                Text(
                    Formatter.formatShortFileSize(LocalContext.current, (row.download as DownloadState.Available).bytes),
                    style = Podcst.type.meta.copy(fontFamily = FontFamily.Monospace),
                    color = Podcst.colors.tertiary,
                )
            })
        }
    }
}

@Composable
private fun removal(row: EpisodeRowState, actions: EpisodeActions) = SwipeAction(stringResource(R.string.remove)) { actions.removeDownload(row.episode) }

@Composable
private fun StorageLine(storage: Storage) {
    val colors = Podcst.colors
    val context = LocalContext.current
    val used = Formatter.formatShortFileSize(context, storage.used)
    val free = Formatter.formatShortFileSize(context, storage.free)
    val total = storage.total.coerceAtLeast(1).toFloat()
    val description = stringResource(R.string.storage_description, used, free)
    Column(
        Modifier.padding(start = 20.dp, end = 20.dp, top = 16.dp).semantics(mergeDescendants = true) { contentDescription = description },
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).background(colors.rule)) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(((storage.total - storage.free) / total).coerceIn(0f, 1f)).background(colors.faint))
            Box(Modifier.fillMaxHeight().fillMaxWidth((storage.used / total).coerceIn(0f, 1f)).background(colors.accent))
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.size(7.dp).clip(CircleShape).background(colors.accent))
                Text(stringResource(R.string.storage_podcst, used), style = Podcst.type.meta, color = colors.tertiary)
            }
            Text(stringResource(R.string.storage_free, free), style = Podcst.type.meta, color = colors.tertiary)
        }
    }
}

@Composable
private fun progressLabel(download: DownloadState): String = when (download) {
    is DownloadState.Downloading -> amount(download.received, download.total)
    is DownloadState.Paused -> stringResource(R.string.download_paused, amount(download.received, download.total))
    is DownloadState.Failed -> stringResource(R.string.download_failed)
    else -> stringResource(R.string.download_waiting)
}

@Composable
private fun amount(received: Long, total: Long?): String {
    val context = LocalContext.current
    val done = Formatter.formatShortFileSize(context, received)
    return total?.let { stringResource(R.string.download_progress, done, Formatter.formatShortFileSize(context, it)) } ?: done
}

@Composable
private fun DownloadControl(download: DownloadState, onPause: () -> Unit, onResume: () -> Unit, onRetry: () -> Unit) {
    val colors = Podcst.colors
    val (label, action) = when (download) {
        is DownloadState.Paused -> R.string.resume_download to onResume
        is DownloadState.Failed -> R.string.retry_download to onRetry
        else -> R.string.pause_download to onPause
    }
    val description = stringResource(label)
    Box(
        Modifier
            .minimumInteractiveComponentSize()
            .size(36.dp)
            .clip(CircleShape)
            .clickable(role = Role.Button, onClick = action)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        val fraction = download.fraction
        when {
            fraction != null -> CircularProgressIndicator({ fraction }, Modifier.size(30.dp), color = colors.accent, trackColor = colors.rule, strokeWidth = 2.5.dp)
            download.active -> CircularProgressIndicator(Modifier.size(30.dp), color = colors.accent, trackColor = colors.rule, strokeWidth = 2.5.dp)
        }
        when (download) {
            is DownloadState.Paused -> Icon(PodcstIcons.Play, null, Modifier.size(12.dp), tint = colors.ink)
            is DownloadState.Failed -> Icon(PodcstIcons.Download, null, Modifier.size(18.dp), tint = colors.accent)
            else -> Box(Modifier.size(9.dp).clip(RoundedCornerShape(2.dp)).background(colors.ink))
        }
    }
}

private fun LazyListScope.releases(state: EpisodeListState, actions: EpisodeActions) {
    val rows = state.visible.associateBy { it.episode.identity }
    val now = Clock.System.now()
    ReleaseSection.group(state.visible.map { it.episode }).forEachIndexed { index, section ->
        item(key = "section:${section.day}") {
            val recent = section.recent(now)
            Text(
                section.title(now).text(),
                style = if (recent) Podcst.type.label else Podcst.type.caption,
                color = if (recent) Podcst.colors.ink else Podcst.colors.secondary,
                modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = if (index == 0) 16.dp else 24.dp, bottom = 4.dp).semantics { heading() },
            )
        }
        items(section.episodes, key = { it.identity.value }) { episode ->
            ArtworkEpisodeRow(rows.getValue(episode.identity), actions, subtitle = episode.podcastTitle)
        }
    }
}

@Composable
private fun ReleaseSection.Title.text(): String = when (this) {
    ReleaseSection.Title.Today -> stringResource(DesignR.string.today)
    ReleaseSection.Title.Yesterday -> stringResource(DesignR.string.yesterday)
    is ReleaseSection.Title.Weekday -> day.getDisplayName(java.time.format.TextStyle.FULL, Locale.getDefault())
    is ReleaseSection.Title.Date -> DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).format(day)
    ReleaseSection.Title.Unavailable -> stringResource(DesignR.string.date_unavailable)
}

@Composable
private fun Caption(text: String, trailing: @Composable () -> Unit = {}) {
    val rule = Podcst.colors.rule
    Row(
        Modifier
            .padding(start = 20.dp, end = 20.dp, top = 16.dp)
            .fillMaxWidth()
            .drawBehind { drawLine(rule, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }
            .padding(bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(text, style = Podcst.type.caption, color = Podcst.colors.tertiary, modifier = Modifier.padding(vertical = 4.dp).semantics { heading() })
        trailing()
    }
}
