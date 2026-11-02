package app.podcst.artwork

import org.junit.Assert.*
import org.junit.Test

class ArtworkColorsTest {
    @Test fun serverTintsRoundTripThroughRetainedMetadata() {
        val colors = requireNotNull(ArtworkColors.fromHeaders("#b8a8b0", "#706878"))
        assertEquals(0xFFB8A8B0.toInt(), colors.light)
        assertEquals(0xFF706878.toInt(), colors.dark)
        assertEquals(colors, ArtworkColors.decode(colors.encoded()))
    }

    @Test fun incompleteOrMalformedMetadataUsesTheLocalPalette() {
        assertNull(ArtworkColors.fromHeaders("#b8a8b0", null))
        assertNull(ArtworkColors.fromHeaders("b8a8b0", "#706878"))
        assertNull(ArtworkColors.fromHeaders("#123", "#706878"))
        assertNull(ArtworkColors.decode("ffb8a8b0\ninvalid\nff706878"))
        assertNull(ArtworkColors.decode("b8a8b0\nff706878"))
        assertNull(ArtworkColors.decode("ffb8a8b0\n"))
    }
}
