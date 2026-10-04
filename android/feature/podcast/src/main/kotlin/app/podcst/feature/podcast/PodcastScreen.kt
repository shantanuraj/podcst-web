package app.podcst.feature.podcast

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.podcst.designsystem.Artwork
import app.podcst.designsystem.ButtonKind
import app.podcst.designsystem.DatedEpisodeRow
import app.podcst.designsystem.EpisodeActions
import app.podcst.designsystem.Eyebrow
import app.podcst.designsystem.Format
import app.podcst.designsystem.LocalToaster
import app.podcst.designsystem.MenuEntry
import app.podcst.designsystem.Message
import app.podcst.designsystem.Podcst
import app.podcst.designsystem.PodcstButton
import app.podcst.designsystem.PodcstIcons
import app.podcst.model.EpisodeSort
import app.podcst.model.SortDirection
import app.podcst.designsystem.R as DesignR

private enum class PodcastTab(val label: Int) { Episodes(R.string.tab_episodes), About(R.string.tab_about) }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PodcastScreen(
    state: PodcastScreenState,
    query: String,
    viewModel: PodcastViewModel,
    actions: EpisodeActions,
    onBack: () -> Unit,
    onShare: (String) -> Unit,
) {
    val colors = Podcst.colors
    val list = rememberLazyListState()
    val scroll = TopAppBarDefaults.pinnedScrollBehavior()
    val collapsed by remember { derivedStateOf { list.firstVisibleItemIndex > 0 } }
    var tab by rememberSaveable { mutableStateOf(PodcastTab.Episodes) }
    Column(Modifier.fillMaxSize().background(colors.paper).nestedScroll(scroll.nestedScrollConnection)) {
        TopAppBar(
            title = {
                AnimatedVisibility(collapsed, enter = fadeIn(), exit = fadeOut()) {
                    Text(state.podcast.title, style = Podcst.type.rowTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            },
            navigationIcon = {
                IconButton(onClick = onBack) { Icon(PodcstIcons.Back, stringResource(DesignR.string.back)) }
            },
            actions = {
                state.podcast.shareUrl?.let { url ->
                    IconButton(onClick = { onShare(url) }) { Icon(PodcstIcons.Share, stringResource(R.string.share_podcast)) }
                }
                Overflow(state, viewModel)
            },
            scrollBehavior = scroll,
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = colors.paper,
                scrolledContainerColor = colors.surface,
                titleContentColor = colors.ink,
                navigationIconContentColor = colors.ink,
                actionIconContentColor = colors.ink,
            ),
        )
        PullToRefreshBox(
            isRefreshing = state.load == LoadState.Refreshing,
            onRefresh = viewModel::refresh,
            modifier = Modifier.weight(1f).fillMaxWidth(),
        ) {
            LazyColumn(Modifier.fillMaxSize(), state = list) {
                item(key = "hero") { Hero(state, viewModel, actions) }
                stickyHeader(key = "tabs") { Tabs(tab) { tab = it } }
                when (tab) {
                    PodcastTab.Episodes -> episodes(state, query, viewModel, actions)
                    PodcastTab.About -> item(key = "about") { About(state) }
                }
            }
        }
    }
}

@Composable
private fun Overflow(state: PodcastScreenState, viewModel: PodcastViewModel) {
    var open by remember { mutableStateOf(false) }
    val uri = LocalUriHandler.current
    val website = webpage(state.podcast.link)
    Box {
        IconButton(onClick = { open = true }) { Icon(PodcstIcons.MoreVertical, stringResource(DesignR.string.more)) }
        DropdownMenu(open, onDismissRequest = { open = false }, shape = RoundedCornerShape(14.dp), containerColor = Podcst.colors.elevated) {
            MenuEntry(stringResource(R.string.refresh), null) { open = false; viewModel.refresh() }
            if (website != null) MenuEntry(stringResource(R.string.open_website), null, detail = website.host) { open = false; uri.openUri(website.url) }
        }
    }
}

@Composable
private fun Hero(state: PodcastScreenState, viewModel: PodcastViewModel, actions: EpisodeActions) {
    val colors = Podcst.colors
    val podcast = state.podcast
    val toaster = LocalToaster.current
    val failure = stringResource(R.string.subscription_failed)
    var expanded by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
        Row(Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Bottom) {
            Artwork(podcast.cover, 132.dp, corner = 16.dp)
            Column(Modifier.padding(bottom = 4.dp)) {
                Text(
                    podcast.title,
                    style = Podcst.type.title.copy(fontSize = 30.sp),
                    color = colors.ink,
                    maxLines = 4,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.semantics { heading() },
                )
                if (podcast.author.isNotBlank()) {
                    Text(podcast.author, style = Podcst.type.body, color = colors.secondary, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
                }
                state.updated?.let { Eyebrow(stringResource(R.string.updated, Format.date(it)), Modifier.padding(top = 4.dp)) }
            }
        }
        Row(Modifier.padding(horizontal = 20.dp).padding(top = 18.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PodcstButton(
                stringResource(if (state.subscribed) R.string.subscribed else R.string.subscribe),
                onClick = { viewModel.toggleSubscription { toaster.show(failure, it.message) } },
                modifier = Modifier.weight(1f),
                kind = if (state.subscribed) ButtonKind.Outline else ButtonKind.Accent,
                icon = PodcstIcons.Check.takeIf { state.subscribed },
                iconTint = colors.accent,
                height = 44.dp,
                corner = 22.dp,
                loading = state.subscribing,
            )
            PodcstButton(
                stringResource(R.string.play_latest),
                onClick = { state.latest?.let(actions::play) },
                modifier = Modifier.weight(1f),
                kind = ButtonKind.Outline,
                icon = PodcstIcons.Play,
                height = 44.dp,
                corner = 22.dp,
                enabled = state.latest != null,
            )
        }
        if (state.description.isNotEmpty()) {
            Text(
                state.description,
                style = Podcst.type.body,
                color = colors.secondary,
                maxLines = if (expanded) Int.MAX_VALUE else 3,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .padding(top = 16.dp)
                    .clickable(onClickLabel = stringResource(if (expanded) R.string.collapse_description else R.string.expand_description)) { expanded = !expanded }
                    .animateContentSize()
                    .padding(horizontal = 20.dp),
            )
        }
    }
}

@Composable
private fun Tabs(selected: PodcastTab, onSelect: (PodcastTab) -> Unit) {
    val colors = Podcst.colors
    Row(
        Modifier
            .fillMaxWidth()
            .background(colors.paper)
            .drawBehind { drawLine(colors.rule, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }
            .padding(horizontal = 20.dp)
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        PodcastTab.entries.forEach { tab ->
            val active = tab == selected
            Box(
                Modifier
                    .heightIn(min = 48.dp)
                    .selectable(active, role = Role.Tab, onClick = { onSelect(tab) })
                    .drawBehind { if (active) drawRect(colors.accent, Offset(0f, size.height - 3.dp.toPx()), size.copy(height = 3.dp.toPx())) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    stringResource(tab.label),
                    style = if (active) Podcst.type.label.copy(fontWeight = FontWeight.SemiBold) else Podcst.type.label,
                    color = if (active) colors.ink else colors.tertiary,
                )
            }
        }
    }
}

private fun LazyListScope.episodes(state: PodcastScreenState, query: String, viewModel: PodcastViewModel, actions: EpisodeActions) {
    item(key = "episodes-header") { EpisodesHeader(state, viewModel) }
    if (state.podcast.episodes.size > FILTER_THRESHOLD) item(key = "filter") { FilterField(query, viewModel::filter) }
    if (state.load == LoadState.Failed) {
        item(key = "failure") {
            if (state.podcast.episodes.isEmpty()) {
                Message(stringResource(R.string.catalogue_failed), action = stringResource(DesignR.string.retry), onAction = viewModel::retry)
            } else {
                FailureRow(viewModel::retry)
            }
        }
    }
    items(state.episodes, key = { it.identity.value }, contentType = { "episode" }) { episode ->
        DatedEpisodeRow(state.marks.row(episode), actions, Modifier.animateItem())
    }
    if (state.episodes.isEmpty()) {
        item(key = "empty") {
            when {
                state.podcast.episodes.isEmpty() && state.load == LoadState.Loading ->
                    Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(Modifier.size(24.dp), color = Podcst.colors.accent, strokeWidth = 2.dp)
                    }
                query.isNotBlank() -> Message(stringResource(R.string.no_matches, query.trim()))
                state.podcast.episodes.isEmpty() && state.load == LoadState.Loaded -> Message(stringResource(R.string.no_episodes))
            }
        }
    }
}

@Composable
private fun EpisodesHeader(state: PodcastScreenState, viewModel: PodcastViewModel) {
    val colors = Podcst.colors
    var open by remember { mutableStateOf(false) }
    val sortLabel = stringResource(R.string.sort_episodes)
    Row(
        Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(pluralStringResource(R.plurals.episode_count, state.count, state.count), style = Podcst.type.caption, color = colors.tertiary, modifier = Modifier.weight(1f))
        if (state.load == LoadState.Loading) CircularProgressIndicator(Modifier.size(14.dp), color = colors.tertiary, strokeWidth = 1.5.dp)
        Box {
            Row(
                Modifier
                    .heightIn(min = 48.dp)
                    .clickable(onClickLabel = sortLabel, role = Role.DropdownList) { open = true }
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(PodcstIcons.Sort, null, Modifier.size(16.dp), tint = colors.secondary)
                Text(stringResource(state.order.label), style = Podcst.type.caption, color = colors.secondary)
            }
            DropdownMenu(open, onDismissRequest = { open = false }, shape = RoundedCornerShape(14.dp), containerColor = colors.elevated) {
                EpisodeOrder.all.forEach { order ->
                    val chosen = order == state.order
                    MenuEntry(stringResource(order.label), PodcstIcons.Check.takeIf { chosen }, tint = colors.accent, emphasized = chosen) {
                        open = false
                        viewModel.order(order)
                    }
                }
            }
        }
    }
}

@Composable
private fun FilterField(query: String, onQuery: (String) -> Unit) {
    val colors = Podcst.colors
    val shape = RoundedCornerShape(12.dp)
    val placeholder = stringResource(R.string.filter_episodes)
    BasicTextField(
        value = query,
        onValueChange = onQuery,
        singleLine = true,
        textStyle = Podcst.type.body.copy(color = colors.ink),
        cursorBrush = SolidColor(colors.accent),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 8.dp)
            .semantics { contentDescription = placeholder },
        decorationBox = { field ->
            Row(
                Modifier.height(44.dp).background(colors.surface, shape).border(1.dp, colors.rule, shape).padding(start = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(PodcstIcons.Search, null, Modifier.size(16.dp), tint = colors.tertiary)
                Box(Modifier.weight(1f)) {
                    if (query.isEmpty()) Text(placeholder, style = Podcst.type.body, color = colors.muted)
                    field()
                }
                if (query.isNotEmpty()) {
                    IconButton(onClick = { onQuery("") }) { Icon(PodcstIcons.Close, stringResource(R.string.clear_filter), Modifier.size(16.dp), tint = colors.tertiary) }
                } else {
                    Spacer(Modifier.size(12.dp))
                }
            }
        },
    )
}

@Composable
private fun FailureRow(onRetry: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.catalogue_failed), style = Podcst.type.caption, color = Podcst.colors.secondary, modifier = Modifier.weight(1f))
        PodcstButton(stringResource(DesignR.string.retry), onRetry, kind = ButtonKind.Outline, height = 36.dp, corner = 18.dp)
    }
}

