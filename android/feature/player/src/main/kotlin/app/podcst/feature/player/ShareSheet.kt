package app.podcst.feature.player

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.podcst.designsystem.Artwork
import app.podcst.designsystem.ButtonKind
import app.podcst.designsystem.Eyebrow
import app.podcst.designsystem.Format
import app.podcst.designsystem.Pill
import app.podcst.designsystem.Podcst
import app.podcst.designsystem.PodcstButton
import app.podcst.designsystem.PodcstIcons
import app.podcst.designsystem.R as DesignR
import app.podcst.designsystem.share
import app.podcst.model.Chapter
import app.podcst.model.Episode
import app.podcst.model.Moment
import app.podcst.model.Podcast
import app.podcst.model.ShowNotes
import app.podcst.model.endOf
import app.podcst.playback.ClipPreview
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.delay

enum class ShareMode { Show, Episode, Time, Chapter, Clip }

data class ShareRequest(
    val podcast: Podcast,
    val episode: Episode? = null,
    val mode: ShareMode = if (episode == null) ShareMode.Show else ShareMode.Episode,
    val chapter: Int? = null,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareSheet(request: ShareRequest, state: PlayerScreenState, preview: ClipPreview, onPause: () -> Unit, onDismiss: () -> Unit) {
    val colors = Podcst.colors
    val context = LocalContext.current
    val episode = request.episode
    val player = state.player
    val current = episode != null && player.episode?.identity == episode.identity
    val parsed = remember(episode) { episode?.let { ShowNotes.chapters(it.notes) }.orEmpty() }
    val chapters = if (current) player.chapters else parsed
    val duration = player.duration.takeIf { current && it.isPositive() } ?: episode?.duration
    val start = remember { (if (current) player.position else episode?.let { state.progress[it.identity.value] }?.takeIf { it.started }?.position ?: Duration.ZERO).whole }
    val modes = if (episode == null) listOf(ShareMode.Show) else ShareMode.entries.filter { it != ShareMode.Chapter || chapters.size >= 2 }
    var mode by remember { mutableStateOf(request.mode.takeIf { it in modes } ?: ShareMode.Episode) }
    var from by remember { mutableStateOf(start) }
    var clip by remember { mutableStateOf(start..(start + CLIP).let { end -> duration?.let { minOf(end, it.whole) } ?: end }) }
    var chapter by remember { mutableIntStateOf((request.chapter ?: player.chapterIndex?.takeIf { current } ?: 0).coerceIn(0, (chapters.size - 1).coerceAtLeast(0))) }
    val playhead by preview.position.collectAsStateWithLifecycle()
    DisposableEffect(preview) { onDispose { preview.stop() } }

    val moment = when (mode) {
        ShareMode.Show, ShareMode.Episode -> null
        ShareMode.Time -> Moment.Time(from)
        ShareMode.Chapter -> chapters.getOrNull(chapter)?.let { Moment.Chapter(chapter + 1, it.start, chapters.endOf(chapter, duration ?: Duration.ZERO)) }
        ShareMode.Clip -> Moment.Clip(clip.start, clip.endInclusive)
    }
    val beyond = duration != null && moment != null && (moment.start >= duration || (moment is Moment.Range && moment.end > duration))
    val link = when (mode) {
        ShareMode.Show -> request.podcast.shareUrl
        else -> episode?.shareUrl(moment)
    }?.takeUnless { beyond }
    val problem = when {
        link != null -> null
        beyond -> R.string.share_past_end
        mode == ShareMode.Clip || mode == ShareMode.Chapter -> R.string.share_empty_range
        else -> R.string.share_unavailable
    }
    val title = episode?.title ?: request.podcast.title
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(2_000)
            copied = false
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = colors.surface,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
    ) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Text(stringResource(DesignR.string.share), style = Podcst.type.headline, color = colors.ink)
            if (modes.size > 1) {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    modes.forEach { option ->
                        val selected = option == mode
                        Pill(option.label(from), onClick = { mode = option }, selected = selected, icon = if (selected) PodcstIcons.Check else null, corner = 8.dp)
                    }
                }
            }
            when (mode) {
                ShareMode.Show -> LinkPreview(request.podcast.cover, null, request.podcast.title, request.podcast.title)
                ShareMode.Episode -> episode?.let { LinkPreview(it.artwork, null, it.title, it.podcastTitle.orEmpty()) }
                ShareMode.Time -> episode?.let {
                    LinkPreview(it.artwork, stringResource(R.string.listen_from, Format.clock(from)), it.title, it.podcastTitle.orEmpty())
                    StartsAt(from, duration) { from = it }
                }
                ShareMode.Chapter -> Chapters(chapters, duration, chapter) { chapter = it }
                ShareMode.Clip -> episode?.let {
                    ClipEditor(it, duration, clip, playhead ?: player.position.takeIf { current }, link, previewing = playhead != null, onRange = { range -> clip = range }) {
                        if (playhead != null) {
                            preview.stop()
                        } else {
                            onPause()
                            preview.play(it, clip.start, clip.endInclusive)
                        }
                    }
                }
            }
            problem?.let { Text(stringResource(it), style = Podcst.type.meta, color = colors.accent) }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PodcstButton(
                    stringResource(if (copied) R.string.copied else R.string.copy_link),
                    onClick = {
                        link ?: return@PodcstButton
                        context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText(title, link))
                        copied = true
                    },
                    modifier = Modifier.weight(1f),
                    kind = ButtonKind.Tonal,
                    icon = if (copied) PodcstIcons.Check else PodcstIcons.Link,
                    corner = 24.dp,
                    enabled = link != null,
                )
                PodcstButton(
                    stringResource(DesignR.string.share),
                    onClick = { link?.let { context.share(it, title) } },
                    modifier = Modifier.weight(1f),
                    icon = PodcstIcons.Share,
                    corner = 24.dp,
                    enabled = link != null,
                )
            }
        }
    }
}

