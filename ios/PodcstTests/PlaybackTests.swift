import AVFoundation
import Foundation
import MediaPlayer
import XCTest
@testable import Podcst

@MainActor
final class PlaybackTests: XCTestCase {
    func testSystemAudioSessionAllowsPlaybackToReachTransport() {
        let session = AVAudioSession.sharedInstance()
        let previousCategory = session.category
        let previousMode = session.mode
        let previousPolicy = session.routeSharingPolicy
        let previousOptions = session.categoryOptions
        let nowPlaying = MPNowPlayingInfoCenter.default()
        let previousInfo = nowPlaying.nowPlayingInfo
        let commands = MPRemoteCommandCenter.shared()
        let previousCommands = [
            commands.playCommand, commands.pauseCommand, commands.togglePlayPauseCommand,
            commands.nextTrackCommand, commands.previousTrackCommand, commands.changePlaybackPositionCommand,
        ].map { ($0, $0.isEnabled) }
        let url = temporaryURL()
        let transport = FakePlaybackTransport()
        let controller = PlaybackController(
            transport: transport,
            persistenceURL: url,
            preferences: AudioPreferences(),
            integratesWithSystem: true
        )
        defer {
            controller.shutdown()
            XCTAssertNoThrow(try session.setActive(false, options: .notifyOthersOnDeactivation))
            XCTAssertNoThrow(try session.setCategory(previousCategory, mode: previousMode, policy: previousPolicy, options: previousOptions))
            nowPlaying.nowPlayingInfo = previousInfo
            for (command, enabled) in previousCommands { command.isEnabled = enabled }
            try? FileManager.default.removeItem(at: url)
        }

        XCTAssertEqual(controller.state, .idle)
        XCTAssertEqual(session.category, .playback)
        XCTAssertEqual(session.mode, .spokenAudio)
        XCTAssertTrue(session.categoryOptions.isEmpty)
        var item = episode(guid: "audio-session")
        item.file = EpisodeFile(url: url.appendingPathExtension("mp3").absoluteString)
        controller.play(item)

        XCTAssertTrue(transport.hasSource)
        XCTAssertEqual(controller.state, .loading)
        transport.becomeReady(duration: 30)
        XCTAssertEqual(controller.state, .playing)
        XCTAssertEqual(transport.playedRates, [1])
    }

