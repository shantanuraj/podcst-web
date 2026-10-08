import XCTest
@testable import Podcst

@MainActor
final class AudioPreferencesTests: XCTestCase {
    func testOverridesKeepTheirIntentAcrossDefaultChangesAndRelaunch() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("preferences.json")
        let feed = "https://private.example/feed?token=secret"
        let preferences = AudioPreferences(storageURL: url)
        XCTAssertEqual(preferences.options(for: feed), AudioOptions())
        preferences.set(AudioOptions(), for: feed)
        preferences.set(AudioOptions(speed: 1.5, effects: AudioEffects(volumeBoost: true, trimSilence: true)))
        XCTAssertEqual(preferences.options(for: feed), AudioOptions())
        XCTAssertEqual(preferences.options(for: "other"), preferences.defaults)
        let restored = AudioPreferences(storageURL: url)
        XCTAssertTrue(restored.hasOverride(for: feed))
        XCTAssertEqual(restored.options(for: feed), AudioOptions())
        XCTAssertFalse(try String(contentsOf: url, encoding: .utf8).contains("secret"))
        restored.useDefaults(for: feed)
        XCTAssertEqual(restored.options(for: feed), preferences.defaults)
        XCTAssertFalse(restored.hasOverride(for: feed))
    }

    // Progress outbox coverage moved to DurableStateStoreTests. Old unsequenced
    // replay and logout-drop expectations are intentionally no longer valid.
}