@Composable
private fun ShareMode.label(from: Duration): String = when (this) {
    ShareMode.Show -> stringResource(R.string.share_show)
    ShareMode.Episode -> stringResource(R.string.share_episode)
    ShareMode.Time -> stringResource(R.string.share_time, Format.clock(from))
    ShareMode.Chapter -> stringResource(R.string.share_chapter)
    ShareMode.Clip -> stringResource(R.string.share_clip)
}

@Composable
private fun LinkPreview(artwork: String, eyebrow: String?, title: String, source: String) {
    val colors = Podcst.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(colors.paper)) {
        Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Bottom) {
            Artwork(artwork, 64.dp, corner = 8.dp, bordered = false)
            Column(Modifier.weight(1f)) {
                eyebrow?.let { Eyebrow(it, color = colors.secondary) }
                Text(title, style = Podcst.type.rowTitle, color = colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
        Text(
            stringResource(R.string.link_source, source),
            style = Podcst.type.meta,
            color = colors.tertiary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(start = 14.dp, end = 14.dp, bottom = 10.dp),
        )
    }
}

@Composable
private fun StartsAt(from: Duration, duration: Duration?, onChange: (Duration) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        TimeField(stringResource(R.string.starts_at), from, onChange, Modifier.weight(1f), suffix = stringResource(R.string.plays_to_end))
        Nudge("−15") { onChange((from - NUDGE).coerceAtLeast(Duration.ZERO)) }
        Nudge("+15") { onChange((from + NUDGE).let { later -> duration?.let { minOf(later, it.whole) } ?: later }) }
    }
}

@Composable
private fun Nudge(text: String, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).clip(CircleShape).background(Podcst.colors.elevated).clickable(role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = Podcst.type.chip, color = Podcst.colors.ink)
    }
}

@Composable
private fun Chapters(chapters: List<Chapter>, duration: Duration?, selected: Int, onSelect: (Int) -> Unit) {
    val colors = Podcst.colors
    Column {
        chapters.forEachIndexed { index, chapter ->
            val length = chapters.endOf(index, duration ?: Duration.ZERO) - chapter.start
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 56.dp)
                    .selectable(selected = index == selected, role = Role.RadioButton) { onSelect(index) }
                    .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                RadioButton(index == selected, onClick = null, colors = RadioButtonDefaults.colors(selectedColor = colors.accent, unselectedColor = colors.faint))
                Column(Modifier.weight(1f)) {
                    Text(chapter.title, style = Podcst.type.callout, color = colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        listOfNotNull(Format.clock(chapter.start), length.takeIf { it.isPositive() }?.let(Format::length)).joinToString(" · "),
                        style = Podcst.type.tabular,
                        color = colors.tertiary,
                    )
                }
            }
        }
    }
}

