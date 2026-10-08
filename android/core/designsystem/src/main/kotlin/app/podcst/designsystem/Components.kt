package app.podcst.designsystem

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.podcst.model.Artwork as ArtworkSizing
import app.podcst.model.ChapterArtwork
import androidx.compose.ui.platform.LocalContext
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import coil3.compose.AsyncImage
import kotlin.time.Instant

@Composable
fun Artwork(
    url: String?,
    size: Dp,
    modifier: Modifier = Modifier,
    corner: Dp = 9.dp,
    bordered: Boolean = true,
    contentDescription: String? = null,
    chapterArtwork: ChapterArtwork? = null,
) {
    val colors = Podcst.colors
    val shape = RoundedCornerShape(corner)
    val pixels = with(androidx.compose.ui.platform.LocalDensity.current) { size.roundToPx() }
    Box(
        modifier
            .size(size)
            .clip(shape)
            .background(colors.surface)
            .then(if (bordered) Modifier.border(1.dp, colors.rule, shape) else Modifier),
    ) {
        if (!url.isNullOrBlank()) {
            AsyncImage(
                model = ArtworkSizing.url(url, pixels),
                contentDescription = contentDescription,
                contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                modifier = Modifier.matchParentSize(),
            )
        }
        if (chapterArtwork != null) key(chapterArtwork.id) {
            var ready by remember { mutableStateOf(false) }
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(chapterArtwork.data)
                    .size(pixels)
                    .memoryCachePolicy(CachePolicy.DISABLED)
                    .diskCachePolicy(CachePolicy.DISABLED)
                    .build(),
                contentDescription = contentDescription,
                contentScale = androidx.compose.ui.layout.ContentScale.Fit,
                onSuccess = { ready = true },
                onError = { ready = false },
                modifier = Modifier.matchParentSize().background(if (ready) colors.surface else Color.Transparent),
            )
        }
    }
}

