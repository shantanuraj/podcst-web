package app.podcst.model

import java.net.URI
import java.net.URLDecoder
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

sealed interface Moment {
    val start: Duration

    data class Time(override val start: Duration) : Moment

    sealed interface Range : Moment {
        val end: Duration
    }

    data class Clip(override val start: Duration, override val end: Duration) : Range

    data class Chapter(val number: Int, override val start: Duration, override val end: Duration) : Range
}

data class ShareTarget(val podcastId: Long, val episodeId: Long? = null, val moment: Moment? = null)

data class SharedLink(val podcastId: Long, val episodeId: Long?, val moment: Moment?, val invalidMoment: Boolean)

object ShareLinks {
    private val hosts = setOf("podcst.app", "www.podcst.app")
    private val time = Regex("^(?:(\\d{1,7})h)?(?:(\\d{1,7})m)?(?:(\\d{1,7})s)?$")
    private val chapter = Regex("^[1-9]\\d{0,3}$")

    fun format(time: Duration): String {
        val total = time.inWholeSeconds
        val hours = total / 3600
        val minutes = total % 3600 / 60
        val seconds = total % 60
        return when {
            hours > 0 -> "${hours}h${pad(minutes)}m${pad(seconds)}s"
            minutes > 0 -> "${minutes}m${pad(seconds)}s"
            else -> "${seconds}s"
        }
    }

    fun url(target: ShareTarget): String? {
        if (target.podcastId <= 0) return null
        val episodeId = target.episodeId ?: return if (target.moment == null) "${ShareRules.ORIGIN}/episodes/${target.podcastId}" else null
        if (episodeId <= 0) return null
        val path = "${ShareRules.ORIGIN}/episodes/${target.podcastId}/$episodeId"
        val moment = target.moment ?: return path
        return query(moment)?.let { "$path?$it" }
    }

    fun parse(url: String): SharedLink? {
        val uri = runCatching { URI(url) }.getOrNull() ?: return null
        if (uri.scheme?.lowercase() != "https" || uri.rawUserInfo != null || uri.port != -1 || uri.host?.lowercase() !in hosts) return null
        val path = uri.rawPath?.split('/') ?: return null
        if (path.size !in 3..4 || path[0].isNotEmpty() || path[1] != "episodes") return null
        val podcastId = canonicalId(path[2]) ?: return null
        val episodeId = path.getOrNull(3)?.let { canonicalId(it) ?: return null }
        val query = uri.rawQuery?.split('&').orEmpty().map { decode(it.substringBefore('=')) to decode(it.substringAfter('=', "")) }
        val times = query.filter { it.first == "t" }.map { it.second }
        val chapters = query.filter { it.first == "ch" }.map { it.second }
        val requested = times.isNotEmpty() || chapters.isNotEmpty()
        val moment = if (requested && episodeId != null) moment(times, chapters) else null
        return SharedLink(podcastId, episodeId, moment, requested && moment == null)
    }

    private fun query(moment: Moment): String? {
        val start = second(moment.start) ?: return null
        if (moment !is Moment.Range) return "t=${format(start.seconds)}"
        val end = second(moment.end)?.takeIf { it > start } ?: return null
        val range = "t=${format(start.seconds)}-${format(end.seconds)}"
        return when (moment) {
            is Moment.Clip -> range
            is Moment.Chapter -> "ch=${moment.number}&$range".takeIf { chapter.matches(moment.number.toString()) }
        }
    }

    private fun moment(times: List<String>, chapters: List<String>): Moment? {
        if (times.size != 1 || chapters.size > 1) return null
        val range = times.single().split('-')
        if (range.size > 2) return null
        val start = seconds(range[0]) ?: return null
        if (range.size == 1) return if (chapters.isEmpty()) Moment.Time(start) else null
        val end = seconds(range[1])?.takeIf { it > start } ?: return null
        val number = chapters.singleOrNull() ?: return Moment.Clip(start, end)
        return if (chapter.matches(number)) Moment.Chapter(number.toInt(), start, end) else null
    }

    private fun seconds(token: String): Duration? {
        if (token.isEmpty()) return null
        val (hours, minutes, seconds) = time.matchEntire(token)?.groupValues?.drop(1)?.map { it.toLongOrNull() } ?: return null
        if (hours != null && minutes != null && minutes >= 60) return null
        if ((hours != null || minutes != null) && seconds != null && seconds >= 60) return null
        val total = ((hours ?: 0) * 3600 + (minutes ?: 0) * 60 + (seconds ?: 0)).seconds
        return total.takeIf { it <= ShareRules.maxTime }
    }

    private fun second(time: Duration): Long? =
        time.takeIf { it.isFinite() && it >= Duration.ZERO && it <= ShareRules.maxTime }?.inWholeSeconds

    private fun pad(value: Long) = value.toString().padStart(2, '0')

    private fun decode(value: String) = runCatching { URLDecoder.decode(value, Charsets.UTF_8) }.getOrDefault(value)
}
