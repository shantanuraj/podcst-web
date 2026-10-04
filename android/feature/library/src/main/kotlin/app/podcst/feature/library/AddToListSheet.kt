package app.podcst.feature.library

import app.podcst.model.EpisodeList

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.podcst.designsystem.Artwork
import app.podcst.designsystem.Card
import app.podcst.designsystem.Hairline
import app.podcst.designsystem.Podcst
import app.podcst.designsystem.PodcstIcons
import app.podcst.model.Episode
import kotlinx.coroutines.launch
import app.podcst.designsystem.R as DesignR

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddToListSheet(episode: Episode, starred: Boolean, starredCount: Int, onStar: (Boolean) -> Unit, onDismiss: () -> Unit) {
    val colors = Podcst.colors
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val done: () -> Unit = { scope.launch { sheet.hide() }.invokeOnCompletion { onDismiss() } }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheet,
        containerColor = colors.paper,
        dragHandle = { BottomSheetDefaults.DragHandle(color = colors.faint) },
    ) {
        Column(Modifier.navigationBarsPadding().padding(bottom = 16.dp)) {
            Row(
                Modifier.padding(start = 20.dp, end = 8.dp, bottom = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Artwork(episode.artwork, 44.dp)
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.add_to_list_title), style = Podcst.type.section, color = colors.ink, modifier = Modifier.semantics { heading() })
                    Text(
                        listOfNotNull(episode.title, episode.podcastTitle).joinToString(" · "),
                        style = Podcst.type.meta,
                        color = colors.tertiary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
                Text(
                    stringResource(R.string.done),
                    style = Podcst.type.button,
                    color = colors.accent,
                    modifier = Modifier
                        .minimumInteractiveComponentSize()
                        .clip(RoundedCornerShape(8.dp))
                        .clickable(role = Role.Button, onClick = done)
                        .padding(horizontal = 12.dp),
                )
            }
            Hairline()
            Card(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp).fillMaxWidth()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(60.dp)
                        .toggleable(value = starred, role = Role.Checkbox, onValueChange = onStar)
                        .padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    ListTile(EpisodeList.Starred.icon, 36.dp, 9.dp)
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(DesignR.string.starred), style = Podcst.type.label.copy(fontSize = Podcst.type.body.fontSize), color = colors.ink)
                        Text(pluralStringResource(R.plurals.episodes, starredCount, starredCount), style = Podcst.type.meta, color = colors.tertiary, modifier = Modifier.padding(top = 2.dp))
                    }
                    Check(starred)
                }
            }
            Text(
                stringResource(R.string.list_footer),
                style = Podcst.type.meta,
                color = colors.tertiary,
                modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 14.dp),
            )
        }
    }
}

@Composable
private fun Check(checked: Boolean) {
    val colors = Podcst.colors
    if (checked) {
        Box(Modifier.size(24.dp).clip(CircleShape).background(colors.accent), contentAlignment = Alignment.Center) {
            Icon(PodcstIcons.Check, null, Modifier.size(14.dp), tint = colors.onAccent)
        }
    } else {
        Box(Modifier.size(24.dp).border(1.5.dp, colors.faint, CircleShape))
    }
}