    func testPlaybackStateBelongsToItsAccountAndSwitchingClearsIt() {
        let url = temporaryURL()
        let transport = FakePlaybackTransport()
        let first = PlaybackController(transport: transport, persistenceURL: url, accountID: "first")
        first.play(episode(guid: "private"), at: 30)
        let sameAccount = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: url, accountID: "first")
        XCTAssertEqual(sameAccount.currentEpisode?.guid, "private")
        let otherAccount = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: url, accountID: "second")
        XCTAssertNil(otherAccount.currentEpisode)
        first.switchAccount(to: "second")
        XCTAssertFalse(transport.hasSource)
        XCTAssertTrue(first.queue.isEmpty)
        XCTAssertEqual(first.state, .idle)
        XCTAssertNil(PlaybackController(transport: FakePlaybackTransport(), persistenceURL: url, accountID: "first").currentEpisode)
    }

    func testToggleCancelsPlayIntentWhileLoadingAndBuffering() {
        let transport = FakePlaybackTransport()
        let controller = PlaybackController(transport: transport, persistenceURL: temporaryURL())
        controller.play(episode(guid: "pending"))
        XCTAssertEqual(controller.state, .loading)
        XCTAssertTrue(controller.isPlaybackRequested)
        controller.toggle()
        XCTAssertFalse(controller.isPlaybackRequested)
        transport.becomeReady(duration: 300)
        XCTAssertEqual(controller.state, .paused)
        XCTAssertTrue(transport.playedRates.isEmpty)
        controller.resume()
        XCTAssertTrue(controller.isPlaying)
        transport.emit(.playback(isPlaying: false))
        XCTAssertEqual(controller.state, .loading)
        controller.toggle()
        transport.becomeReady(duration: 300)
        XCTAssertEqual(controller.state, .paused)
        XCTAssertEqual(transport.playedRates.count, 1)
    }

    func testAccountRetirementRejectsPlayRequestsUntilScopeChanges() {
        let transport = FakePlaybackTransport()
        let controller = PlaybackController(transport: transport, persistenceURL: temporaryURL(), accountID: "first")
        controller.play(episode(guid: "private"))
        controller.beginAccountChange()
        controller.resume()
        controller.next()
        controller.play(episode(guid: "replacement"))
        XCTAssertFalse(transport.hasSource)
        XCTAssertFalse(controller.isPlaybackRequested)
        controller.switchAccount(to: "second")
        XCTAssertTrue(controller.queue.isEmpty)
        controller.play(episode(guid: "new-account"))
        XCTAssertTrue(transport.hasSource)
    }

    func testForwardSeekIsNotClampedByAnInaccurateFeedDuration() {
        let transport = FakePlaybackTransport()
        let controller = PlaybackController(transport: transport, persistenceURL: temporaryURL())
        var item = episode(guid: "long-recording")
        item.duration = 10
        controller.play(item)
        transport.becomeReady(duration: 0)
        transport.advance(to: 20)
        controller.skipForward()
        XCTAssertEqual(transport.position, 50)
        XCTAssertEqual(controller.currentTime, 50)
    }

    func testQueueMoveKeepsCurrentEpisodeIdentity() {
        let controller = makeController(persistenceURL: temporaryURL())
        let first = episode(guid: "first")
        let second = episode(guid: "second")
        let third = episode(guid: "third")

        controller.enqueue(first)
        controller.enqueue(second)
        controller.enqueue(third)
        controller.play(second)
        controller.move(fromOffsets: IndexSet(integer: 1), toOffset: 3)

        XCTAssertEqual(controller.queue.map(\.guid), ["first", "third", "second"])
        XCTAssertEqual(controller.currentEpisode?.guid, "second")
        XCTAssertEqual(controller.currentIndex, 2)
    }

    func testRemoveCurrentSelectsRemainingEpisodeAndPersists() {
        let url = temporaryURL()
        let controller = makeController(persistenceURL: url)
        let first = episode(guid: "first")
        let second = episode(guid: "second")

        controller.enqueue(first)
        controller.enqueue(second)
        controller.play(first, at: 17)
        controller.remove(atOffsets: IndexSet(integer: 0))

        XCTAssertEqual(controller.queue.map(\.guid), ["second"])
        XCTAssertEqual(controller.currentEpisode?.guid, "second")
        XCTAssertEqual(controller.currentTime, 0)

        let restored = makeController(persistenceURL: url)
        XCTAssertEqual(restored.queue.map(\.guid), ["second"])
        XCTAssertEqual(restored.currentEpisode?.guid, "second")
    }

    func testEnqueueDoesNotDuplicateCurrentPlaybackWhenPlayingEpisode() {
        let controller = makeController(persistenceURL: temporaryURL())
        let item = episode(guid: "same")

        controller.play(item)
        controller.play(item, at: 29)

        XCTAssertEqual(controller.queue.count, 1)
        XCTAssertEqual(controller.currentTime, 29)
        XCTAssertEqual(controller.currentEpisode?.guid, "same")
    }

    func testShowNotesTimestampParsingSupportsMinuteAndHourFormats() {
        XCTAssertEqual(ShowNotesParser.seconds(from: "3:33"), 213)
        XCTAssertEqual(ShowNotesParser.seconds(from: "00:05:00"), 300)
        XCTAssertEqual(ShowNotesParser.seconds(from: "2:36:47"), 9407)
        XCTAssertNil(ShowNotesParser.seconds(from: "2:75"))
    }

    func testChaptersParseFromTimestampedShowNotes() {
        let notes = "<p>Why attention feels free.</p><ul><li>00:00 Cold open</li><li>(02:14) The price of a glance</li><li>17:40 – Scarcity, reconsidered</li><li>1:02:05 What we owe each other</li></ul><p>At 12:30 we digress.</p>"

        XCTAssertEqual(ShowNotesParser.chapters(notes), [
            Chapter(title: "Cold open", start: 0),
            Chapter(title: "The price of a glance", start: 134),
            Chapter(title: "Scarcity, reconsidered", start: 1060),
            Chapter(title: "What we owe each other", start: 3725),
        ])
        XCTAssertEqual(ShowNotesParser.chapters("<p>05:00 Only one chapter</p>"), [])
        XCTAssertEqual(ShowNotesParser.chapters("10:00 Late<br>02:00 Early"), [])
    }

    func testChapterNavigationFallsBackToEpisodes() {
        let controller = makeController(persistenceURL: temporaryURL())
        var chaptered = episode(guid: "chaptered")
        chaptered.showNotes = "00:00 Intro<br>01:00 Middle<br>02:00 End"
        chaptered.duration = 180

        controller.restore(chaptered, at: 70)
        XCTAssertEqual(controller.currentChapterIndex, 1)
        controller.nextChapter()
        XCTAssertEqual(controller.currentTime, 120)
        controller.seek(to: 130)
        controller.previousChapter()
        XCTAssertEqual(controller.currentTime, 120)
        controller.previousChapter()
        XCTAssertEqual(controller.currentTime, 60)
    }

    func testUpNextWrapsAfterCurrentAndEditsInThatOrder() {
        let controller = makeController(persistenceURL: temporaryURL())
        ["a", "b", "c", "d"].forEach { controller.enqueue(episode(guid: $0)) }
        controller.play(episode(guid: "c"))

        XCTAssertEqual(controller.upNext.map(\.guid), ["d", "a", "b"])

        controller.moveUpNext(fromOffsets: IndexSet(integer: 2), toOffset: 0)
        XCTAssertEqual(controller.upNext.map(\.guid), ["b", "d", "a"])
        XCTAssertEqual(controller.currentEpisode?.guid, "c")

        controller.removeUpNext(atOffsets: IndexSet(integer: 1))
        XCTAssertEqual(controller.upNext.map(\.guid), ["b", "a"])
        XCTAssertEqual(controller.currentEpisode?.guid, "c")
    }

    func testOPMLRoundTripsFeeds() {
        let podcasts = [
            Podcast(feed: "https://example.com/a.xml?x=1&y=2", title: "A & B"),
            Podcast(feed: "https://example.com/\"quoted\".xml", title: "Quoted"),
        ]

        XCTAssertEqual(OPML.feeds(in: OPML.document(podcasts)), podcasts.map(\.feed))
        XCTAssertEqual(OPML.feeds(in: "<outline text='x' xmlUrl='https://example.com/feed'/>"), ["https://example.com/feed"])
    }

    func testReadinessHonorsPauseDuringLoading() {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        controller.play(episode(guid: "first"))
        controller.pause()
        transport.becomeReady(duration: 100)

        XCTAssertEqual(controller.state, .paused)
        XCTAssertTrue(transport.playedRates.isEmpty)
        XCTAssertEqual(controller.duration, 100)
    }

    func testProgressUsesElapsedPlaybackTimeAfterBackwardSeek() {
        let transport = FakePlaybackTransport()
        let clock = FakePlaybackClock()
        let controller = makeController(transport: transport, clock: clock)
        var updates: [PlaybackUpdate] = []
        controller.onProgress = { updates.append($0) }
        controller.play(episode(guid: "first"), at: 120)
        transport.becomeReady(duration: 600)
        controller.setRate(2)
        clock.advance(by: 30)
        transport.advance(to: 180)
        XCTAssertEqual(updates.map(\.position), [180])

        controller.seek(to: 10)
        transport.finishSeek()
        XCTAssertEqual(updates.map(\.position), [180, 10])
        clock.advance(by: 29)
        transport.advance(to: 68)
        XCTAssertEqual(updates.count, 2)
        clock.advance(by: 1)
        transport.advance(to: 70)
        XCTAssertEqual(updates.map(\.position), [180, 10, 70])
    }

    func testProgressExcludesLoadingPauseAndBufferingTime() {
        let transport = FakePlaybackTransport()
        let clock = FakePlaybackClock()
        let controller = makeController(transport: transport, clock: clock)
        var updates: [PlaybackUpdate] = []
        controller.onProgress = { updates.append($0) }
        controller.play(episode(guid: "first"))
        clock.advance(by: 100)
        transport.becomeReady(duration: 600)
        clock.advance(by: 10)
        transport.advance(to: 10)
        transport.emit(.playback(isPlaying: false))
        clock.advance(by: 100)
        transport.advance(to: 10)
        XCTAssertTrue(updates.isEmpty)
        transport.emit(.playback(isPlaying: true))
        clock.advance(by: 20)
        transport.advance(to: 30)
        XCTAssertEqual(updates.map(\.position), [30])

        controller.pause()
        clock.advance(by: 100)
        controller.resume()
        clock.advance(by: 29)
        transport.advance(to: 59)
        XCTAssertEqual(updates.count, 2)
        clock.advance(by: 1)
        transport.advance(to: 60)
        XCTAssertEqual(updates.map(\.position), [30, 30, 60])
    }

    func testResumeWhilePlayingPreservesProgressWithoutAnotherTransportEvent() {
        let transport = FakePlaybackTransport()
        let clock = FakePlaybackClock()
        let controller = makeController(transport: transport, clock: clock)
        var updates: [PlaybackUpdate] = []
        controller.onProgress = { updates.append($0) }
        controller.play(episode(guid: "first"))
        transport.becomeReady(duration: 100)
        clock.advance(by: 20)
        transport.advance(to: 20)
        controller.resume()
        controller.resume()
        clock.advance(by: 10)
        transport.advance(to: 30)

        XCTAssertEqual(controller.state, .playing)
        XCTAssertEqual(transport.playedRates, [1])
        XCTAssertEqual(updates.map(\.position), [30])
    }

    func testDisconnectWhileLoadingCancelsPlaybackWhenReady() {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        controller.play(episode(guid: "first"))
        controller.handleRouteChange(reasonRaw: 2)
        transport.becomeReady(duration: 100)

        XCTAssertEqual(controller.state, .paused)
        XCTAssertTrue(transport.playedRates.isEmpty)
    }

    func testDisconnectWhileBufferingCancelsAutomaticPlayback() {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        controller.play(episode(guid: "first"))
        transport.becomeReady(duration: 100)
        transport.emit(.playback(isPlaying: false))
        controller.handleRouteChange(reasonRaw: 2)
        transport.becomeReady(duration: 100)

        XCTAssertEqual(controller.state, .paused)
        XCTAssertEqual(transport.playedRates, [1])
    }

    func testObsoleteEventsCannotOverwriteLatestSeekOrFinishEpisode() {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        controller.play(episode(guid: "first"))
        transport.becomeReady(duration: 600)
        let loadGeneration = transport.generation
        controller.seek(to: 100)
        let firstSeekGeneration = transport.generation
        controller.seek(to: 200)
        transport.finishSeek()
        transport.emit(.seeked(100), generation: firstSeekGeneration)
        transport.emit(.position(20), generation: loadGeneration)
        transport.emit(.ready(duration: 10), generation: loadGeneration)
        transport.emit(.ended, generation: firstSeekGeneration)
        transport.emit(.failed, generation: loadGeneration)

        XCTAssertEqual(controller.currentTime, 200)
        XCTAssertEqual(controller.currentEpisode?.guid, "first")
        XCTAssertEqual(controller.duration, 600)
        XCTAssertEqual(controller.state, .playing)
    }

    func testSwitchSavesOutgoingEpisodeAndRejectsItsLateEvents() {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        var updates: [PlaybackUpdate] = []
        controller.onProgress = { updates.append($0) }
        controller.play(episode(guid: "first"))
        transport.becomeReady(duration: 100)
        transport.advance(to: 27)
        let oldGeneration = transport.generation
        controller.play(episode(guid: "second"), at: 9)
        transport.emit(.position(99), generation: oldGeneration)
        transport.emit(.ended, generation: oldGeneration)

        XCTAssertEqual(updates.map(\.episode.guid), ["first"])
        XCTAssertEqual(updates.map(\.position), [27])
        XCTAssertEqual(controller.currentEpisode?.guid, "second")
        XCTAssertEqual(controller.currentTime, 9)
    }

    func testCompletionAdvancesQueueOnceAndRecordsSourceDuration() {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        var updates: [PlaybackUpdate] = []
        controller.onProgress = { updates.append($0) }
        controller.play(episode(guid: "first"))
        controller.enqueue(episode(guid: "second"))
        transport.becomeReady(duration: 100)
        let firstGeneration = transport.generation
        transport.emit(.ended)
        transport.emit(.ended, generation: firstGeneration)

        XCTAssertEqual(updates.count, 1)
        XCTAssertEqual(updates.first?.position, 100)
        XCTAssertEqual(updates.first?.completed, true)
        XCTAssertEqual(controller.queue.map(\.guid), ["second"])
        XCTAssertEqual(controller.currentTime, 0)
    }

    func testUserPauseDuringInterruptionCancelsAutomaticResume() {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        controller.play(episode(guid: "first"))
        transport.becomeReady(duration: 100)
        controller.handleInterruption(typeRaw: 1, optionsRaw: nil)
        controller.pause()
        controller.handleInterruption(typeRaw: 0, optionsRaw: 1)

        XCTAssertEqual(controller.state, .paused)
        XCTAssertEqual(transport.playedRates, [1])
    }

    func testInterruptionResumesWhenUserIntentIsUnchanged() {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        controller.play(episode(guid: "first"))
        transport.becomeReady(duration: 100)
        controller.handleInterruption(typeRaw: 1, optionsRaw: nil)
        controller.handleInterruption(typeRaw: 0, optionsRaw: 1)

        XCTAssertEqual(controller.state, .playing)
        XCTAssertEqual(transport.playedRates, [1, 1])
    }

    func testShutdownDetachesEventsAndStopsTransport() {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        controller.play(episode(guid: "first"))
        transport.becomeReady(duration: 100)
        let pendingUpdate = transport.onUpdate
        let generation = transport.generation
        controller.shutdown()
        pendingUpdate?(PlaybackTransportUpdate(generation: generation, event: .ended))
        controller.resume()
        controller.shutdown()

        XCTAssertEqual(controller.state, .idle)
        XCTAssertEqual(controller.currentEpisode?.guid, "first")
        XCTAssertNil(transport.onUpdate)
        XCTAssertFalse(transport.hasSource)
        XCTAssertEqual(transport.shutdownCount, 1)
        XCTAssertEqual(transport.playedRates, [1])
    }

    func testRateChangesAndTemporaryDoubleSpeedPreserveSelectedRate() {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        controller.play(episode(guid: "first"))
        transport.becomeReady(duration: 100)
        controller.setRate(1.25)
        controller.holdDoubleSpeed(true)
        controller.holdDoubleSpeed(false)
        controller.setRate(1.3)

        XCTAssertEqual(controller.rate, 1.25)
        XCTAssertEqual(transport.changedRates, [1, 1.25, 2, 1.25])
    }

    private func makeController(transport: FakePlaybackTransport = FakePlaybackTransport(), clock: FakePlaybackClock = FakePlaybackClock(), persistenceURL: URL? = nil) -> PlaybackController {
        let url = persistenceURL ?? temporaryURL()
        let controller = PlaybackController(transport: transport, persistenceURL: url, monotonicTime: { clock.time })
        addTeardownBlock {
            await MainActor.run { controller.shutdown() }
            try? FileManager.default.removeItem(at: url)
        }
        return controller
    }

    private func episode(guid: String) -> Episode {
        Episode(guid: guid, feed: "https://example.com/feed.xml", title: guid, file: EpisodeFile(url: "https://example.com/\(guid).mp3"))
    }

    private func temporaryURL() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("json")
    }
}

