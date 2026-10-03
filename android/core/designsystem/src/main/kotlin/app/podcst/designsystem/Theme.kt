package app.podcst.designsystem

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

@Immutable
data class PodcstColors(
    val paper: Color,
    val surface: Color,
    val elevated: Color,
    val ink: Color,
    val secondary: Color,
    val tertiary: Color,
    val muted: Color,
    val faint: Color,
    val rule: Color,
    val accent: Color,
    val accentSubtle: Color,
    val backdrop: Color,
    val navigation: Color,
    val onAccent: Color,
    val dark: Boolean,
) {
    val accentTint: Color get() = accent.copy(alpha = if (dark) 0.18f else 0.12f)
    val inkTint: Color get() = ink.copy(alpha = if (dark) 0.10f else 0.07f)
    val track: Color get() = ink.copy(alpha = if (dark) 0.16f else 0.12f)

    companion object {
        val Dark = PodcstColors(
            paper = Color(0xFF1C1B1A),
            surface = Color(0xFF262423),
            elevated = Color(0xFF2C2A28),
            ink = Color(0xFFF2F0ED),
            secondary = Color(0xFFB0ADA9),
            tertiary = Color(0xFF8C8882),
            muted = Color(0xFF6B6864),
            faint = Color(0xFF4D4A46),
            rule = Color(0xFF33312F),
            accent = Color(0xFFE06B52),
            accentSubtle = Color(0xFF2E1D1A),
            backdrop = Color(0xFF0E0E0D),
            navigation = Color(0xFF211F1E),
            onAccent = Color(0xFFFFFFFF),
            dark = true,
        )

        val Light = PodcstColors(
            paper = Color(0xFFFAF9F7),
            surface = Color(0xFFF5F3F0),
            elevated = Color(0xFFFFFFFF),
            ink = Color(0xFF1A1A1A),
            secondary = Color(0xFF6B6B6B),
            tertiary = Color(0xFF9A9A9A),
            muted = Color(0xFF888888),
            faint = Color(0xFFAAAAAA),
            rule = Color(0xFFE8E6E3),
            accent = Color(0xFFC84B31),
            accentSubtle = Color(0xFFFDF6F4),
            backdrop = Color(0xFFD9D6D1),
            navigation = Color(0xFFF5F3F0),
            onAccent = Color(0xFFFFFFFF),
            dark = false,
        )
    }
}

val LocalPodcstColors = staticCompositionLocalOf { PodcstColors.Dark }

object Podcst {
    val colors: PodcstColors
        @Composable get() = LocalPodcstColors.current
    val type: PodcstType
        @Composable get() = LocalPodcstType.current
}

@Composable
fun PodcstTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val colors = if (dark) PodcstColors.Dark else PodcstColors.Light
    CompositionLocalProvider(LocalPodcstColors provides colors, LocalPodcstType provides PodcstType.Default) {
        MaterialTheme(colorScheme = colors.scheme(), typography = PodcstType.Default.material, content = content)
    }
}

private fun PodcstColors.scheme(): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = accent,
        onPrimary = onAccent,
        primaryContainer = accentSubtle,
        onPrimaryContainer = accent,
        secondary = ink,
        onSecondary = paper,
        secondaryContainer = accentSubtle,
        onSecondaryContainer = accent,
        tertiary = accent,
        background = paper,
        onBackground = ink,
        surface = paper,
        onSurface = ink,
        surfaceVariant = surface,
        onSurfaceVariant = secondary,
        surfaceContainerLowest = paper,
        surfaceContainerLow = surface,
        surfaceContainer = surface,
        surfaceContainerHigh = elevated,
        surfaceContainerHighest = elevated,
        surfaceBright = elevated,
        surfaceDim = paper,
        inverseSurface = ink,
        inverseOnSurface = paper,
        outline = rule,
        outlineVariant = rule,
        scrim = Color.Black,
        error = accent,
        onError = onAccent,
    )
}
