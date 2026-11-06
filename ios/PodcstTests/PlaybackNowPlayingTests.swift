import Foundation
import MediaPlayer
import XCTest
@testable import Podcst

@MainActor
final class PlaybackNowPlayingTests: XCTestCase {
    func testSystemCommandsOfferPodcastSkippingAlongsideEpisodeNavigation() {
        let center = MPRemoteCommandCenter.shared()
        let commands = [
            center.playCommand, center.pauseCommand, center.togglePlayPauseCommand,
            center.nextTrackCommand, center.previousTrackCommand, center.changePlaybackPositionCommand,
            center.skipBackwardCommand, center.skipForwardCommand, center.changePlaybackRateCommand,
        ]
        let enabled = commands.map(\.isEnabled)
        let backwardIntervals = center.skipBackwardCommand.preferredIntervals
        let forwardIntervals = center.skipForwardCommand.preferredIntervals
        let supportedRates = center.changePlaybackRateCommand.supportedPlaybackRates
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        center.skipBackwardCommand.isEnabled = false
        center.skipForwardCommand.isEnabled = false
        center.skipBackwardCommand.preferredIntervals = [15]
        center.skipForwardCommand.preferredIntervals = [15]
        center.changePlaybackRateCommand.isEnabled = false
        center.changePlaybackRateCommand.supportedPlaybackRates = [1]
        let controller = PlaybackController(
            transport: NowPlayingTransport(),
            persistenceURL: directory.appendingPathComponent("playback.json"),
            preferences: AudioPreferences(),
            integratesWithSystem: true,
            nowPlayingInfoSink: { _ in }
        )
        defer {
            controller.shutdown()
            for (command, wasEnabled) in zip(commands, enabled) { command.isEnabled = wasEnabled }
            center.skipBackwardCommand.preferredIntervals = backwardIntervals
            center.skipForwardCommand.preferredIntervals = forwardIntervals
            center.changePlaybackRateCommand.supportedPlaybackRates = supportedRates
            try? FileManager.default.removeItem(at: directory)
        }

        XCTAssertTrue(center.skipBackwardCommand.isEnabled)
        XCTAssertTrue(center.skipForwardCommand.isEnabled)
        XCTAssertEqual(center.skipBackwardCommand.preferredIntervals, [10])
        XCTAssertEqual(center.skipForwardCommand.preferredIntervals, [30])
        XCTAssertTrue(center.nextTrackCommand.isEnabled)
        XCTAssertTrue(center.previousTrackCommand.isEnabled)
        XCTAssertTrue(center.changePlaybackRateCommand.isEnabled)
        XCTAssertEqual(center.changePlaybackRateCommand.supportedPlaybackRates, PlaybackController.supportedRates.map(NSNumber.init(value:)))
        XCTAssertFalse(controller.isPlaybackRequested)
    }

