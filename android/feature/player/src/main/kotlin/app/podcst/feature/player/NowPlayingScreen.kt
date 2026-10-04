package app.podcst.feature.player

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.CompositionLocalProvider
import androidx.media3.cast.MediaRouteButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.podcst.designsystem.Artwork
import app.podcst.designsystem.EpisodeActions
import app.podcst.designsystem.Eyebrow
import app.podcst.designsystem.Format
import app.podcst.designsystem.MenuDivider
import app.podcst.designsystem.MenuEntry
import app.podcst.designsystem.Podcst
import app.podcst.designsystem.PodcstIcons
import app.podcst.designsystem.RoundIcon
import app.podcst.designsystem.share
import app.podcst.designsystem.speed
import app.podcst.model.Episode
import app.podcst.model.PlaybackRules
import app.podcst.playback.SleepTimer
import app.podcst.playback.audio.EffectState
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

enum class PlayerSheet { Chapters, Notes, UpNext }

@Composable
fun NowPlayingScreen(
    state: PlayerScreenState,
    viewModel: PlayerViewModel,
    actions: EpisodeActions,
    onDismiss: () -> Unit,
    onStop: () -> Unit,
    onOpenPodcast: (Episode) -> Unit,
) {
    val episode = state.episode ?: return
    val player = state.player
    val colors = Podcst.colors
    val tint = rememberArtworkTint(episode.artwork) ?: colors.surface
    var sheet by remember { mutableStateOf<PlayerSheet?>(null) }
    val chapterIndex = player.chapterIndex

    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(0f to tint, 0.6f to colors.paper))
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        Column(Modifier.fillMaxSize()) {
            TopBar(state, actions, onDismiss, onStop, onOpenPodcast, viewModel)
            BoxWithConstraints(Modifier.weight(1f)) {
                val compact = maxHeight < 640.dp
                val width = maxWidth
                Column(
                    Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Artwork(
                        episode.artwork,
                        size = if (compact) 240.dp else minOf(width - 48.dp, 420.dp),
                        corner = 24.dp,
                        bordered = false,
                        contentDescription = episode.title,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    Column(Modifier.fillMaxWidth().widthIn(max = 560.dp).padding(top = if (compact) 18.dp else 26.dp)) {
                        if (chapterIndex != null) {
                            Eyebrow(
                                stringResource(R.string.chapter_of, chapterIndex + 1, player.chapters.size) + " · " + player.chapters[chapterIndex].title,
                                color = colors.accent,
                            )
                        }
                        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Column(
                                Modifier
                                    .weight(1f)
                                    .pointerInput(Unit) {
                                        detectTapGestures(
                                            onLongPress = { viewModel.holdDoubleSpeed(true) },
                                            onPress = {
                                                tryAwaitRelease()
                                                viewModel.holdDoubleSpeed(false)
                                            },
                                        )
                                    }
                                    .semantics {
                                        heading()
                                        onLongClick(label = "2×") { viewModel.holdDoubleSpeed(true); true }
                                    },
                            ) {
                                Text(episode.title, style = Podcst.type.headline, color = colors.ink, modifier = Modifier.padding(top = 6.dp))
                                Text(episode.podcastTitle.orEmpty(), style = Podcst.type.body, color = colors.secondary, modifier = Modifier.padding(top = 4.dp))
                            }
                            RoundIcon(
                                if (state.currentStarred) PodcstIcons.StarFilled else PodcstIcons.Star,
                                stringResource(if (state.currentStarred) R.string.unstar else R.string.star),
                                onClick = viewModel::toggleStar,
                                size = 40.dp,
                                iconSize = 18.dp,
                                background = if (state.currentStarred) colors.accentTint else colors.inkTint,
                                tint = if (state.currentStarred) colors.accent else colors.ink,
                                modifier = Modifier.padding(top = 8.dp),
                            )
                        }
                        SeekBar(
                            player.position,
                            player.duration,
                            player.chapters,
                            onSeek = viewModel::seek,
                            label = stringResource(R.string.position),
                            modifier = Modifier.padding(top = 14.dp),
                        )
                        Transport(state, viewModel, Modifier.padding(top = 12.dp))
                        AudioChips(state, viewModel, onQueue = { sheet = PlayerSheet.UpNext }, modifier = Modifier.padding(top = 22.dp))
                        if (player.heldDoubleSpeed) {
                            Text(stringResource(R.string.double_speed_held), style = Podcst.type.meta, color = colors.accent, modifier = Modifier.padding(top = 10.dp))
                        }
                        Spacer(Modifier.height(24.dp))
                    }
                }
            }
            SheetTabs(
                hasChapters = player.chapters.isNotEmpty(),
                onSelect = { sheet = it },
                modifier = Modifier.padding(horizontal = 24.dp).padding(bottom = 16.dp),
            )
        }
        sheet?.let { selected ->
            PlayerSheetHost(
                state,
                viewModel,
                actions,
                selected,
                onSelect = { sheet = it },
                onDismiss = { sheet = null },
                onOpenEpisode = { onDismiss(); actions.open(it) },
                onOpenPodcast = { onDismiss(); onOpenPodcast(it) },
            )
        }
    }
}

