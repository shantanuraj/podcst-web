package app.podcst.designsystem

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.fromHtml
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import app.podcst.model.ShowNotes
import kotlin.time.Duration

@Composable
fun NotesText(
    html: String,
    onTimestamp: (Duration) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Podcst.colors
    val seek by rememberUpdatedState(onTimestamp)
    val paragraphs = remember(html, colors.accent) { noteParagraphs(annotatedNotes(html, colors.accent) { seek(it) }) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        paragraphs.forEach { Text(it, style = Podcst.type.notes, color = colors.secondary) }
    }
}

internal fun noteParagraphs(text: AnnotatedString): List<AnnotatedString> {
    val paragraphs = mutableListOf<AnnotatedString>()
    var start = 0
    Regex("\\n[\\t ]*\\n+").findAll(text.text).forEach { separator ->
        text.subSequence(start, separator.range.first).trimmed().takeIf { it.isNotEmpty() }?.let(paragraphs::add)
        start = separator.range.last + 1
    }
    text.subSequence(start, text.length).trimmed().takeIf { it.isNotEmpty() }?.let(paragraphs::add)
    return paragraphs
}

internal fun annotatedNotes(html: String, accent: Color, onTimestamp: (Duration) -> Unit): AnnotatedString {
    val links = TextLinkStyles(SpanStyle(color = accent, textDecoration = TextDecoration.Underline))
    val paragraphs = html.trim().replace(Regex("(?i)</p\\s*>"), "</p><br>")
    val parsed = AnnotatedString.fromHtml(paragraphs, linkStyles = links).trimmed()
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
