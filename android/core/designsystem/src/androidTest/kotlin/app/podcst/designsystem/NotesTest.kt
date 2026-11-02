package app.podcst.designsystem

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withLink
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NotesTest {
    @Test fun htmlParagraphsKeepBreathingRoomWithoutSeparatingLineBreaks() {
        val notes = annotatedNotes("<p>Introduction<br>Second line</p><p>Start a <a href=\"https://example.test\">free trial</a>.</p><p>(00:07:30) Act One</p>", Color.Red) {}
        val paragraphs = noteParagraphs(notes)
        assertEquals(listOf("Introduction\nSecond line", "Start a free trial.", "(00:07:30) Act One"), paragraphs.map { it.text })
        assertEquals(1, paragraphs[1].getLinkAnnotations(0, paragraphs[1].length).size)
        assertEquals(1, paragraphs[2].getLinkAnnotations(0, paragraphs[2].length).size)
    }

    @Test fun paragraphSpacingPreservesLinksAndTimestampActions() {
        var tapped = false
        val text = buildAnnotatedString {
            append("Intro\n\n")
            withLink(LinkAnnotation.Url("https://example.test")) { append("Website") }
            append("\n\n")
            withLink(LinkAnnotation.Clickable("07:30") { tapped = true }) { append("07:30") }
            append(" Act One\n\n")
        }
        val paragraphs = noteParagraphs(text)
        assertEquals(listOf("Intro", "Website", "07:30 Act One"), paragraphs.map { it.text })
        assertEquals("https://example.test", (paragraphs[1].getLinkAnnotations(0, 7).single().item as LinkAnnotation.Url).url)
        val timestamp = paragraphs[2].getLinkAnnotations(0, 5).single().item as LinkAnnotation.Clickable
        timestamp.linkInteractionListener?.onClick(timestamp)
        assertTrue(tapped)
        assertTrue(noteParagraphs(AnnotatedString("\n \n")).isEmpty())
    }
}
