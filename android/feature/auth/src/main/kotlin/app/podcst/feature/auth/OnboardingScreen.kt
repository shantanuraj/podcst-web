package app.podcst.feature.auth

import android.provider.Settings
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import app.podcst.designsystem.Artwork
import app.podcst.designsystem.ButtonKind
import app.podcst.designsystem.Eyebrow
import app.podcst.designsystem.OptionSheet
import app.podcst.designsystem.Podcst
import app.podcst.designsystem.PodcstButton
import app.podcst.designsystem.PodcstIcons
import app.podcst.designsystem.PodcstTheme
import app.podcst.model.Region
import kotlin.math.ceil

@Composable
fun OnboardingScreen(
    state: OnboardingState,
    onRegion: (Region) -> Unit,
    onPasskey: () -> Unit,
    onStart: () -> Unit,
) {
    val colors = Podcst.colors
    var picking by rememberSaveable { mutableStateOf(false) }
    Box(Modifier.fillMaxSize().background(colors.paper)) {
        Mosaic(state.covers)
        Box(
            Modifier.matchParentSize().background(
                Brush.verticalGradient(0f to colors.paper.copy(alpha = 0f), 0.32f to colors.paper.copy(alpha = 0.55f), 0.52f to colors.paper),
            ),
        )
        Column(
            Modifier.align(Alignment.BottomStart).fillMaxWidth().navigationBarsPadding().padding(horizontal = 28.dp).padding(bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Text(stringResource(R.string.brand), style = Podcst.type.display, color = colors.ink, modifier = Modifier.semantics { heading() })
            Text(stringResource(R.string.lede), style = Podcst.type.lede, color = colors.secondary, modifier = Modifier.widthIn(max = 280.dp))
            Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Eyebrow(stringResource(R.string.top_charts_from))
                state.region?.let { region -> RegionPill(region) { picking = true } }
            }
            Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                PodcstButton(
                    stringResource(R.string.sign_in_with_passkey),
                    onPasskey,
                    Modifier.fillMaxWidth(),
                    height = 54.dp,
                    corner = 16.dp,
                    loading = state.working,
                )
                PodcstButton(
                    stringResource(R.string.start_listening),
                    onStart,
                    Modifier.fillMaxWidth(),
                    kind = ButtonKind.Outline,
                    height = 54.dp,
                    corner = 16.dp,
                )
            }
            Text(
                state.error ?: stringResource(R.string.follows_you),
                style = Podcst.type.meta,
                color = if (state.error == null) colors.tertiary else colors.accent,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
    val region = state.region
    if (picking && region != null) {
        OptionSheet(stringResource(R.string.chart_region), Region.entries, region, Region::displayName, onRegion) { picking = false }
    }
}

@Composable
private fun RegionPill(region: Region, onClick: () -> Unit) {
    val colors = Podcst.colors
    val description = stringResource(R.string.chart_region_value, region.displayName)
    Row(
        Modifier
            .minimumInteractiveComponentSize()
            .clip(CircleShape)
            .border(1.dp, colors.rule, CircleShape)
            .clickable(onClick = onClick)
            .clearAndSetSemantics {
                contentDescription = description
                role = Role.DropdownList
            }
            .padding(start = 14.dp, end = 12.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(region.displayName, style = Podcst.type.label, color = colors.ink)
        Icon(PodcstIcons.ChevronDown, null, Modifier.size(14.dp), tint = colors.tertiary)
    }
}

@Composable
private fun Mosaic(covers: List<String>) {
    val tiles = remember(covers) { mosaic(covers) }
    val still = reducedMotion()
    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .clearAndSetSemantics {}
            .graphicsLayer {
                rotationZ = MOSAIC_ROTATION
                alpha = 0.9f
            },
    ) {
        val width = maxWidth + MOSAIC_BLEED
        val tile = (width - MOSAIC_SPACING * (MOSAIC_COLUMNS - 1)) / MOSAIC_COLUMNS
        val rows = tiles.chunked(MOSAIC_COLUMNS)
        val cycle = (tile + MOSAIC_SPACING) * rows.size
        val repeats = ceil(maxHeight / cycle).toInt() + 1
        val density = LocalDensity.current
        val lift = with(density) { MOSAIC_LIFT.toPx() }
        val drift = if (still) null else drift(with(density) { cycle.toPx() }, (cycle.value / MOSAIC_SPEED * 1000).toInt())
        Column(
            Modifier
                .fillMaxWidth()
                .wrapContentSize(Alignment.TopCenter, unbounded = true)
                .width(width)
                .graphicsLayer { translationY = -lift - (drift?.value ?: 0f) },
            verticalArrangement = Arrangement.spacedBy(MOSAIC_SPACING),
        ) {
            repeat(repeats) {
                rows.forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(MOSAIC_SPACING)) {
                        row.forEach { cover -> Artwork(cover, tile, corner = 12.dp) }
                    }
                }
            }
        }
    }
}

@Composable
private fun drift(distance: Float, millis: Int): State<Float> =
    rememberInfiniteTransition("drift").animateFloat(
        0f,
        distance,
        infiniteRepeatable(tween(millis, easing = LinearEasing)),
        "shift",
    )

@Composable
private fun reducedMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    return remember(resolver) { Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
}

internal fun mosaic(covers: List<String>): List<String?> {
    val cycle = covers.take(MOSAIC_TILES)
    val count = cycle.size - cycle.size % MOSAIC_COLUMNS
    return if (count > 0) cycle.take(count) else List(MOSAIC_TILES) { null }
}

private const val MOSAIC_COLUMNS = 4
private const val MOSAIC_TILES = 12
private const val MOSAIC_ROTATION = -8f
private const val MOSAIC_SPEED = 9f
private val MOSAIC_SPACING = 12.dp
private val MOSAIC_BLEED = 120.dp
private val MOSAIC_LIFT = 40.dp

@Preview
@Composable
private fun OnboardingPreview() {
    PodcstTheme(dark = true) {
        OnboardingScreen(OnboardingState(region = Region.US), onRegion = {}, onPasskey = {}, onStart = {})
    }
}
