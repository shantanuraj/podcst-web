package app.podcst.model

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.time.Duration.Companion.seconds
import org.junit.Assert.assertEquals
import org.junit.Test

class ShowNotesContractTest {
    private val vectors = Contracts.read("playback/shownotes.json")

    @Test
    fun chaptersMatchSharedVectors() {
        vectors.getValue("chapters").jsonArray.map { it.jsonObject }.forEach { case ->
            val expected = case.getValue("expected").jsonArray.map {
                Chapter(it.jsonObject.getValue("title").string, it.jsonObject.getValue("start").jsonPrimitive.double.seconds)
            }
            assertEquals(case.getValue("html").string, expected, ShowNotes.chapters(case.getValue("html").string))
        }
    }

    @Test
    fun timestampsMatchSharedVectors() {
        vectors.getValue("timestamps").jsonArray.map { it.jsonObject }.forEach { case ->
            val text = case.getValue("text").string
            assertEquals(text, case.getValue("expected").strings, ShowNotes.timestamps(text).map { it.text })
        }
    }

    @Test
    fun secondsMatchSharedVectors() {
        vectors.getValue("seconds").jsonArray.map { it.jsonObject }.forEach { case ->
            val expected = case.getValue("expected").takeUnless { it is JsonNull }?.jsonPrimitive?.double?.seconds
            assertEquals(case.getValue("timestamp").string, expected, ShowNotes.position(case.getValue("timestamp").string))
        }
    }
}
