package app.podcst.feature.discover

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.podcst.designsystem.Artwork
import app.podcst.designsystem.ButtonKind
import app.podcst.designsystem.Card
import app.podcst.designsystem.Eyebrow
import app.podcst.designsystem.LocalToaster
import app.podcst.designsystem.Message
import app.podcst.designsystem.Podcst
import app.podcst.designsystem.PodcstButton
import app.podcst.designsystem.PodcstIcons
import app.podcst.designsystem.PodcstTheme
import app.podcst.designsystem.RoundIcon
import app.podcst.model.Podcast
import app.podcst.model.User

@Composable
fun Discover(
    viewModel: DiscoverViewModel,
    onSearch: () -> Unit,
    onAccount: () -> Unit,
    onPodcast: (Podcast) -> Unit,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val toaster = LocalToaster.current
    val title = stringResource(R.string.subscription_failed)
    LaunchedEffect(viewModel) { viewModel.subscriptionFailures.collect { toaster.show(title, it) } }
    DiscoverScreen(state, onSearch, onAccount, onPodcast, viewModel::toggle, viewModel::refresh)
}

@Composable
fun DiscoverScreen(
    state: DiscoverState,
    onSearch: () -> Unit,
    onAccount: () -> Unit,
    onPodcast: (Podcast) -> Unit,
    onToggle: (Podcast) -> Unit,
    onRefresh: () -> Unit,
) {
    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        SearchBar(state.initial, onSearch, onAccount, Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp))
        PullToRefreshBox(state.refreshing, onRefresh, Modifier.fillMaxSize()) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp)) {
                item {
                    Text(
                        stringResource(R.string.discover),
                        style = Podcst.type.largeTitle,
                        color = Podcst.colors.ink,
                        modifier = Modifier.padding(start = 4.dp, top = 22.dp, bottom = 18.dp).semantics { heading() },
                    )
                }
                val featured = state.featured
                when {
                    featured != null -> {
                        if (state.load == ChartLoad.Failed) item { ChartFailure(onRefresh) }
                        item { FeaturedCard(featured, state, onPodcast, onToggle) }
                        items(state.ranked, key = { it.podcast.identity }) { ranked ->
                            RankedRow(ranked, state.subscribed(ranked.podcast), onPodcast, onToggle)
                        }
                    }
                    state.load == ChartLoad.Loading -> item { ChartSkeleton() }
                    state.load == ChartLoad.Failed -> item {
                        Message(
                            stringResource(R.string.chart_unavailable),
                            detail = stringResource(R.string.chart_unavailable_detail),
                            action = stringResource(R.string.retry),
                            onAction = onRefresh,
                        )
                    }
                    else -> item { Message(stringResource(R.string.chart_empty)) }
                }
            }
        }
    }
}

