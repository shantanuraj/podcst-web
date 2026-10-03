package app.podcst.model

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

object Contracts {
    private val root = File(checkNotNull(System.getProperty("podcst.contracts")) { "podcst.contracts is not set" })

    fun read(path: String): JsonObject = Json.parseToJsonElement(File(root, path).readText()).jsonObject
}

val JsonElement.string: String get() = jsonPrimitive.content
val JsonElement.strings: List<String> get() = jsonArray.map { it.string }