@Composable
private fun About(state: PodcastScreenState) {
    val colors = Podcst.colors
    val podcast = state.podcast
    val uri = LocalUriHandler.current
    val website = webpage(podcast.link)
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        if (state.description.isNotEmpty()) Text(state.description, style = Podcst.type.notes, color = colors.secondary)
        Column {
            if (website != null) {
                Fact(stringResource(R.string.website)) {
                    Text(
                        website.host,
                        style = Podcst.type.label,
                        color = colors.accent,
                        modifier = Modifier.clickable(role = Role.Button) { uri.openUri(website.url) }.padding(vertical = 4.dp),
                    )
                }
            }
            Fact(stringResource(R.string.episodes)) { Text("${state.count}", style = Podcst.type.label, color = colors.ink) }
            Fact(stringResource(R.string.content)) {
                Text(stringResource(if (podcast.explicit) R.string.explicit else R.string.clean), style = Podcst.type.label, color = colors.ink)
            }
        }
    }
}

@Composable
private fun Fact(label: String, value: @Composable () -> Unit) {
    val rule = Podcst.colors.rule
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .drawBehind { drawLine(rule, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Eyebrow(label)
        value()
    }
}

private val EpisodeOrder.label: Int
    get() = when (sort) {
        EpisodeSort.Published -> if (direction == SortDirection.Descending) R.string.newest_first else R.string.oldest_first
        EpisodeSort.Title -> if (direction == SortDirection.Ascending) R.string.title_ascending else R.string.title_descending
        EpisodeSort.Duration -> if (direction == SortDirection.Descending) R.string.longest_first else R.string.shortest_first
    }

private const val FILTER_THRESHOLD = 10
