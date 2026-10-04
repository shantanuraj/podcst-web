package app.podcst.feature.discover

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.podcst.designsystem.Artwork
import app.podcst.designsystem.ButtonKind
import app.podcst.designsystem.Eyebrow
import app.podcst.designsystem.Pill
import app.podcst.designsystem.Podcst
import app.podcst.designsystem.PodcstButton
import app.podcst.designsystem.PodcstIcons
import app.podcst.designsystem.PodcstTheme
import app.podcst.designsystem.RoundIcon
import app.podcst.designsystem.SectionHeader
import app.podcst.model.Podcast

@Composable
fun Search(
    viewModel: SearchViewModel,
    onBack: () -> Unit,
    onSignIn: () -> Unit,
    onPodcast: (Podcast) -> Unit,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    SearchScreen(
        query = viewModel.query,
        state = state,
        onQuery = { viewModel.query = it },
        onSubmit = viewModel::remember,
        onBack = onBack,
        onSignIn = onSignIn,
        onPodcast = { podcast ->
            viewModel.remember()
            onPodcast(podcast)
        },
        onClearRecent = viewModel::clearRecent,
    )
}

@Composable
fun SearchScreen(
    query: String,
    state: SearchState,
    onQuery: (String) -> Unit,
    onSubmit: () -> Unit,
    onBack: () -> Unit,
    onSignIn: () -> Unit,
    onPodcast: (Podcast) -> Unit,
    onClearRecent: () -> Unit,
) {
    val term = query.trim()
    val feed = isFeedUrl(term)
    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        SearchField(query, onQuery, onSubmit, onBack)
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 24.dp)) {
            if (term.isEmpty() || feed) item { FeedHint(feed, Modifier.padding(bottom = 22.dp)) }
            if (feed && !state.signedIn) {
                item {
                    PodcstButton(
                        stringResource(R.string.sign_in_feed),
                        onSignIn,
                        Modifier.fillMaxWidth().padding(bottom = 16.dp),
                        kind = ButtonKind.Outline,
                        icon = PodcstIcons.Person,
                    )
                }
            }
            val outcome = state.outcome
            if (outcome is SearchOutcome.Failed) {
                item {
                    Text(
                        outcome.message ?: stringResource(R.string.search_failed),
                        style = Podcst.type.caption,
                        color = Podcst.colors.secondary,
                        modifier = Modifier.padding(bottom = 16.dp),
                    )
                }
            }
            if (term.isNotEmpty()) {
                item { ResultsHeader(feed, outcome) }
                if (outcome is SearchOutcome.Found) {
                    items(outcome.podcasts, key = { it.identity }) { podcast -> ResultRow(podcast, onPodcast) }
                }
            } else if (state.recent.isNotEmpty()) {
                item { RecentSearches(state.recent, onQuery, onClearRecent) }
            }
        }
    }
}

@Composable
private fun SearchField(query: String, onQuery: (String) -> Unit, onSubmit: () -> Unit, onBack: () -> Unit) {
    val colors = Podcst.colors
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(Unit) { focus.requestFocus() }
    Row(
        Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RoundIcon(PodcstIcons.Back, stringResource(R.string.back), onBack, size = 48.dp, iconSize = 24.dp, background = Color.Transparent)
        Row(
            Modifier
                .weight(1f)
                .padding(end = 8.dp)
                .height(48.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(colors.surface)
                .padding(start = 16.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BasicTextField(
                value = query,
                onValueChange = onQuery,
                modifier = Modifier.weight(1f).focusRequester(focus),
                singleLine = true,
                textStyle = Podcst.type.body.copy(color = colors.ink),
                cursorBrush = SolidColor(colors.accent),
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.None,
                    autoCorrectEnabled = false,
                    imeAction = ImeAction.Search,
                ),
                keyboardActions = KeyboardActions(onSearch = {
                    onSubmit()
                    keyboard?.hide()
                }),
                decorationBox = { field ->
                    Box(contentAlignment = Alignment.CenterStart) {
                        if (query.isEmpty()) {
                            Text(stringResource(R.string.search_placeholder), style = Podcst.type.body, color = colors.tertiary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        field()
                    }
                },
            )
            if (query.isNotEmpty()) {
                RoundIcon(PodcstIcons.Close, stringResource(R.string.clear_search), { onQuery("") }, size = 40.dp, iconSize = 18.dp, background = Color.Transparent, tint = colors.secondary)
            }
        }
    }
}

@Composable
private fun FeedHint(feed: Boolean, modifier: Modifier = Modifier) {
    val colors = Podcst.colors
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(colors.accentSubtle)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(if (feed) PodcstIcons.Feed else PodcstIcons.Plus, null, Modifier.size(20.dp), tint = colors.accent)
        Text(
            stringResource(if (feed) R.string.feed_hint_ready else R.string.feed_hint),
            style = Podcst.type.caption,
            color = colors.secondary,
        )
    }
}

@Composable
private fun ResultsHeader(feed: Boolean, outcome: SearchOutcome) {
    SectionHeader(stringResource(if (feed) R.string.feed else R.string.podcasts)) {
        when (outcome) {
            SearchOutcome.Searching -> CircularProgressIndicator(Modifier.size(14.dp), color = Podcst.colors.tertiary, strokeWidth = 2.dp)
            is SearchOutcome.Found -> Eyebrow(pluralStringResource(R.plurals.results, outcome.podcasts.size, outcome.podcasts.size))
            else -> Unit
        }
    }
}

@Composable
private fun ResultRow(podcast: Podcast, onPodcast: (Podcast) -> Unit) {
    val colors = Podcst.colors
    val description = stringResource(R.string.podcast_description, podcast.title, podcast.author)
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button) { onPodcast(podcast) }
            .semantics(mergeDescendants = true) { contentDescription = description }
            .padding(vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Artwork(podcast.cover, 52.dp)
        Column(Modifier.weight(1f)) {
            Text(podcast.title, style = Podcst.type.rowTitle, color = colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(podcast.author, style = Podcst.type.meta, color = colors.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Icon(PodcstIcons.ChevronRight, null, Modifier.size(16.dp), tint = colors.muted)
    }
}

@Composable
private fun RecentSearches(recent: List<String>, onQuery: (String) -> Unit, onClear: () -> Unit) {
    Column {
        SectionHeader(stringResource(R.string.recent)) {
            Text(
                stringResource(R.string.clear),
                style = Podcst.type.chip,
                color = Podcst.colors.accent,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onClear).padding(horizontal = 8.dp, vertical = 4.dp),
            )
        }
        FlowRow(
            Modifier.padding(top = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            recent.forEach { term -> Pill(term, onClick = { onQuery(term) }) }
        }
    }
}

@Preview
@Composable
private fun SearchPreview() {
    PodcstTheme {
        Box(Modifier.background(Podcst.colors.paper)) {
            SearchScreen(
                query = "",
                state = SearchState(recent = listOf("history", "science weekly", "interviews")),
                onQuery = {},
                onSubmit = {},
                onBack = {},
                onSignIn = {},
                onPodcast = {},
                onClearRecent = {},
            )
        }
    }
}
