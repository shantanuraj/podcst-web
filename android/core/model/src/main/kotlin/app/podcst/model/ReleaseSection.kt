package app.podcst.model

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import kotlin.time.Instant
import kotlin.time.toJavaInstant

data class ReleaseSection(val day: LocalDate?, val episodes: List<Episode>) {
    sealed interface Title {
        data object Today : Title
        data object Yesterday : Title
        data class Weekday(val day: DayOfWeek) : Title
        data class Date(val day: LocalDate) : Title
        data object Unavailable : Title
    }

    fun title(now: Instant): Title {
        val day = day ?: return Title.Unavailable
        return when (age(now)) {
            0L -> Title.Today
            1L -> Title.Yesterday
            in 2L..6L -> Title.Weekday(day.dayOfWeek)
            else -> Title.Date(day)
        }
    }

    fun recent(now: Instant): Boolean = age(now) in 0L..6L

    private fun age(now: Instant): Long? = day?.let { ChronoUnit.DAYS.between(it, utc(now)) }

    companion object {
        fun group(episodes: List<Episode>): List<ReleaseSection> =
            episodes.groupBy { episode -> episode.published?.let(::utc) }.map { (day, members) -> ReleaseSection(day, members) }

        private fun utc(instant: Instant): LocalDate = instant.toJavaInstant().atZone(ZoneOffset.UTC).toLocalDate()
    }
}
