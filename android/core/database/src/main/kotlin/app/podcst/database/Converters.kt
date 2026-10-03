package app.podcst.database

import androidx.room.TypeConverter

internal class Converters {
    @TypeConverter
    fun keywords(value: List<String>): String = value.joinToString(SEPARATOR)

    @TypeConverter
    fun keywords(value: String): List<String> = if (value.isEmpty()) emptyList() else value.split(SEPARATOR)

    private companion object {
        const val SEPARATOR = "\u001F"
    }
}
