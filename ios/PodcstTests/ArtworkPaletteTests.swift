import CoreGraphics
import XCTest
@testable import Podcst

final class ArtworkPaletteTests: XCTestCase {
    func testHSLMatchesAndroidColorUtils() {
        let red = ArtworkPalette.HSL(0xFF0000)
        XCTAssertEqual(red.hue, 0)
        XCTAssertEqual(red.saturation, 1)
        XCTAssertEqual(red.lightness, 0.5)
        let teal = ArtworkPalette.HSL(0x336666)
        XCTAssertEqual(teal.hue, 180, accuracy: 0.001)
        XCTAssertEqual(teal.saturation, 1 / 3, accuracy: 0.001)
        XCTAssertEqual(teal.lightness, 0.3, accuracy: 0.001)
        let magenta = ArtworkPalette.HSL(0xFF00CC)
        XCTAssertEqual(magenta.hue, 312, accuracy: 0.001)
    }

    func testDefaultFilterRejectsBlackWhiteAndSkinTones() {
        XCTAssertFalse(ArtworkPalette.HSL(0x080808).allowed)
        XCTAssertFalse(ArtworkPalette.HSL(0xF8F8F8).allowed)
        XCTAssertFalse(ArtworkPalette.HSL(0xD2A07C).allowed)
        XCTAssertTrue(ArtworkPalette.HSL(0x336666).allowed)
    }

    func testTargetsScoreAndClaimSwatchesExclusively() {
        let darkMuted = ArtworkPalette.Swatch(rgb: 0x3D4A4A, population: 40)
        let darkVibrant = ArtworkPalette.Swatch(rgb: 0x0A3D80, population: 10)
        let lightMuted = ArtworkPalette.Swatch(rgb: 0xB8C4C4, population: 20)
        let lightVibrant = ArtworkPalette.Swatch(rgb: 0x80C0FF, population: 30)
        let palette = ArtworkPalette(swatches: [darkMuted, darkVibrant, lightMuted, lightVibrant])
        XCTAssertEqual(palette.dominant, darkMuted)
        XCTAssertEqual(palette[.darkMuted], darkMuted)
        XCTAssertEqual(palette[.darkVibrant], darkVibrant)
        XCTAssertEqual(palette[.lightMuted], lightMuted)
        XCTAssertEqual(palette[.lightVibrant], lightVibrant)
        XCTAssertNil(palette[.muted])
        XCTAssertEqual(palette.tint, ArtworkTint(light: lightMuted.rgb, dark: darkMuted.rgb))
    }

    func testTintFallsBackFromMutedToVibrantToDominant() {
        let darkVibrant = ArtworkPalette.Swatch(rgb: 0x0A3D80, population: 10)
        let vibrant = ArtworkPalette.Swatch(rgb: 0x1F7AE0, population: 50)
        XCTAssertEqual(ArtworkPalette(swatches: [darkVibrant, vibrant]).tint, ArtworkTint(light: vibrant.rgb, dark: darkVibrant.rgb))
        XCTAssertEqual(ArtworkPalette(swatches: [vibrant]).tint, ArtworkTint(light: vibrant.rgb, dark: vibrant.rgb))
        XCTAssertNil(ArtworkPalette(swatches: []).tint)
    }

    func testAnEarlierTargetClaimsTheSwatchALaterTargetWouldScoreHighest() {
        let shared = ArtworkPalette.Swatch(rgb: 0x2B5C3A, population: 50)
        let other = ArtworkPalette.Swatch(rgb: 0x1E2B24, population: 5)
        let palette = ArtworkPalette(swatches: [shared, other])
        XCTAssertEqual(palette[.darkVibrant], shared)
        XCTAssertEqual(palette[.darkMuted], other)
    }

    func testQuantizationKeepsDistinctColorsWithTheirPopulations() {
        let pixels = Array(repeating: UInt32(0x336666), count: 30) + Array(repeating: UInt32(0x1F7AE0), count: 10) + Array(repeating: UInt32(0x000000), count: 60)
        let swatches = ArtworkPalette.quantize(pixels)
        XCTAssertEqual(Set(swatches.map(\.population)), [30, 10])
        XCTAssertEqual(swatches.first { $0.population == 30 }?.rgb, 0x306060)
    }

    func testQuantizationCutsManyColorsIntoAtMostTheRequestedBoxes() {
        let pixels = (0..<4096).map { (index: Int) -> UInt32 in
            let red = UInt32(index % 64 * 4)
            let green = UInt32(index / 64 * 4)
            return red << 16 | green << 8 | 0x80
        }
        let swatches = ArtworkPalette.quantize(pixels)
        XCTAssertLessThanOrEqual(swatches.count, 16)
        XCTAssertGreaterThan(swatches.count, 8)
        XCTAssertTrue(swatches.allSatisfy { ArtworkPalette.HSL($0.rgb).allowed })
    }

    func testImageDerivesATintFromItsPixels() throws {
        let context = try XCTUnwrap(CGContext(data: nil, width: 64, height: 64, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.setFillColor(red: 0.2, green: 0.4, blue: 0.4, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
        let image = try XCTUnwrap(context.makeImage())
        XCTAssertEqual(ArtworkPalette(image).tint, ArtworkTint(light: 0x306060, dark: 0x306060))
    }
}
