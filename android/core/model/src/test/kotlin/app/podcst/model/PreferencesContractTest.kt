package app.podcst.model

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class PreferencesContractTest {
    @Test
    fun preferencesMatchSharedVectors() {
        Contracts.read("playback/preferences.json").getValue("cases").jsonArray.map { it.jsonObject }.forEach { case ->
            val name = case.getValue("name").string
            val settings = case.getValue("steps").jsonArray.fold(AudioSettings()) { settings, step -> apply(settings, step.jsonObject) }
            val expected = case.getValue("expected").jsonObject
            assertEquals(name, options(expected.getValue("defaults")), settings.defaults)
            val overrides = expected.getValue("overrides").jsonObject
            assertEquals(name, overrides.keys.map(AudioSettings::key).toSet(), settings.overrides.keys)
            overrides.forEach { (feed, value) -> assertEquals(name, options(value), settings.overrides[AudioSettings.key(feed)]) }
            expected["effective"]?.jsonObject?.forEach { (feed, value) -> assertEquals("$name $feed", options(value), settings.options(feed)) }
        }
    }

    private fun apply(settings: AudioSettings, step: JsonObject): AudioSettings = when (step.getValue("op").string) {
        "set" -> settings.with(options(step.getValue("options")), feed(step["feed"]))
        "setRate" -> settings.withSpeed(step.getValue("speed").jsonPrimitive.double, feed(step["currentFeed"]))
        "useDefaults" -> settings.usingDefaults(step.getValue("feed").string)
        "restore" -> AudioSettings(
            options(step.getValue("defaults")),
            step.getValue("overrides").jsonObject.entries.associate { (feed, value) -> AudioSettings.key(feed) to options(value) },
        ).validated()
        else -> error("Unknown operation ${step.getValue("op")}")
    }

    private fun feed(value: JsonElement?) = value?.takeUnless { it is JsonNull }?.string

    private fun options(value: JsonElement): AudioOptions {
        val options = value.jsonObject
        return AudioOptions(
            speed = options.getValue("speed").jsonPrimitive.double,
            effects = AudioEffects(options.getValue("volumeBoost").jsonPrimitive.boolean, options.getValue("trimSilence").jsonPrimitive.boolean),
        )
    }
}
