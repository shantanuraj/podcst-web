package app.podcst.artwork

import coil3.Extras

data class ArtworkColors(val light: Int, val dark: Int) {
    fun encoded(): String = "${light.toUInt().toString(16)}\n${dark.toUInt().toString(16)}"

    companion object {
        fun fromHeaders(light: String?, dark: String?): ArtworkColors? {
            fun parse(value: String?): Int? = value?.takeIf { it.matches(Regex("#[a-fA-F0-9]{6}")) }
                ?.drop(1)?.toIntOrNull(16)?.or(0xFF000000.toInt())
            return ArtworkColors(parse(light) ?: return null, parse(dark) ?: return null)
        }

        fun decode(value: String): ArtworkColors? {
            val parts = value.lines().takeIf { it.size == 2 } ?: return null
            val light = parts[0].toUIntOrNull(16)?.toInt() ?: return null
            val dark = parts[1].toUIntOrNull(16)?.toInt() ?: return null
            return ArtworkColors(light, dark).takeIf { light ushr 24 == 255 && dark ushr 24 == 255 }
        }
    }
}

class ArtworkMetadata(var colors: ArtworkColors? = null) {
    companion object {
        val Key = Extras.Key<ArtworkMetadata?>(null)
    }
}