@Composable
private fun SearchBar(initial: String?, onSearch: () -> Unit, onAccount: () -> Unit, modifier: Modifier = Modifier) {
    val colors = Podcst.colors
    Row(
        modifier
            .fillMaxWidth()
            .height(52.dp)
            .clip(RoundedCornerShape(26.dp))
            .background(colors.surface)
            .clickable(role = Role.Button, onClick = onSearch)
            .padding(start = 18.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(PodcstIcons.Search, null, Modifier.size(22.dp), tint = colors.secondary)
        Text(
            stringResource(R.string.search_placeholder),
            style = Podcst.type.body,
            color = colors.secondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        val account = stringResource(R.string.account)
        Box(
            Modifier
                .size(40.dp)
                .clip(CircleShape)
                .background(colors.accentSubtle)
                .clickable(role = Role.Button, onClick = onAccount)
                .semantics { contentDescription = account },
            contentAlignment = Alignment.Center,
        ) {
            if (initial != null) {
                Text(initial, style = Podcst.type.rank, color = colors.accent)
            } else {
                Icon(PodcstIcons.Person, null, Modifier.size(20.dp), tint = colors.accent)
            }
        }
    }
}

@Composable
private fun FeaturedCard(podcast: Podcast, state: DiscoverState, onPodcast: (Podcast) -> Unit, onToggle: (Podcast) -> Unit) {
    val colors = Podcst.colors
    val subscribed = state.subscribed(podcast)
    val description = stringResource(R.string.ranked_description, 1, podcast.title, podcast.author)
    Card(Modifier.fillMaxWidth(), corner = 20.dp) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable { onPodcast(podcast) }
                .padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Artwork(podcast.cover, 112.dp, corner = 14.dp, bordered = false)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Column(Modifier.semantics(mergeDescendants = true) { contentDescription = description }) {
                    Eyebrow(stringResource(R.string.number_one, state.region.code), color = colors.accent)
                    Text(podcast.title, style = Podcst.type.section, color = colors.ink, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    Text(podcast.author, style = Podcst.type.caption, color = colors.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.height(5.dp))
                PodcstButton(
                    stringResource(if (subscribed) R.string.subscribed else R.string.subscribe),
                    onClick = { onToggle(podcast) },
                    kind = if (subscribed) ButtonKind.Outline else ButtonKind.Accent,
                    icon = if (subscribed) PodcstIcons.Check else null,
                    height = 36.dp,
                    corner = 18.dp,
                )
            }
        }
    }
}

@Composable
private fun RankedRow(ranked: RankedPodcast, subscribed: Boolean, onPodcast: (Podcast) -> Unit, onToggle: (Podcast) -> Unit) {
    val colors = Podcst.colors
    val podcast = ranked.podcast
    val description = stringResource(R.string.ranked_description, ranked.rank, podcast.title, podcast.author)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable { onPodcast(podcast) }
            .padding(horizontal = 4.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(
            Modifier.weight(1f).semantics(mergeDescendants = true) { contentDescription = description },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("${ranked.rank}", style = Podcst.type.rank, color = colors.muted, modifier = Modifier.width(24.dp), maxLines = 1, textAlign = TextAlign.Center)
            Artwork(podcast.cover, 52.dp, corner = 12.dp, bordered = false)
            Column(Modifier.weight(1f)) {
                Text(podcast.title, style = Podcst.type.rowTitle, color = colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(podcast.author, style = Podcst.type.meta, color = colors.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        RoundIcon(
            if (subscribed) PodcstIcons.Check else PodcstIcons.Plus,
            stringResource(if (subscribed) R.string.unsubscribe_from else R.string.subscribe_to, podcast.title),
            onClick = { onToggle(podcast) },
            size = 40.dp,
            background = Color.Transparent,
            tint = if (subscribed) colors.accent else colors.secondary,
        )
    }
}

@Composable
private fun ChartFailure(onRetry: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.chart_unavailable), style = Podcst.type.caption, color = Podcst.colors.secondary, modifier = Modifier.weight(1f))
        PodcstButton(stringResource(R.string.retry), onRetry, kind = ButtonKind.Outline, height = 36.dp, corner = 18.dp)
    }
}

@Composable
private fun ChartSkeleton() {
    val colors = Podcst.colors
    Column {
        Box(Modifier.fillMaxWidth().height(140.dp).clip(RoundedCornerShape(20.dp)).background(colors.surface))
        repeat(6) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Spacer(Modifier.width(24.dp))
                Box(Modifier.size(52.dp).clip(RoundedCornerShape(12.dp)).background(colors.surface))
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.width(160.dp).height(14.dp).clip(RoundedCornerShape(4.dp)).background(colors.surface))
                    Box(Modifier.width(96.dp).height(10.dp).clip(RoundedCornerShape(4.dp)).background(colors.surface))
                }
            }
        }
    }
}

@Preview
@Composable
private fun DiscoverPreview() {
    val chart = List(5) { Podcast(feed = "feed$it", title = "Podcast ${it + 1}", author = "Author ${it + 1}") }
    PodcstTheme {
        Box(Modifier.background(Podcst.colors.paper)) {
            DiscoverScreen(
                DiscoverState(chart = chart, load = ChartLoad.Loaded, subscribed = setOf("local:feed2"), user = User("1", "shantanu@example.com")),
                onSearch = {},
                onAccount = {},
                onPodcast = {},
                onToggle = {},
                onRefresh = {},
            )
        }
    }
}