@MainActor
private final class FakePlaybackClock {
    var time: TimeInterval = 0

    func advance(by interval: TimeInterval) {
        time += interval
    }
}

@MainActor
private final class FakePlaybackTransport: PlaybackTransport {
    var onUpdate: (@MainActor (PlaybackTransportUpdate) -> Void)?
    var hasSource = false
    var position: TimeInterval = 0
    var generation = UUID()
    var playedRates: [Double] = []
    var changedRates: [Double] = []
    var shutdownCount = 0
    private var ready = false
    private var isPlaying = false
    private var duration: TimeInterval = 0

    func load(source: PlaybackSource, at position: TimeInterval, generation: UUID) {
        self.position = position
        self.generation = generation
        hasSource = true
        ready = false
    }

    func becomeReady(duration: TimeInterval) {
        self.duration = duration
        ready = true
        emit(.ready(duration: duration))
    }

    func play(atRate rate: Double) {
        guard ready else { return }
        playedRates.append(rate)
        if !isPlaying { emit(.playback(isPlaying: true)) }
    }

    func pause() {
        if isPlaying { emit(.playback(isPlaying: false)) }
    }

    func seek(to position: TimeInterval, generation: UUID) {
        self.position = position
        self.generation = generation
        ready = false
        isPlaying = false
    }

    func finishSeek() {
        emit(.seeked(position))
        becomeReady(duration: duration)
    }

    func advance(to position: TimeInterval) {
        self.position = position
        emit(.position(position))
    }

    func setRate(_ rate: Double) {
        changedRates.append(rate)
    }

    func setEffects(_ effects: AudioEffects) {
        emit(.effects(.active(effects)))
    }

    func stop() {
        hasSource = false
        ready = false
        isPlaying = false
    }

    func shutdown() {
        onUpdate = nil
        stop()
        shutdownCount += 1
    }

    func emit(_ event: PlaybackTransportEvent, generation: UUID? = nil) {
        if (generation ?? self.generation) == self.generation, case .playback(let isPlaying) = event {
            self.isPlaying = isPlaying
        }
        onUpdate?(PlaybackTransportUpdate(generation: generation ?? self.generation, event: event))
    }
}
