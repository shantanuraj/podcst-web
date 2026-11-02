package app.podcst.feature.discover

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
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
import app.podcst.designsystem.ContentLayout
import app.podcst.designsystem.Eyebrow
import app.podcst.designsystem.Hairline
import app.podcst.designsystem.LocalToaster
import app.podcst.designsystem.Message
import app.podcst.designsystem.Podcst
import app.podcst.designsystem.PodcstButton
import app.podcst.designsystem.PodcstIcons
import app.podcst.designsystem.PodcstTheme
import app.podcst.designsystem.RoundIcon
import app.podcst.designsystem.SectionHeader
import app.podcst.designsystem.artworkTint
import app.podcst.designsystem.rememberArtworkTint
import app.podcst.model.Podcast
import app.podcst.model.ShowNotes
import app.podcst.model.User
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.launch

@Composable
fun Discover(
    viewModel: DiscoverViewModel,
    onSearch: () -> Unit,
    onAccount: () -> Unit,
    onPodcast: (Podcast) -> Unit,
    onPlay: suspend (Podcast) -> Unit,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val toaster = LocalToaster.current
    val title = stringResource(R.string.subscription_failed)
    val playbackFailure = stringResource(R.string.playback_failed)
    val scope = rememberCoroutineScope()
    var starting by remember { mutableStateOf(false) }
    LaunchedEffect(viewModel) { viewModel.subscriptionFailures.collect { toaster.show(title, it) } }
    DiscoverScreen(state, onSearch, onAccount, onPodcast, viewModel::toggle, viewModel::refresh, starting) { podcast ->
        if (!starting) scope.launch {
            starting = true
            try {
                onPlay(podcast)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                toaster.show(playbackFailure, failure.message)
            } finally {
                starting = false
            }
        }
    }
}

@Composable
fun DiscoverScreen(
    state: DiscoverState,
    onSearch: () -> Unit,
    onAccount: () -> Unit,
    onPodcast: (Podcast) -> Unit,
    onToggle: (Podcast) -> Unit,
    onRefresh: () -> Unit,
    starting: Boolean = false,
    onPlay: (Podcast) -> Unit = {},
) {
    val chartState = rememberLazyListState()
    val featureScroll = rememberScrollState()
    val fontScale = LocalDensity.current.fontScale
    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        SearchBar(state.initial, onSearch, onAccount, Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp))
        PullToRefreshBox(state.refreshing, onRefresh, Modifier.fillMaxSize()) {
            BoxWithConstraints(Modifier.fillMaxSize()) {
                val layout = ContentLayout(minOf(maxWidth, 1100.dp) - 32.dp, fontScale)
                val featured = state.featured
                val wide = layout.twoColumns && featured != null
                Column(Modifier.widthIn(max = 1100.dp).fillMaxSize().align(Alignment.TopCenter).padding(horizontal = 16.dp)) {
                    if (wide) DiscoverTitle()
                    Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(layout.gutter)) {
                        if (wide && featured != null) {
                            Column(Modifier.weight(1f).verticalScroll(featureScroll).padding(bottom = 24.dp)) {
                                SectionHeader(stringResource(R.string.top_podcasts), Modifier.padding(bottom = 14.dp))
                                FeaturedHero(featured, state, starting, onPodcast, onToggle, onPlay)
                            }
                        }
                        LazyColumn(
                            Modifier.weight(1f).fillMaxHeight(),
                            state = chartState,
                            contentPadding = PaddingValues(bottom = 24.dp),
                        ) {
                            item(key = "heading") {
                                if (wide) {
                                    SectionHeader(stringResource(R.string.the_chart), Modifier.padding(bottom = 24.dp))
                                } else {
                                    DiscoverTitle()
                                }
                            }
                            item(key = "chart-failure") {
                                if (featured != null && state.load == ChartLoad.Failed) ChartFailure(onRefresh)
                            }
                            item(key = "featured") {
                                if (featured != null && !wide) FeaturedCard(featured, state, onPodcast, onToggle)
                            }
                            when {
                                featured != null -> items(state.ranked, key = { it.podcast.identity }) { ranked ->
                                    RankedRow(ranked, state.subscribed(ranked.podcast), onPodcast, onToggle, wide)
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
        }
    }
}

@Composable
private fun DiscoverTitle() {
    Text(
        stringResource(R.string.discover),
        style = Podcst.type.largeTitle,
        color = Podcst.colors.ink,
        modifier = Modifier.padding(start = 4.dp, top = 22.dp, bottom = 18.dp).semantics { heading() },
    )
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
private fun FeaturedHero(
    podcast: Podcast,
    state: DiscoverState,
    starting: Boolean,
    onPodcast: (Podcast) -> Unit,
    onToggle: (Podcast) -> Unit,
    onPlay: (Podcast) -> Unit,
) {
    val colors = Podcst.colors
    val tint = rememberArtworkTint(podcast.cover)
    val description = remember(podcast.description) { ShowNotes.plainText(podcast.description).replace(Regex("\\s+"), " ").trim() }
    val subscribed = state.subscribed(podcast)
    var height by remember { mutableIntStateOf(0) }
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .artworkTint(tint, { height }, { 0 }, { 0 })
            .onSizeChanged { height = it.height }
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Artwork(
            podcast.cover,
            200.dp,
            Modifier.clickable(role = Role.Button) { onPodcast(podcast) },
            corner = 16.dp,
            bordered = false,
            contentDescription = stringResource(R.string.podcast_description, podcast.title, podcast.author),
            tint = tint,
        )
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Eyebrow(stringResource(R.string.number_one, state.region.code), color = colors.accent)
            Text(
                podcast.title,
                style = Podcst.type.title,
                color = colors.ink,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.clickable(role = Role.Button) { onPodcast(podcast) },
            )
            Text(podcast.author, style = Podcst.type.caption, color = colors.secondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (description.isNotEmpty()) {
            Text(description, style = Podcst.type.body, color = colors.secondary, maxLines = 5, overflow = TextOverflow.Ellipsis)
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            PodcstButton(
                stringResource(if (subscribed) R.string.subscribed else R.string.subscribe),
                onClick = { onToggle(podcast) },
                kind = if (subscribed) ButtonKind.Outline else ButtonKind.Accent,
                icon = if (subscribed) PodcstIcons.Check else null,
                height = 44.dp,
                corner = 22.dp,
            )
            PodcstButton(
                stringResource(R.string.play_latest),
                onClick = { onPlay(podcast) },
                kind = ButtonKind.Outline,
                icon = PodcstIcons.Play,
                height = 44.dp,
                corner = 22.dp,
                loading = starting,
                enabled = (podcast.id ?: 0) > 0,
            )
        }
    }
}

@Composable
private fun RankedRow(ranked: RankedPodcast, subscribed: Boolean, onPodcast: (Podcast) -> Unit, onToggle: (Podcast) -> Unit, wide: Boolean) {
    val colors = Podcst.colors
    val podcast = ranked.podcast
    val description = stringResource(R.string.ranked_description, ranked.rank, podcast.title, podcast.author)
    Column {
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
                    Text(podcast.title, style = Podcst.type.rowTitle, color = colors.ink, maxLines = if (wide) 2 else 1, overflow = TextOverflow.Ellipsis)
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
        if (wide) Hairline()
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
