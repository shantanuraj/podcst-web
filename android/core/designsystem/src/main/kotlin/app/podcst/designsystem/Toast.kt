package app.podcst.designsystem

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class ToastAction(val label: String, val emphasized: Boolean = true, val run: () -> Unit)

data class ToastMessage(
    val title: String,
    val detail: String? = null,
    val icon: ImageVector? = null,
    val actions: List<ToastAction> = emptyList(),
    val id: Long = System.nanoTime(),
)

class Toaster {
    private val state = MutableStateFlow<ToastMessage?>(null)
    val current: StateFlow<ToastMessage?> = state.asStateFlow()

    fun show(message: ToastMessage) {
        state.value = message
    }

    fun show(title: String, detail: String? = null) = show(ToastMessage(title, detail))

    fun dismiss(message: ToastMessage) {
        if (state.value?.id == message.id) state.value = null
    }
}

val LocalToaster = staticCompositionLocalOf { Toaster() }

@Composable
fun ToastHost(toaster: Toaster, modifier: Modifier = Modifier) {
    val message by toaster.current.collectAsState()
    LaunchedEffect(message?.id) {
        val shown = message ?: return@LaunchedEffect
        delay(if (shown.actions.isEmpty()) 2_500 else 5_000)
        toaster.dismiss(shown)
    }
    AnimatedContent(
        targetState = message,
        transitionSpec = { (slideInVertically { it / 2 } + fadeIn()) togetherWith (slideOutVertically { it / 2 } + fadeOut()) },
        contentKey = { it?.id },
        modifier = modifier,
        label = "toast",
    ) { shown ->
        if (shown != null) Toast(shown, onDismiss = { toaster.dismiss(shown) })
    }
}

@Composable
private fun Toast(message: ToastMessage, onDismiss: () -> Unit) {
    val inverse = if (Podcst.colors.dark) PodcstColors.Light else PodcstColors.Dark
    val shape = RoundedCornerShape(16.dp)
    Row(
        Modifier
            .padding(horizontal = 12.dp)
            .fillMaxWidth()
            .height(56.dp)
            .shadow(16.dp, shape)
            .clip(shape)
            .background(inverse.ink)
            .padding(start = 16.dp, end = 8.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (message.icon != null) Icon(message.icon, null, Modifier.size(20.dp), tint = inverse.accent)
        Column(Modifier.weight(1f)) {
            Text(message.title, style = Podcst.type.label, color = inverse.paper, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (message.detail != null) {
                Text(message.detail, style = Podcst.type.meta, color = inverse.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        message.actions.forEach { action ->
            Box(
                Modifier
                    .height(40.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .clickable { onDismiss(); action.run() }
                    .padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(action.label, style = if (action.emphasized) Podcst.type.button else Podcst.type.label, color = if (action.emphasized) PodcstColors.Light.accent.takeIf { Podcst.colors.dark } ?: PodcstColors.Dark.accent else inverse.muted)
            }
        }
    }
}
