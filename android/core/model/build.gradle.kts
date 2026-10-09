import groovy.json.JsonSlurper

plugins {
    id("podcst.jvm.library")
    alias(libs.plugins.kotlin.serialization)
}

val contracts = rootProject.layout.projectDirectory.dir("../contracts")

val generateRules by tasks.registering {
    val rules = contracts.file("playback/rules.json")
    val links = contracts.file("sharing/links.json")
    val feedLimits = contracts.file("feeds/limits.json")
    val output = layout.buildDirectory.dir("generated/rules/kotlin")
    inputs.file(rules)
    inputs.file(links)
    inputs.file(feedLimits)
    outputs.dir(output)
    doLast {
        @Suppress("UNCHECKED_CAST")
        val json = JsonSlurper().parse(rules.asFile) as Map<String, Any?>
        fun section(name: String) = json.getValue(name) as Map<String, Any?>
        fun double(value: Any?) = (value as Number).toDouble().toString()
        fun long(value: Any?) = (value as Number).toLong()
        val speeds = section("speeds")
        val skip = section("skip")
        val chapters = section("chapters")
        val media = section("media")
        val artwork = section("artwork")
        val discovery = section("discovery")
        @Suppress("UNCHECKED_CAST")
        val regions = discovery["regions"] as List<Map<String, String>>
        @Suppress("UNCHECKED_CAST")
        val sharing = JsonSlurper().parse(links.asFile) as Map<String, Any?>
        val feed = JsonSlurper().parse(feedLimits.asFile) as Map<String, Any?>
        val imports = feed["imports"] as Map<String, Any?>
        val opml = feed["opml"] as Map<String, Any?>
        val client = feed["client"] as Map<String, Any?>
        val file = output.get().file("app/podcst/model/Rules.kt").asFile
        file.parentFile.mkdirs()
        file.writeText(
            buildString {
                appendLine("package app.podcst.model")
                appendLine()
                appendLine("import kotlin.time.Duration.Companion.seconds")
                appendLine()
                appendLine("object PlaybackRules {")
                appendLine("    val speeds = listOf(${(speeds["supported"] as List<*>).joinToString { double(it) }})")
                appendLine("    const val DEFAULT_SPEED = ${double(speeds["default"])}")
                appendLine("    const val HELD_SPEED = ${double(speeds["hold"])}")
                appendLine("    val skipBack = ${long(skip["backwardSeconds"])}.seconds")
                appendLine("    val skipForward = ${long(skip["forwardSeconds"])}.seconds")
                appendLine("    val progressInterval = ${long(section("progress")["periodicPlayingSeconds"])}.seconds")
                appendLine("    const val MINIMUM_CHAPTERS = ${long(chapters["minimumCount"])}")
                appendLine("    val chapterRestartThreshold = ${double(chapters["previousRestartThresholdSeconds"])}.seconds")
                appendLine("    val chapterLookahead = ${double(chapters["nextStartEpsilonSeconds"])}.seconds")
                appendLine("    const val RELEASES_PER_PODCAST = ${long(section("releases")["perPodcast"])}")
                appendLine("    const val TRANSIENT_CACHE_BYTES = ${long(media["transientCacheQuotaBytes"])}L")
                appendLine("    const val MAXIMUM_MEDIA_BYTES = ${long(media["maximumMediaBytes"])}L")
                appendLine("    val artworkWidths = listOf(${(artwork["variantWidths"] as List<*>).joinToString { long(it).toString() }})")
                appendLine("    const val ARTWORK_HOST = \"${artwork["variantHost"]}\"")
                appendLine("    const val ARTWORK_PARAMETER = \"${artwork["variantParameter"]}\"")
                appendLine("    const val CHART_LIMIT = ${long(discovery["chartLimit"])}")
                appendLine("}")
                appendLine()
                appendLine("object FeedLimits {")
                appendLine("    const val BODY_BYTES = ${long(feed["bodyBytes"])}")
                appendLine("    const val IMPORT_ITEMS = ${long(imports["items"])}")
                appendLine("    const val RETRY_SECONDS = ${long(imports["retrySeconds"])}")
                appendLine("    const val PENDING_PER_SCOPE = ${long(opml["pendingPerScope"])}")
                appendLine("    const val OPML_BYTES = ${long(opml["bytes"])}")
                appendLine("    const val OPML_DEPTH = ${long(opml["depth"])}")
                appendLine("    const val OPML_OUTLINES = ${long(opml["outlines"])}")
                appendLine("    const val OPML_FEEDS = ${long(opml["feeds"])}")
                appendLine("    const val RECHECK_SECONDS = ${long(client["recheckSeconds"])}")
                appendLine("    const val POLL_WINDOW_SECONDS = ${long(client["pollWindowSeconds"])}")
                appendLine("}")
                appendLine()
                appendLine("object ShareRules {")
                appendLine("    const val ORIGIN = \"${sharing["origin"]}\"")
                appendLine("    val maxTime = ${long(sharing["maxSeconds"])}.seconds")
                appendLine("}")
                appendLine()
                appendLine("enum class Region(val code: String, val displayName: String) {")
                regions.forEach { appendLine("    ${it.getValue("code").uppercase()}(\"${it.getValue("code")}\", \"${it.getValue("name")}\"),") }
                appendLine("    ;")
                appendLine()
                appendLine("    companion object {")
                appendLine("        val DEFAULT = ${(discovery["defaultRegion"] as String).uppercase()}")
                appendLine()
                appendLine("        fun of(code: String?): Region? = entries.firstOrNull { it.code.equals(code, ignoreCase = true) }")
                appendLine()
                appendLine("        fun detected(country: String?): Region = of(country) ?: DEFAULT")
                appendLine("    }")
                appendLine("}")
            },
        )
    }
}

kotlin.sourceSets.main {
    kotlin.srcDir(generateRules)
}

dependencies {
    api(libs.kotlinx.serialization.json)
}

tasks.test {
    inputs.dir(contracts)
    systemProperty("podcst.contracts", contracts.asFile.absolutePath)
}