@Composable
private fun ClipEditor(
    episode: Episode,
    duration: Duration?,
    clip: ClosedRange<Duration>,
    playhead: Duration?,
    link: String?,
    previewing: Boolean,
    onRange: (ClosedRange<Duration>) -> Unit,
    onPreview: () -> Unit,
) {
    val colors = Podcst.colors
    var window by remember { mutableStateOf(zoom(clip, duration)) }
    val settle = { range: ClosedRange<Duration> -> onRange(range); window = zoom(range, duration) }
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Artwork(episode.artwork, 44.dp, corner = 10.dp, bordered = false)
            Column(Modifier.weight(1f)) {
                Text(episode.title, style = Podcst.type.episodeTitle, color = colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(listOfNotNull(episode.podcastTitle, duration?.let(Format::length)).joinToString(" · "), style = Podcst.type.meta, color = colors.tertiary, maxLines = 1)
            }
        }
        Column {
            Box {
                RangeSlider(
                    value = clip.start.inWholeSeconds.toFloat()..clip.endInclusive.inWholeSeconds.toFloat(),
                    onValueChange = { range -> onRange(range.start.toLong().seconds..range.endInclusive.toLong().seconds) },
                    valueRange = window.start.inWholeSeconds.toFloat()..window.endInclusive.inWholeSeconds.toFloat(),
                    onValueChangeFinished = { window = zoom(clip, duration) },
                    colors = SliderDefaults.colors(
                        thumbColor = colors.accent,
                        activeTrackColor = colors.accent,
                        inactiveTrackColor = colors.accentSubtle,
                        activeTickColor = colors.accent,
                        inactiveTickColor = colors.accentSubtle,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
                playhead?.takeIf { it in window }?.let { position ->
                    val ink = colors.ink
                    Canvas(Modifier.matchParentSize()) {
                        val x = size.width * ((position - window.start) / (window.endInclusive - window.start)).toFloat()
                        drawRoundRect(ink, Offset(x - 1.dp.toPx(), 0f), Size(2.dp.toPx(), size.height), CornerRadius(1.dp.toPx()))
                    }
                }
            }
            Row(Modifier.fillMaxWidth()) {
                Text(Format.clock(window.start), style = Podcst.type.tabular, color = colors.muted, modifier = Modifier.weight(1f))
                Text(Format.clock(window.endInclusive), style = Podcst.type.tabular, color = colors.muted)
            }
            duration?.takeIf { it.isPositive() }?.let { total ->
                val track = colors.track
                val accent = colors.accent
                val subtle = colors.accent.copy(alpha = 0.3f)
                Canvas(Modifier.fillMaxWidth().padding(top = 10.dp).height(4.dp)) {
                    fun x(time: Duration) = size.width * (time / total).toFloat().coerceIn(0f, 1f)
                    val radius = CornerRadius(size.height / 2)
                    drawRoundRect(track, Offset.Zero, size, radius)
                    drawRoundRect(subtle, Offset(x(window.start), 0f), Size(x(window.endInclusive) - x(window.start), size.height), radius)
                    drawRoundRect(accent, Offset(x(clip.start), 0f), Size((x(clip.endInclusive) - x(clip.start)).coerceAtLeast(2.dp.toPx()), size.height), radius)
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TimeField(stringResource(R.string.clip_start), clip.start, { settle(it..clip.endInclusive) }, Modifier.weight(1f))
            TimeField(stringResource(R.string.clip_end), clip.endInclusive, { settle(clip.start..it) }, Modifier.weight(1f))
            val label = stringResource(if (previewing) R.string.stop_preview else R.string.preview_clip)
            Box(
                Modifier
                    .size(56.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(colors.elevated)
                    .clickable(enabled = clip.endInclusive > clip.start, role = Role.Button, onClick = onPreview)
                    .semantics { contentDescription = label },
                contentAlignment = Alignment.Center,
            ) {
                Icon(if (previewing) PodcstIcons.Pause else PodcstIcons.Play, null, Modifier.size(20.dp), tint = colors.ink)
            }
        }
        Text(
            listOfNotNull(length(clip.endInclusive - clip.start), link?.removePrefix("https://")).joinToString(" · "),
            style = Podcst.type.meta,
            color = colors.tertiary,
        )
    }
}

@Composable
private fun TimeField(label: String, value: Duration, onValue: (Duration) -> Unit, modifier: Modifier = Modifier, suffix: String? = null) {
    val colors = Podcst.colors
    val focus = LocalFocusManager.current
    var text by remember { mutableStateOf(Format.clock(value)) }
    var focused by remember { mutableStateOf(false) }
    LaunchedEffect(value, focused) { if (!focused) text = Format.clock(value) }
    val commit = { ShowNotes.position(text.trim())?.let(onValue) ?: run { text = Format.clock(value) } }
    OutlinedTextField(
        value = text,
        onValueChange = { text = it },
        label = { Text(label) },
        suffix = suffix?.let { { Text(it, style = Podcst.type.meta, color = colors.tertiary) } },
        singleLine = true,
        textStyle = Podcst.type.callout.copy(fontFeatureSettings = "tnum", color = colors.ink),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = colors.accent,
            unfocusedBorderColor = colors.faint,
            focusedLabelColor = colors.accent,
            unfocusedLabelColor = colors.secondary,
            cursorColor = colors.accent,
        ),
        modifier = modifier.onFocusChanged {
            if (focused && !it.isFocused) commit()
            focused = it.isFocused
        },
    )
}

@Composable
private fun length(duration: Duration): String {
    val minutes = duration.inWholeMinutes.toInt()
    val seconds = (duration.inWholeSeconds % 60).toInt()
    return if (minutes > 0) stringResource(R.string.clip_length, minutes, seconds) else stringResource(R.string.clip_seconds, seconds)
}

private fun zoom(clip: ClosedRange<Duration>, duration: Duration?): ClosedRange<Duration> {
    val span = maxOf(WINDOW, (clip.endInclusive - clip.start) * 1.5)
    val center = clip.start + (clip.endInclusive - clip.start) / 2
    val end = (center + span / 2).coerceAtLeast(span).let { later -> duration?.takeIf { it.isPositive() }?.let { minOf(later, it.whole) } ?: later }
    return (end - span).coerceAtLeast(Duration.ZERO)..maxOf(end, 1.seconds)
}

private val Duration.whole: Duration get() = inWholeSeconds.seconds

private val CLIP = 60.seconds
private val NUDGE = 15.seconds
private val WINDOW = 8.minutes
