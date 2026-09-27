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

    func testProgressWritesCoalesceBehindAnInFlightRequest() async {
        var sent: [PlaybackProgressWriter.Update] = []
        var release: CheckedContinuation<Void, Never>?
        let writer = PlaybackProgressWriter { update in
            sent.append(update)
            if sent.count == 1 { await withCheckedContinuation { release = $0 } }
        }
        writer.submit(.init(episodeID: 1, position: 60, completed: false))
        while release == nil { await Task.yield() }
        writer.submit(.init(episodeID: 1, position: 70, completed: false))
        writer.submit(.init(episodeID: 1, position: 10, completed: false))
        writer.submit(.init(episodeID: 2, position: 100, completed: true))
        XCTAssertEqual(sent.count, 1)
        release?.resume()
        await writer.flush()
        XCTAssertEqual(sent, [
            .init(episodeID: 1, position: 60, completed: false),
            .init(episodeID: 1, position: 10, completed: false),
            .init(episodeID: 2, position: 100, completed: true)
        ])
    }

    func testFailedProgressSurvivesRelaunchAndNewerPositionWins() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("progress.json")
        let offline = PlaybackProgressWriter(storageURL: url) { _ in throw URLError(.notConnectedToInternet) }
        offline.submit(.init(episodeID: 1, position: 60, completed: false))
        await offline.flush()
        offline.submit(.init(episodeID: 1, position: 15, completed: false))
        await offline.flush()
        var sent: [PlaybackProgressWriter.Update] = []
        let restored = PlaybackProgressWriter(storageURL: url) { sent.append($0) }
        await restored.flush()
        XCTAssertEqual(sent, [.init(episodeID: 1, position: 15, completed: false)])
        let empty = try JSONDecoder().decode([PlaybackProgressWriter.Update].self, from: Data(contentsOf: url))
        XCTAssertTrue(empty.isEmpty)
    }

    func testAccountResetDropsQueuedProgress() async {
        var release: CheckedContinuation<Void, Never>?
        var sent: [Int] = []
        let writer = PlaybackProgressWriter { update in
            sent.append(update.episodeID)
            await withCheckedContinuation { release = $0 }
        }
        writer.submit(.init(episodeID: 1, position: 30, completed: false))
        while release == nil { await Task.yield() }
        writer.submit(.init(episodeID: 2, position: 40, completed: false))
        let reset = Task { await writer.reset() }
        await Task.yield()
        release?.resume()
        await reset.value
        await writer.flush()
        XCTAssertEqual(sent, [1])
    }
}