    func testPausedSpeedChangesPublishTheSelectedRateWithoutStartingPlayback() {
        let (controller, transport, _, recorder) = makeController()
        controller.restore(episode("current"), at: 40)
        transport.emit(.ready(duration: 300))
        controller.enqueue(episode("next"))

        controller.setRate(1.5)

        XCTAssertEqual(controller.rate, 1.5)
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyDefaultPlaybackRate] as? Double, 1.5)
        XCTAssertEqual((recorder.last?[MPNowPlayingInfoPropertyPlaybackRate] as? NSNumber)?.doubleValue, 0)
        XCTAssertEqual(controller.currentTime, 40)
        XCTAssertEqual(controller.upNext.map(\.title), ["next"])
        XCTAssertEqual(controller.state, .paused)
        XCTAssertFalse(controller.isPlaybackRequested)

        controller.setRate(3)
        XCTAssertEqual(controller.rate, 1.5)
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyDefaultPlaybackRate] as? Double, 1.5)

        controller.resume()
        transport.emit(.ready(duration: 300))
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 1.5)
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyDefaultPlaybackRate] as? Double, 1.5)
    }

    func testPodcastSkippingKeepsTheEpisodeAndUpdatesNowPlayingImmediately() {
        let (controller, transport, _, recorder) = makeController()
        let current = episode("current")
        controller.play(current, at: 40)
        controller.enqueue(episode("next"))
        transport.emit(.ready(duration: 300))

        controller.skipBackward()
        XCTAssertEqual(controller.currentTime, 30)
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double, 30)
        XCTAssertTrue(controller.isPlaybackRequested)

        controller.skipForward()
        XCTAssertEqual(controller.currentTime, 60)
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double, 60)
        XCTAssertEqual(controller.currentEpisode, current)
        XCTAssertEqual(controller.upNext.map(\.title), ["next"])

        controller.pause()
        controller.seek(to: 5)
        controller.skipBackward()
        XCTAssertEqual(controller.currentTime, 0)
        XCTAssertFalse(controller.isPlaybackRequested)
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double, 0)
    }

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
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyDefaultPlaybackRate] as? Double, 1.5)
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

    func testStopClearsSystemPlayerUntilPlaybackResumes() {
        let (controller, transport, _, recorder) = makeController()
        controller.play(episode("first"))
        transport.emit(.ready(duration: 300))
        transport.emit(.position(40))
        controller.stop()
        XCTAssertNil(recorder.last)

        controller.resume()
        XCTAssertEqual(recorder.last?[MPMediaItemPropertyTitle] as? String, "first")
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double, 40)
    }

    func testChapterTitlesFollowBoundariesAndSeeksWithoutLosingEpisodeContext() {
        let (controller, transport, clock, recorder) = makeController()
        var current = episode("Diner Lobster")
        current.podcastTitle = "Accidental Tech Podcast"
        current.author = "Podcast authors"
        current.showNotes = "00:10 Opening\n00:20 Duo acquisition"
        controller.play(current)
        transport.emit(.ready(duration: 300))
        controller.enqueue(episode("next"))
        XCTAssertEqual(recorder.last?[MPMediaItemPropertyTitle] as? String, current.title)
        recorder.entries.removeAll()

        clock.time = 0.1
        transport.emit(.position(10))
        XCTAssertEqual(recorder.last?[MPMediaItemPropertyTitle] as? String, "Opening")
        XCTAssertEqual(recorder.last?[MPMediaItemPropertyAlbumTitle] as? String, current.title)
        XCTAssertEqual(recorder.last?[MPMediaItemPropertyArtist] as? String, current.podcastTitle)
        XCTAssertEqual(recorder.last?[MPMediaItemPropertyPlaybackDuration] as? Double, 300)
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double, 10)
        XCTAssertEqual(recorder.entries.count, 1)

        clock.time = 0.2
        transport.emit(.position(15))
        XCTAssertEqual(recorder.entries.count, 1)
        transport.emit(.position(20))
        XCTAssertEqual(recorder.entries.count, 2)
        XCTAssertEqual(recorder.last?[MPMediaItemPropertyTitle] as? String, "Duo acquisition")

        controller.pause()
        controller.seek(to: 10)
        XCTAssertEqual(recorder.last?[MPMediaItemPropertyTitle] as? String, "Opening")
        XCTAssertEqual((recorder.last?[MPNowPlayingInfoPropertyPlaybackRate] as? NSNumber)?.doubleValue, 0)
        XCTAssertFalse(controller.isPlaybackRequested)
        XCTAssertEqual(controller.upNext.map(\.title), ["next"])

        controller.seek(to: 0)
        XCTAssertEqual(recorder.last?[MPMediaItemPropertyTitle] as? String, current.title)
        XCTAssertEqual(recorder.last?[MPMediaItemPropertyAlbumTitle] as? String, current.podcastTitle)
        XCTAssertEqual(recorder.last?[MPMediaItemPropertyArtist] as? String, current.author)
        controller.play(episode("next"))
        XCTAssertEqual(recorder.last?[MPMediaItemPropertyTitle] as? String, "next")
        XCTAssertNil(recorder.last?[MPMediaItemPropertyAlbumTitle])
    }

    func testNativeChaptersArrivingAfterASeekUpdatePausedNowPlaying() async throws {
        var continuation: CheckedContinuation<ChapterMetadata?, Never>?
        let (controller, transport, _, recorder) = makeController(chapterLoader: { _ in
            await withCheckedContinuation { continuation = $0 }
        })
        controller.restore(episode("current"), at: 5)
        try await wait { continuation != nil }
        controller.seek(to: 25)
        transport.emit(.ready(duration: 300))
        XCTAssertEqual(recorder.last?[MPMediaItemPropertyTitle] as? String, "current")

        continuation?.resume(returning: ChapterMetadata([
            Chapter(title: "Opening", start: 10),
            Chapter(title: "Hidden cue", start: 15, isHidden: true),
            Chapter(title: "Duo acquisition", start: 20),
            Chapter(title: " \n ", start: 30),
        ]))
        try await wait { controller.chapters.count == 3 }
        XCTAssertEqual(recorder.last?[MPMediaItemPropertyTitle] as? String, "Duo acquisition")
        XCTAssertEqual(recorder.last?[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double, 25)
        XCTAssertEqual((recorder.last?[MPNowPlayingInfoPropertyPlaybackRate] as? NSNumber)?.doubleValue, 0)
        XCTAssertEqual(controller.state, .paused)
        XCTAssertFalse(controller.isPlaybackRequested)

        controller.seek(to: 15)
        XCTAssertEqual(recorder.last?[MPMediaItemPropertyTitle] as? String, "Opening")
        controller.seek(to: 35)
        XCTAssertEqual(recorder.last?[MPMediaItemPropertyTitle] as? String, "current")
    }

    func testLateChapterTitlesCannotCrossEpisodeOrAccountBoundaries() async throws {
        var continuations: [CheckedContinuation<ChapterMetadata?, Never>] = []
        let (controller, _, _, recorder) = makeController(chapterLoader: { _ in
            await withCheckedContinuation { continuations.append($0) }
        })
        let metadata = ChapterMetadata([Chapter(title: "Opening", start: 0), Chapter(title: "Ending", start: 20)])
        controller.play(episode("first"))
        try await wait { continuations.count == 1 }
        controller.play(episode("second"))
        continuations[0].resume(returning: metadata)
        try await wait { continuations.count == 2 }
        XCTAssertEqual(recorder.last?[MPMediaItemPropertyTitle] as? String, "second")
        XCTAssertTrue(controller.chapters.isEmpty)

        controller.beginAccountChange()
        continuations[1].resume(returning: metadata)
        await controller.releaseChapterMetadata()
        XCTAssertNil(recorder.last)
        XCTAssertTrue(controller.chapters.isEmpty)
    }

    private func makeController(chapterLoader: (@MainActor (Episode) async -> ChapterMetadata?)? = nil) -> (PlaybackController, NowPlayingTransport, NowPlayingClock, NowPlayingRecorder) {
        let transport = NowPlayingTransport()
        let clock = NowPlayingClock()
        let recorder = NowPlayingRecorder()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let controller = PlaybackController(
            transport: transport,
            persistenceURL: directory.appendingPathComponent("playback.json"),
            preferences: AudioPreferences(),
            monotonicTime: { clock.time },
            nowPlayingInfoSink: { recorder.entries.append((clock.time, $0)) },
            chapterLoader: chapterLoader
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

    private func wait(_ condition: () -> Bool) async throws {
        for _ in 0..<200 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(5))
        }
        throw NSError(domain: "PlaybackNowPlayingTests", code: 1)
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
