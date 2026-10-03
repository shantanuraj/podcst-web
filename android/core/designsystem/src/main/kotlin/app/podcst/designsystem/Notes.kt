package app.podcst.designsystem

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.fromHtml
import androidx.compose.ui.text.style.TextDecoration
import app.podcst.model.ShowNotes
import kotlin.time.Duration

@Composable
fun NotesText(
    html: String,
    onTimestamp: (Duration) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Podcst.colors
    val text = remember(html, colors.accent) { annotate(html, colors.accent, onTimestamp) }
    Text(text, style = Podcst.type.notes, color = colors.secondary, modifier = modifier)
}

private fun annotate(html: String, accent: Color, onTimestamp: (Duration) -> Unit): AnnotatedString {
    val links = TextLinkStyles(SpanStyle(color = accent, textDecoration = TextDecoration.Underline))
    val parsed = AnnotatedString.fromHtml(html.trim(), linkStyles = links).trimmed()
    val stamps = TextLinkStyles(SpanStyle(color = accent, fontFeatureSettings = "tnum"))
    return buildAnnotatedString {
        append(parsed)
        ShowNotes.timestamps(parsed.text).forEach { stamp ->
            addLink(LinkAnnotation.Clickable(stamp.text, stamps) { onTimestamp(stamp.position) }, stamp.range.first, stamp.range.last + 1)
        }
    }
}

private fun AnnotatedString.trimmed(): AnnotatedString {
    val start = text.indexOfFirst { !it.isWhitespace() }.takeIf { it >= 0 } ?: return AnnotatedString("")
    val end = text.indexOfLast { !it.isWhitespace() } + 1
    return subSequence(start, end)
}