@Composable
private fun TopBar(
    state: PlayerScreenState,
    actions: EpisodeActions,
    onDismiss: () -> Unit,
    onStop: () -> Unit,
    onOpenPodcast: (Episode) -> Unit,
    viewModel: PlayerViewModel,
) {
    val episode = state.episode ?: return
    val colors = Podcst.colors
    val context = LocalContext.current
    var menu by remember { mutableStateOf(false) }
    var sleep by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        RoundIcon(PodcstIcons.ChevronDown, stringResource(R.string.close_player), onDismiss, size = 48.dp, iconSize = 24.dp, background = Color.Transparent)
        Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
            Eyebrow(
                if (state.player.queue.episodes.size > 1) stringResource(R.string.from_your_queue) else stringResource(R.string.now_playing),
                color = colors.secondary,
            )
        }
        Box {
            RoundIcon(PodcstIcons.MoreVertical, stringResource(R.string.more), { menu = true }, size = 48.dp, iconSize = 22.dp, background = Color.Transparent)
            DropdownMenu(menu, { menu = false }, shape = RoundedCornerShape(14.dp), containerColor = colors.elevated) {
                MenuEntry(stringResource(R.string.go_to_episode), PodcstIcons.Info) { menu = false; onDismiss(); actions.open(episode) }
                MenuEntry(stringResource(R.string.go_to, episode.podcastTitle ?: ""), PodcstIcons.Library) { menu = false; onDismiss(); onOpenPodcast(episode) }
                episode.shareUrl?.let { url ->
                    val at = Format.clock(state.player.position)
                    MenuEntry(stringResource(R.string.share_from, at), PodcstIcons.Share) {
                        menu = false
                        val text = context.getString(R.string.share_text, episode.title, at, url)
                        context.share(text)
                    }
                }
                MenuDivider()
                MenuEntry(
                    stringResource(R.string.sleep_timer),
                    PodcstIcons.Moon,
                    detail = sleepLabel(state.player.sleepTimer),
                ) { menu = false; sleep = true }
                MenuDivider()
                MenuEntry(stringResource(R.string.stop_playback), PodcstIcons.Stop, detail = stringResource(R.string.stop_detail), tint = colors.ink, emphasized = true) {
                    menu = false
                    onStop()
                }
                MenuEntry(stringResource(R.string.mark_played), PodcstIcons.CheckCircle, detail = stringResource(R.string.mark_played_detail)) {
                    menu = false
                    viewModel.markPlayed()
                }
            }
            DropdownMenu(sleep, { sleep = false }, shape = RoundedCornerShape(14.dp), containerColor = colors.elevated) {
                MenuEntry(stringResource(R.string.sleep_off), null) { sleep = false; viewModel.setSleepTimer(null) }
                listOf(5, 15, 30, 45, 60).forEach { minutes ->
                    MenuEntry(stringResource(R.string.minutes, minutes), null) {
                        sleep = false
                        viewModel.setSleepTimer(SleepTimer.At(System.currentTimeMillis() + minutes.minutes.inWholeMilliseconds))
                    }
                }
                MenuEntry(stringResource(R.string.end_of_episode), null) { sleep = false; viewModel.setSleepTimer(SleepTimer.EndOfEpisode) }
            }
        }
    }
}

@Composable
private fun sleepLabel(timer: SleepTimer?): String? = when (timer) {
    null -> null
    SleepTimer.EndOfEpisode -> stringResource(R.string.end_of_episode)
    is SleepTimer.At -> stringResource(R.string.sleep_until, Format.clock(((timer.deadline - System.currentTimeMillis()).coerceAtLeast(0) / 1000).seconds))
}

@Composable
private fun Transport(state: PlayerScreenState, viewModel: PlayerViewModel, modifier: Modifier = Modifier) {
    val colors = Podcst.colors
    val player = state.player
    val chapters = player.chapters.isNotEmpty()
    val label = stringResource(if (player.requested) R.string.pause else R.string.play)
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        if (chapters) RoundIcon(PodcstIcons.PreviousChapter, stringResource(R.string.previous_chapter), viewModel::previousChapter, size = 44.dp, iconSize = 22.dp, background = Color.Transparent, tint = colors.secondary)
        RoundIcon(PodcstIcons.Replay10, stringResource(R.string.skip_back), viewModel::skipBack, size = 56.dp, iconSize = 26.dp)
        Box(
            Modifier
                .width(132.dp)
                .height(80.dp)
                .clip(RoundedCornerShape(28.dp))
                .background(colors.accent)
                .clickable(role = Role.Button, onClick = viewModel::toggle)
                .semantics { contentDescription = label },
            contentAlignment = Alignment.Center,
        ) {
            Icon(if (player.requested) PodcstIcons.Pause else PodcstIcons.Play, null, Modifier.size(36.dp), tint = colors.onAccent)
        }
        RoundIcon(PodcstIcons.Forward30, stringResource(R.string.skip_forward), viewModel::skipForward, size = 56.dp, iconSize = 26.dp)
        if (chapters) RoundIcon(PodcstIcons.NextChapter, stringResource(R.string.next_chapter), viewModel::nextChapter, size = 44.dp, iconSize = 22.dp, background = Color.Transparent, tint = colors.secondary)
    }
}

