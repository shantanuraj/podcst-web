package app.podcst.model

import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.format.TextStyle
import java.util.Locale
import kotlin.time.Instant
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class ReleasesContractTest {
    private val vectors = Contracts.read("playback/releases.json")

    @Test
    fun sectionsMatchSharedVectors() {
        vectors.getValue("sections").jsonArray.map { it.jsonObject }.forEach { case ->
            val name = case.getValue("name").string
            val now = Instant.parse(case.getValue("now").string)
            val episodes = case.getValue("episodes").jsonArray.map { item ->
                val published = item.jsonObject.getValue("published").takeUnless { it is JsonNull }?.string?.let(Instant::parse)
                Episode(guid = item.jsonObject.getValue("id").string, feed = "f", title = "", published = published, file = EpisodeFile(""))
            }
            val sections = ReleaseSection.group(episodes)
            val expected = case.getValue("expected").jsonArray.map { it.jsonObject }
            assertEquals(name, expected.map { it.getValue("episodes").strings }, sections.map { section -> section.episodes.map { it.guid } })
            assertEquals(name, expected.map { it.getValue("day").takeUnless { day -> day is JsonNull }?.string }, sections.map { it.day?.toString() })
            assertEquals(name, expected.map { it.getValue("title").string }, sections.map { english(it.title(now)) })
            assertEquals(name, expected.map { it.getValue("recent").jsonPrimitive.boolean }, sections.map { it.recent(now) })
        }
    }

    private fun english(title: ReleaseSection.Title) = when (title) {
        ReleaseSection.Title.Today -> "Today"
        ReleaseSection.Title.Yesterday -> "Yesterday"
        ReleaseSection.Title.Unavailable -> "Date unavailable"
        is ReleaseSection.Title.Weekday -> title.day.getDisplayName(TextStyle.FULL, Locale.US)
        is ReleaseSection.Title.Date -> DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(Locale.US).format(title.day)
    }
}
