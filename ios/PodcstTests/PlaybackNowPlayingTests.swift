import Foundation
import MediaPlayer
import XCTest
@testable import Podcst

@MainActor
final class PlaybackNowPlayingTests: XCTestCase {
    func testFastPositionUpdatesPublishNowPlayingAtMostOncePerSecond() {
        let (controller, transport, clock, recorder) = makeController()
        controller.play(episode("first"))
        transport.emit(.ready(duration: 300))
        recorder.entries.removeAll()

        for frame in 1...500 {
            clock.time = Double(frame) / 50
            let position = Double(frame) / 25
            transport.emit(.position(position))
            XCTAssertEqual(controller.currentTime, position)
        }

        XCTAssertEqual(recorder.entries.count, 10)
        XCTAssertEqual(recorder.entries.map(\.time), (1...10).map(Double.init))
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double, 20)
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 1)
    }

    func testControlsAndSourceMetadataPublishImmediatelyBetweenPositionTicks() {
        let (controller, transport, clock, recorder) = makeController()
        controller.play(episode("first"))
        transport.emit(.ready(duration: 300))
        recorder.entries.removeAll()
        clock.time = 0.1
        transport.emit(.position(20))
        XCTAssertTrue(recorder.entries.isEmpty)

        controller.pause()
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double, 20)
        XCTAssertEqual((recorder.last?[MPNowPlayingInfoPropertyPlaybackRate] as? NSNumber)?.doubleValue, 0)
        controller.resume()
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 1)

        controller.seek(to: 70)
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double, 70)
        transport.emit(.seeked(70.25))
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double, 70.25)
        transport.emit(.ready(duration: 300))
        controller.setRate(1.5)
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 1.5)
        controller.holdDoubleSpeed(true)
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 2)
        controller.holdDoubleSpeed(false)
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 1.5)

        transport.emit(.duration(350))
        XCTAssertEqual(recorder.last?[MPMediaItemPropertyPlaybackDuration] as? Double, 350)
        controller.play(episode("second"), at: 5)
        XCTAssertEqual(recorder.last?[MPMediaItemPropertyTitle] as? String, "second")
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double, 5)
        XCTAssertTrue(recorder.entries.allSatisfy { $0.time == 0.1 })

        controller.clear()
        XCTAssertNil(recorder.last)
    }

    func testImmediateUpdateRestartsPeriodicBudgetAndShutdownClearsSystemState() {
        let (controller, transport, clock, recorder) = makeController()
        controller.play(episode("first"))
        transport.emit(.ready(duration: 300))
        clock.time = 0.75
        controller.setRate(1.5)
        recorder.entries.removeAll()

        clock.time = 1
        transport.emit(.position(1))
        clock.time = 1.749
        transport.emit(.position(2))
        XCTAssertTrue(recorder.entries.isEmpty)
        clock.time = 1.75
        transport.emit(.position(3))
        XCTAssertEqual(recorder.entries.count, 1)
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double, 3)

        controller.shutdown()
        XCTAssertNil(recorder.last)
        let count = recorder.entries.count
        clock.time = 10
        transport.emit(.position(30))
        transport.emit(.playback(isPlaying: true))
        XCTAssertEqual(recorder.entries.count, count)
    }

    private func makeController() -> (PlaybackController, NowPlayingTransport, NowPlayingClock, NowPlayingRecorder) {
        let transport = NowPlayingTransport()
        let clock = NowPlayingClock()
        let recorder = NowPlayingRecorder()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let controller = PlaybackController(
            transport: transport,
            persistenceURL: directory.appendingPathComponent("playback.json"),
            preferences: AudioPreferences(),
            monotonicTime: { clock.time },
            nowPlayingInfoSink: { recorder.entries.append((clock.time, $0)) }
        )
        addTeardownBlock {
            await MainActor.run { controller.shutdown() }
            try? FileManager.default.removeItem(at: directory)
        }
        return (controller, transport, clock, recorder)
    }

    private func episode(_ title: String) -> Episode {
        Episode(guid: title, feed: "https://example.com/feed", title: title, file: EpisodeFile(url: "https://example.com/\(title).mp3"))
    }
}

@MainActor
private final class NowPlayingClock {
    var time: TimeInterval = 0
}

@MainActor
private final class NowPlayingRecorder {
    var entries: [(time: TimeInterval, info: [String: Any]?)] = []
    var last: [String: Any]? { entries.last?.info }
}

@MainActor
private final class NowPlayingTransport: PlaybackTransport {
    var onUpdate: (@MainActor (PlaybackTransportUpdate) -> Void)?
    var hasSource = false
    var position: TimeInterval = 0
    private var generation = UUID()

    func load(source: PlaybackSource, at position: TimeInterval, generation: UUID) {
        self.position = position
        self.generation = generation
        hasSource = true
    }

    func play(atRate rate: Double) { emit(.playback(isPlaying: true)) }
    func pause() { emit(.playback(isPlaying: false)) }
    func setRate(_ rate: Double) {}
    func setEffects(_ effects: AudioEffects) {}

    func seek(to position: TimeInterval, generation: UUID) {
        self.position = position
        self.generation = generation
    }

    func stop() { hasSource = false }
    func shutdown() { stop() }

    func emit(_ event: PlaybackTransportEvent) {
        if case .position(let position) = event { self.position = position }
        onUpdate?(PlaybackTransportUpdate(generation: generation, event: event))
    }
}
