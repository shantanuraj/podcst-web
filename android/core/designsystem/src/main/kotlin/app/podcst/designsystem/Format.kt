package app.podcst.designsystem

import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.time.Duration
import kotlin.time.Duration.Companion.days
import kotlin.time.Instant
import kotlin.time.toJavaInstant

object Format {
    fun clock(duration: Duration): String {
        val total = duration.inWholeSeconds.coerceAtLeast(0)
        val hours = total / 3600
        val minutes = (total % 3600) / 60
        val seconds = total % 60
        return if (hours > 0) "%d:%02d:%02d".format(hours, minutes, seconds) else "%02d:%02d".format(minutes, seconds)
    }

    fun remainingClock(duration: Duration): String = "−" + clock(duration)

    fun length(duration: Duration): String {
        val minutes = duration.inWholeMinutes.coerceAtLeast(if (duration.isPositive()) 1 else 0)
        val hours = minutes / 60
        val rest = minutes % 60
        return when {
            hours == 0L -> "$rest min"
            rest == 0L -> "$hours hr"
            else -> "$hours hr $rest min"
        }
    }

    fun left(duration: Duration): String = "${length(duration)} left"

    fun month(instant: Instant): String = pattern("MMM").format(instant.toJavaInstant()).uppercase()

    fun day(instant: Instant): String = pattern("dd").format(instant.toJavaInstant())

    fun date(instant: Instant): String =
        DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withZone(zone).format(instant.toJavaInstant())

    fun longDate(instant: Instant): String =
        DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withZone(zone).format(instant.toJavaInstant())

    fun recent(instant: Instant, now: Instant): Boolean = now - instant < 7.days

    private val zone: ZoneId get() = ZoneId.systemDefault()

    private fun pattern(pattern: String) = DateTimeFormatter.ofPattern(pattern, Locale.getDefault()).withZone(zone)
}