@Composable
fun Eyebrow(text: String, modifier: Modifier = Modifier, color: Color = Podcst.colors.tertiary) {
    Text(text.uppercase(), style = Podcst.type.eyebrow, color = color, modifier = modifier, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

@Composable
fun Hairline(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(Podcst.colors.rule))
}

@Composable
fun SectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    style: TextStyle = Podcst.type.section,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    val rule = Podcst.colors.rule
    Row(
        modifier
            .fillMaxWidth()
            .drawBehind { drawLine(rule, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }
            .padding(bottom = 8.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(title, style = style, color = Podcst.colors.ink, modifier = Modifier.weight(1f, fill = false).semantics { heading() })
        Row(verticalAlignment = Alignment.CenterVertically, content = trailing)
    }
}

@Composable
fun DateBlock(published: Instant?, modifier: Modifier = Modifier) {
    Column(modifier.width(40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        if (published != null) {
            Text(Format.month(published), style = Podcst.type.eyebrow.copy(fontSize = Podcst.type.meta.fontSize * 0.84f), color = Podcst.colors.tertiary)
            Text(Format.day(published), style = Podcst.type.dateDay, color = Podcst.colors.secondary)
        }
    }
}

enum class ButtonKind { Accent, Tonal, Ink, Outline, Surface }

@Composable
fun PodcstButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: ButtonKind = ButtonKind.Accent,
    icon: ImageVector? = null,
    height: Dp = 48.dp,
    corner: Dp = 14.dp,
    enabled: Boolean = true,
    loading: Boolean = false,
    progress: Float? = null,
    iconTint: Color? = null,
) {
    val colors = Podcst.colors
    val (background, content, border) = when (kind) {
        ButtonKind.Accent -> Triple(colors.accent, colors.onAccent, null)
        ButtonKind.Tonal -> Triple(colors.accentSubtle, colors.accent, null)
        ButtonKind.Ink -> Triple(colors.ink, colors.paper, null)
        ButtonKind.Outline -> Triple(Color.Transparent, colors.ink, BorderStroke(1.dp, colors.rule))
        ButtonKind.Surface -> Triple(colors.surface, colors.ink, BorderStroke(1.dp, colors.rule))
    }
    val shape = RoundedCornerShape(corner)
    Box(
        modifier
            .height(height)
            .clip(shape)
            .background(background)
            .then(border?.let { Modifier.border(it, shape) } ?: Modifier)
            .clickable(enabled = enabled && !loading, role = Role.Button, onClick = onClick)
            .graphicsLayer { alpha = if (enabled) 1f else 0.5f }
            .padding(horizontal = 16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (loading) {
                CircularProgressIndicator(Modifier.size(16.dp), color = content, strokeWidth = 2.dp)
            } else if (icon != null) {
                Icon(icon, null, Modifier.size(18.dp), tint = iconTint ?: content)
            }
            Text(text, style = Podcst.type.button, color = content, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (progress != null) {
            Box(
                Modifier
                    .align(Alignment.BottomStart)
                    .padding(horizontal = 0.dp)
                    .fillMaxWidth(progress.coerceIn(0f, 1f))
                    .height(3.dp)
                    .background(Color.White.copy(alpha = 0.55f)),
            )
        }
    }
}

@Composable
fun RoundIcon(
    icon: ImageVector,
    contentDescription: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 36.dp,
    iconSize: Dp = 20.dp,
    background: Color = Podcst.colors.surface,
    tint: Color = Podcst.colors.ink,
    bordered: Boolean = false,
) {
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(background)
            .then(if (bordered) Modifier.border(1.dp, Podcst.colors.rule, CircleShape) else Modifier)
            .clickable(role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription, Modifier.size(iconSize), tint = tint)
    }
}

@Composable
fun Pill(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    count: String? = null,
    icon: ImageVector? = null,
    corner: Dp = 18.dp,
) {
    val colors = Podcst.colors
    val shape = RoundedCornerShape(corner)
    Row(
        modifier
            .height(36.dp)
            .clip(shape)
            .background(if (selected) colors.accentSubtle else colors.surface)
            .then(if (selected) Modifier.border(1.dp, colors.accent, shape) else Modifier)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (icon != null) Icon(icon, null, Modifier.size(16.dp), tint = if (selected) colors.accent else colors.secondary)
        Text(text, style = Podcst.type.chip, color = if (selected) colors.ink else colors.secondary, maxLines = 1)
        if (count != null) Text(count, style = Podcst.type.meta, color = colors.tertiary)
    }
}

@Composable
fun Facet(text: String, count: Int?, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = Podcst.colors
    val shape = RoundedCornerShape(17.dp)
    Row(
        modifier
            .height(34.dp)
            .clip(shape)
            .background(if (selected) colors.ink else Color.Transparent)
            .border(1.dp, if (selected) colors.ink else colors.rule, shape)
            .clickable(role = Role.Checkbox, onClick = onClick)
            .padding(horizontal = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(text, style = Podcst.type.chip, color = if (selected) colors.paper else colors.ink)
        if (count != null) Text("$count", style = Podcst.type.meta, color = if (selected) colors.muted else colors.tertiary)
    }
}

@Composable
fun ProgressLine(fraction: Float, modifier: Modifier = Modifier, buffering: Boolean = false, height: Dp = 2.dp) {
    val colors = Podcst.colors
    val pulse = if (buffering) {
        val transition = rememberInfiniteTransition("buffering")
        val alpha by transition.animateFloat(1f, 0.4f, infiniteRepeatable(tween(700, easing = FastOutSlowInEasing), RepeatMode.Reverse), "pulse")
        alpha
    } else {
        1f
    }
    Box(modifier.fillMaxWidth().height(height).background(colors.rule)) {
        Box(
            Modifier
                .fillMaxHeight()
                .fillMaxWidth(if (buffering) 1f else fraction.coerceIn(0f, 1f))
                .graphicsLayer { alpha = pulse }
                .background(colors.accent),
        )
    }
}

@Composable
fun MiniProgress(fraction: Float, modifier: Modifier = Modifier, width: Dp = 32.dp) {
    val colors = Podcst.colors
    Box(modifier.width(width).height(3.dp).clip(RoundedCornerShape(2.dp)).background(colors.rule)) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(fraction.coerceIn(0f, 1f)).background(colors.accent))
    }
}

@Composable
fun Equalizer(playing: Boolean, modifier: Modifier = Modifier, color: Color = Podcst.colors.accent) {
    val transition = rememberInfiniteTransition("equalizer")
    val bars = listOf(0, 180, 360, 90).map { delay ->
        transition.animateFloat(
            0.25f,
            1f,
            infiniteRepeatable(tween(520, delayMillis = delay, easing = FastOutSlowInEasing), RepeatMode.Reverse),
            "bar$delay",
        )
    }
    Row(modifier.height(14.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.Bottom) {
        bars.forEach { scale ->
            Box(
                Modifier
                    .width(3.dp)
                    .fillMaxHeight()
                    .graphicsLayer {
                        transformOrigin = TransformOrigin(0.5f, 1f)
                        scaleY = if (playing) scale.value else 0.25f
                    }
                    .clip(RoundedCornerShape(1.dp))
                    .background(color),
            )
        }
    }
}

@Composable
fun Card(modifier: Modifier = Modifier, corner: Dp = 14.dp, content: @Composable () -> Unit) {
    Box(modifier.clip(RoundedCornerShape(corner)).background(Podcst.colors.surface)) { content() }
}

@Composable
fun ListRow(
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    value: String? = null,
    titleColor: Color = Podcst.colors.ink,
    leading: (@Composable () -> Unit)? = null,
    chevron: Boolean = true,
    divider: Boolean = true,
) {
    val colors = Podcst.colors
    Row(
        modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .then(if (divider) Modifier.drawBehind { drawLine(colors.rule, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) } else Modifier)
            .padding(horizontal = 16.dp)
            .height(52.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        leading?.invoke()
        Text(title, style = Podcst.type.body, color = titleColor, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (value != null) Text(value, style = Podcst.type.body, color = colors.tertiary, maxLines = 1)
        if (chevron) Icon(PodcstIcons.ChevronRight, null, Modifier.size(16.dp), tint = colors.muted)
    }
}

@Composable
fun Message(
    title: String,
    modifier: Modifier = Modifier,
    detail: String? = null,
    action: String? = null,
    onAction: () -> Unit = {},
) {
    Column(
        modifier.fillMaxWidth().padding(PaddingValues(horizontal = 32.dp, vertical = 40.dp)),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, style = Podcst.type.section, color = Podcst.colors.ink)
        if (detail != null) Text(detail, style = Podcst.type.caption, color = Podcst.colors.secondary, modifier = Modifier.widthIn(max = 300.dp))
        if (action != null) {
            Spacer(Modifier.height(8.dp))
            PodcstButton(action, onAction, kind = ButtonKind.Outline, height = 44.dp)
        }
    }
}

fun Modifier.pressable(onClick: () -> Unit, onLongClick: (() -> Unit)? = null): Modifier =
    combinedClickable(onLongClick = onLongClick, onClick = onClick)
