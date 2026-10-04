package app.podcst.feature.player

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.progressSemantics
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.podcst.designsystem.Format
import app.podcst.designsystem.Podcst
import app.podcst.model.Chapter
import kotlin.time.Duration

@Composable
fun SeekBar(
    position: Duration,
    duration: Duration,
    chapters: List<Chapter>,
    onSeek: (Duration) -> Unit,
    modifier: Modifier = Modifier,
    height: Dp = 16.dp,
    showTimes: Boolean = true,
    label: String,
) {
    val colors = Podcst.colors
    var dragging by remember { mutableStateOf<Float?>(null) }
    val total = duration.takeIf { it.isPositive() }
    val fraction = dragging ?: total?.let { (position / it).toFloat().coerceIn(0f, 1f) } ?: 0f
    val shown = total?.let { it * fraction.toDouble() } ?: position
    val active = colors.accent
    val inactive = if (colors.dark) colors.accentSubtle else colors.track
    Column(modifier) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(40.dp)
                .semantics {
                    contentDescription = label
                    setProgress { target ->
                        total?.let { onSeek(it * target.toDouble()) }
                        total != null
                    }
                }
                .progressSemantics(fraction, 0f..1f)
                .pointerInput(total) {
                    if (total == null) return@pointerInput
                    detectTapGestures { offset -> onSeek(total * (offset.x / size.width).coerceIn(0f, 1f).toDouble()) }
                }
                .pointerInput(total) {
                    if (total == null) return@pointerInput
                    detectHorizontalDragGestures(
                        onDragStart = { offset -> dragging = (offset.x / size.width).coerceIn(0f, 1f) },
                        onDragEnd = {
                            dragging?.let { onSeek(total * it.toDouble()) }
                            dragging = null
                        },
                        onDragCancel = { dragging = null },
                    ) { change, amount ->
                        change.consume()
                        dragging = ((dragging ?: 0f) + amount / size.width).coerceIn(0f, 1f)
                    }
                },
        ) {
            Canvas(Modifier.fillMaxWidth().height(height).align(androidx.compose.ui.Alignment.Center)) {
                if (chapters.size >= 2 && total != null) {
                    segments(chapters, total, fraction, active, inactive)
                } else {
                    track(fraction, active, inactive)
                }
                handle(fraction, active)
            }
        }
        if (showTimes) {
            Row(Modifier.fillMaxWidth().padding(top = 2.dp)) {
                Text(Format.clock(shown), style = Podcst.type.tabular, color = colors.tertiary, modifier = Modifier.weight(1f))
                Text(total?.let(Format::clock) ?: "", style = Podcst.type.tabular, color = colors.tertiary)
            }
        }
    }
}

private fun DrawScope.track(fraction: Float, active: Color, inactive: Color) {
    val thickness = size.height / 2
    val gap = 4.dp.toPx()
    val handleWidth = 4.dp.toPx()
    val x = size.width * fraction
    val top = (size.height - thickness) / 2
    val radius = CornerRadius(thickness / 2)
    if (x - gap > 0) drawRoundRect(active, Offset(0f, top), Size(x - gap, thickness), radius)
    val start = x + handleWidth + gap
    if (start < size.width) drawRoundRect(inactive, Offset(start, top), Size(size.width - start, thickness), radius)
}

private fun DrawScope.segments(chapters: List<Chapter>, total: Duration, fraction: Float, active: Color, inactive: Color) {
    val gap = 3.dp.toPx()
    val thickness = size.height / 4
    val current = total * fraction.toDouble()
    chapters.forEachIndexed { index, chapter ->
        val start = (chapter.start / total).toFloat().coerceIn(0f, 1f) * size.width
        val endTime = chapters.getOrNull(index + 1)?.start ?: total
        val end = (endTime / total).toFloat().coerceIn(0f, 1f) * size.width - if (index < chapters.lastIndex) gap else 0f
        if (end <= start) return@forEachIndexed
        val playing = current >= chapter.start && current < endTime
        val height = if (playing) thickness * 1.5f else thickness
        val top = (size.height - height) / 2
        val radius = CornerRadius(height / 2)
        when {
            current >= endTime -> drawRoundRect(active, Offset(start, top), Size(end - start, height), radius)
            playing -> {
                drawRoundRect(inactive, Offset(start, top), Size(end - start, height), radius)
                drawRoundRect(active, Offset(start, top), Size((size.width * fraction - start).coerceIn(0f, end - start), height), radius)
            }
            else -> drawRoundRect(inactive, Offset(start, top), Size(end - start, height), radius)
        }
    }
}

private fun DrawScope.handle(fraction: Float, color: Color) {
    val width = 4.dp.toPx()
    val x = (size.width * fraction).coerceIn(0f, size.width - width)
    drawRoundRect(color, Offset(x, 0f), Size(width, size.height), CornerRadius(width / 2))
}