@Composable
private fun AudioChips(state: PlayerScreenState, viewModel: PlayerViewModel, onQueue: () -> Unit, modifier: Modifier = Modifier) {
    val player = state.player
    var speeds by remember { mutableStateOf(false) }
    val effects = player.effects
    val unavailable = (player.effectState as? EffectState.Unavailable)?.reason
    Column(modifier) {
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box {
                Chip(
                    text = Format.speed(player.effectiveSpeed),
                    selected = false,
                    strong = true,
                    onClick = { speeds = true },
                    description = stringResource(R.string.speed_value, Format.speed(player.speed)),
                )
                DropdownMenu(speeds, { speeds = false }, shape = RoundedCornerShape(14.dp), containerColor = Podcst.colors.elevated) {
                    PlaybackRules.speeds.forEach { speed ->
                        MenuEntry(
                            Format.speed(speed),
                            if (speed == player.speed) PodcstIcons.Check else null,
                            tint = Podcst.colors.accent,
                        ) { speeds = false; viewModel.setSpeed(speed) }
                    }
                }
            }
            Chip(stringResource(R.string.boost), selected = effects.volumeBoost, onClick = viewModel::toggleBoost)
            Chip(stringResource(R.string.trim_silence), selected = effects.trimSilence, onClick = viewModel::toggleTrim)
            CastChip(player.castDevice)
            Chip(stringResource(R.string.queue), selected = false, icon = PodcstIcons.Queue, onClick = onQueue)
        }
        if (unavailable != null && effects.enabled) {
            Text(unavailable, style = Podcst.type.meta, color = Podcst.colors.tertiary, modifier = Modifier.padding(top = 10.dp))
        }
    }
}

@Composable
private fun CastChip(device: String?) {
    val colors = Podcst.colors
    val shape = RoundedCornerShape(18.dp)
    Row(
        Modifier
            .height(36.dp)
            .clip(shape)
            .background(if (device != null) colors.accentSubtle else colors.surface)
            .padding(end = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CompositionLocalProvider(LocalContentColor provides if (device != null) colors.accent else colors.secondary) {
            MediaRouteButton(Modifier.size(36.dp))
        }
        Text(device?.ifEmpty { null } ?: stringResource(R.string.cast), style = Podcst.type.chip, color = if (device != null) colors.accent else colors.secondary, maxLines = 1)
    }
}

@Composable
private fun Chip(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    icon: ImageVector? = null,
    strong: Boolean = false,
    description: String? = null,
) {
    val colors = Podcst.colors
    val shape = RoundedCornerShape(if (selected) 8.dp else 18.dp)
    val selectedState = stringResource(if (selected) R.string.on else R.string.off)
    Row(
        Modifier
            .height(36.dp)
            .clip(shape)
            .background(if (selected) colors.accentSubtle else colors.surface)
            .then(if (selected) Modifier.border(1.dp, colors.accent, shape) else Modifier)
            .clickable(role = if (strong || icon != null) Role.Button else Role.Switch, onClick = onClick)
            .semantics {
                description?.let { contentDescription = it }
                if (!strong && icon == null) stateDescription = selectedState
            }
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (selected) Icon(PodcstIcons.Check, null, Modifier.size(14.dp), tint = colors.accent)
        if (icon != null) Icon(icon, null, Modifier.size(16.dp), tint = colors.secondary)
        Text(
            text,
            style = if (strong) Podcst.type.chip.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold) else Podcst.type.chip,
            color = if (selected || strong) colors.ink else colors.secondary,
        )
    }
}

@Composable
private fun SheetTabs(hasChapters: Boolean, onSelect: (PlayerSheet) -> Unit, modifier: Modifier = Modifier) {
    val colors = Podcst.colors
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(colors.ink.copy(alpha = 0.07f))
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        PlayerSheet.entries.filter { hasChapters || it != PlayerSheet.Chapters }.forEach { tab ->
            Box(
                Modifier
                    .weight(1f)
                    .height(40.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .clickable(role = Role.Tab) { onSelect(tab) },
                contentAlignment = Alignment.Center,
            ) {
                Text(stringResource(tab.label), style = Podcst.type.label, color = colors.ink)
            }
        }
    }
}

internal val PlayerSheet.label: Int
    get() = when (this) {
        PlayerSheet.Chapters -> R.string.chapters
        PlayerSheet.Notes -> R.string.notes
        PlayerSheet.UpNext -> R.string.up_next
    }
