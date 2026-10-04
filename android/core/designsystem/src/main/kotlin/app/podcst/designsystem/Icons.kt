package app.podcst.designsystem

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

private sealed interface Shape {
    val data: String
}

private data class Fill(override val data: String) : Shape
private data class Stroke(override val data: String, val width: Float) : Shape

private fun circle(cx: Float, cy: Float, r: Float) = "M${cx - r},${cy}a$r,$r 0 1,0 ${2 * r},0a$r,$r 0 1,0 ${-2 * r},0z"

private fun rect(x: Float, y: Float, w: Float, h: Float, r: Float) =
    "M${x + r},${y}h${w - 2 * r}a$r,$r 0 0 1 $r,$r" + "v${h - 2 * r}a$r,$r 0 0 1 ${-r},$r" +
        "h${-(w - 2 * r)}a$r,$r 0 0 1 ${-r},${-r}" + "v${-(h - 2 * r)}a$r,$r 0 0 1 $r,${-r}z"

private fun icon(name: String, vararg shapes: Shape): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
        shapes.forEach { shape ->
            when (shape) {
                is Fill -> addPath(addPathNodes(shape.data), fill = SolidColor(Color.Black))
                is Stroke -> addPath(
                    addPathNodes(shape.data),
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = shape.width,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
        }
    }.build()

private const val STAR = "M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"

object PodcstIcons {
    val Play = icon("Play", Fill("M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18a1 1 0 000-1.69L9.54 5.98A.998.998 0 008 6.82z"))
    val Pause = icon("Pause", Fill("M8 19c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2s-2 .9-2 2v10c0 1.1.9 2 2 2zm6-12v10c0 1.1.9 2 2 2s2-.9 2-2V7c0-1.1-.9-2-2-2s-2 .9-2 2z"))
    val Discover = icon("Discover", Stroke(circle(12f, 12f, 9f), 1.6f), Fill("M12 7l2 5-2 5-2-5z"))
    val Library = icon(
        "Library",
        Stroke(rect(4f, 4f, 7f, 7f, 1.5f), 1.6f),
        Stroke(rect(13f, 4f, 7f, 7f, 1.5f), 1.6f),
        Stroke(rect(4f, 13f, 7f, 7f, 1.5f), 1.6f),
        Stroke(rect(13f, 13f, 7f, 7f, 1.5f), 1.6f),
    )
    val Queue = icon("Queue", Stroke("M4 6H14M4 10H14M4 14H10", 1.5f), Fill(circle(17f, 17f, 3f)))
    val Search = icon("Search", Fill("M15.5 14h-.79l-.28-.27a6.5 6.5 0 001.48-5.34c-.47-2.78-2.79-5-5.59-5.34a6.505 6.505 0 00-7.27 7.27c.34 2.8 2.56 5.12 5.34 5.59a6.5 6.5 0 005.34-1.48l.27.28v.79l4.25 4.25c.41.41 1.08.41 1.49 0 .41-.41.41-1.08 0-1.49L15.5 14zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"))
    val Back = icon("Back", Fill("M19 11H7.83l4.88-4.88c.39-.39.39-1.03 0-1.42a.996.996 0 00-1.41 0l-6.59 6.59a.996.996 0 000 1.41l6.59 6.59a.996.996 0 101.41-1.41L7.83 13H19c.55 0 1-.45 1-1s-.45-1-1-1z"))
    val ChevronRight = icon("ChevronRight", Stroke("M9 6l6 6-6 6", 2f))
    val ChevronDown = icon("ChevronDown", Stroke("M6 9l6 6 6-6", 2f))
    val More = icon("More", Fill(circle(5f, 12f, 1.8f)), Fill(circle(12f, 12f, 1.8f)), Fill(circle(19f, 12f, 1.8f)))
    val MoreVertical = icon("MoreVertical", Fill(circle(12f, 5f, 1.8f)), Fill(circle(12f, 12f, 1.8f)), Fill(circle(12f, 19f, 1.8f)))
    val Star = icon("Star", Stroke(STAR, 1.6f))
    val StarFilled = icon("StarFilled", Fill(STAR), Stroke(STAR, 1.6f))
    val Person = icon("Person", Stroke(circle(12f, 8f, 4f), 2f), Stroke("M4 20c0-4 4-6 8-6s8 2 8 6", 2f))
    val Download = icon("Download", Stroke("M12 4v11M7 10.5l5 5 5-5M5 20h14", 1.8f))
    val Share = icon("Share", Stroke("M12 3v12M7 8l5-5 5 5M5 14v6h14v-6", 1.6f))
    val Plus = icon("Plus", Stroke("M12 5v14M5 12h14", 1.8f))
    val Check = icon("Check", Stroke("M5 12.5l4.5 4.5L19 7.5", 2.4f))
    val CheckCircle = icon("CheckCircle", Stroke(circle(12f, 12f, 9f), 1.6f), Stroke("M8 12.5l3 3 5-6", 1.6f))
    val Info = icon("Info", Stroke(circle(12f, 12f, 9f), 1.6f), Stroke("M12 11v5M12 8v.01", 1.6f))
    val Stop = icon("Stop", Fill(rect(6f, 6f, 12f, 12f, 2f)))
    val Moon = icon("Moon", Stroke("M20 14.5A8 8 0 119.5 4a6.5 6.5 0 0010.5 10.5z", 1.6f))
    val PlayNext = icon("PlayNext", Fill("M8 6.8v10.4L16 12z"), Stroke("M19 6v12", 1.6f))
    val AddToList = icon("AddToList", Stroke("M4 7h11M4 12h11M4 17h7M18 14v6M15 17h6", 1.6f))
    val Sort = icon("Sort", Stroke("M4 7h11M4 12h11M4 17h7M18 14v7M14.5 17.5L18 21l3.5-3.5", 1.8f))
    val UpNext = icon("UpNext", Stroke("M4 7h12M4 12h12M4 17h8", 1.8f), Stroke(circle(18.5f, 17f, 2.5f), 1.8f))
    val Drag = icon(
        "Drag",
        Fill(circle(9f, 6f, 1.6f)), Fill(circle(15f, 6f, 1.6f)),
        Fill(circle(9f, 12f, 1.6f)), Fill(circle(15f, 12f, 1.6f)),
        Fill(circle(9f, 18f, 1.6f)), Fill(circle(15f, 18f, 1.6f)),
    )
    val PreviousChapter = icon("PreviousChapter", Fill("M6 6h2v12H6z"), Fill("M18 6.8v10.4c0 .8-.9 1.3-1.5.8l-7-5a1.2 1.2 0 010-2l7-4.9c.6-.5 1.5 0 1.5.7z"))
    val NextChapter = icon("NextChapter", Fill("M16 6h2v12h-2z"), Fill("M6 6.8v10.4c0 .8.9 1.3 1.5.8l7-5a1.2 1.2 0 000-2l-7-4.9C6.9 5.6 6 6 6 6.8z"))
    val Cast = icon(
        "Cast",
        Stroke("M3 18a3 3 0 013 3M3 14a7 7 0 017 7M3 10a11 11 0 0111 11", 1.8f),
        Stroke("M7 3H19a2 2 0 012 2v10a2 2 0 01-2 2h-4M3 7V5a2 2 0 012-2", 1.8f),
    )
    val Close = icon("Close", Stroke("M6 6l12 12M18 6L6 18", 1.8f))
    val Settings = icon("Settings", Stroke("M4 7h10M18 7h2M4 17h4M12 17h8", 1.8f), Stroke(circle(16f, 7f, 2f), 1.8f), Stroke(circle(10f, 17f, 2f), 1.8f))
    val Feed = icon("Feed", Stroke("M5 19a1 1 0 100-.01M4 11a9 9 0 019 9M4 4a16 16 0 0116 16", 1.8f))
    val Replay10 = icon("Replay10", Fill("M11.99 5V2.21c0-.45-.54-.67-.85-.35L7.35 5.65c-.2.2-.2.51 0 .71l3.79 3.79a.5.5 0 00.85-.35V7c3.73 0 6.68 3.42 5.86 7.29-.47 2.27-2.31 4.1-4.57 4.57-3.57.75-6.75-1.7-7.23-5.01a.984.984 0 00-.98-.85c-.6 0-1.08.53-1 1.13.62 4.39 4.8 7.64 9.53 6.72 3.12-.61 5.63-3.12 6.24-6.24.99-5.13-2.9-9.61-7.85-9.61zm-1.1 11h-.85v-3.26l-1.01.31v-.69l1.77-.63h.09V16zm4.28-1.76c0 .32-.03.6-.1.82s-.17.42-.29.57-.28.26-.45.33-.37.1-.59.1-.41-.03-.59-.1-.33-.18-.46-.33-.23-.34-.3-.57-.11-.5-.11-.82v-.74c0-.32.03-.6.1-.82s.17-.42.29-.57.28-.26.45-.33.37-.1.59-.1.41.03.59.1.33.18.46.33.23.34.3.57.11.5.11.82v.74zm-.85-.86c0-.19-.01-.35-.04-.48s-.07-.23-.12-.31-.11-.14-.19-.17-.16-.05-.25-.05-.18.02-.25.05-.14.09-.19.17-.09.18-.12.31-.04.29-.04.48v.97c0 .19.01.35.04.48s.07.24.12.32.11.14.19.17.16.05.25.05.18-.02.25-.05.14-.09.19-.17.09-.19.11-.32.04-.29.04-.48v-.97z"))
    val Forward30 = icon("Forward30", Fill("M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6v4l5-5-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8h-2zm-7.46 2.22c-.06.05-.12.09-.2.12s-.17.04-.27.04c-.09 0-.17-.01-.25-.04s-.14-.06-.2-.11-.1-.1-.13-.17-.05-.14-.05-.22h-.85c0 .21.04.39.12.55s.19.28.33.38.29.18.46.23.35.07.53.07c.21 0 .41-.03.6-.08s.34-.14.48-.24.24-.24.32-.39.12-.33.12-.53c0-.23-.06-.44-.18-.61s-.3-.3-.54-.39c.1-.05.2-.1.28-.16s.15-.13.2-.2.1-.15.13-.23.04-.16.04-.24c0-.2-.04-.37-.11-.53s-.17-.28-.3-.38-.28-.18-.46-.23-.37-.08-.59-.08c-.19 0-.38.03-.54.08s-.32.13-.44.23-.23.21-.3.34-.11.28-.11.44h.85c0-.07.02-.14.05-.2s.07-.11.12-.15.11-.07.18-.1.14-.03.22-.03c.1 0 .18.01.25.04s.13.06.18.11.08.11.11.17.04.14.04.22c0 .18-.05.32-.16.43s-.26.16-.48.16h-.43v.66h.45c.11 0 .2.01.29.04s.16.06.22.11.11.12.14.2.05.18.05.29c0 .09-.01.17-.04.24s-.08.11-.13.17zm3.9-3.44c-.18-.07-.37-.1-.59-.1s-.41.03-.59.1-.33.18-.45.33-.23.34-.29.57-.1.5-.1.82v.74c0 .32.04.6.11.82s.17.42.3.57.28.26.46.33.37.1.59.1.41-.03.59-.1.33-.18.45-.33.22-.34.29-.57.1-.5.1-.82v-.74c0-.32-.04-.6-.11-.82s-.17-.42-.3-.57-.28-.26-.46-.33zm.01 2.57c0 .19-.01.35-.04.48s-.06.24-.11.32-.11.14-.19.17-.16.05-.25.05-.18-.02-.25-.05-.14-.09-.19-.17-.09-.19-.12-.32-.04-.29-.04-.48v-.97c0-.19.01-.35.04-.48s.06-.23.12-.31.11-.14.19-.17.16-.05.25-.05.18.02.25.05.14.09.19.17.09.18.12.31.04.29.04.48v.97z"))
}
