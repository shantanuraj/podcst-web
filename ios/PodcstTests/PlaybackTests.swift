import AVFoundation
import Foundation
import MediaPlayer
import Observation
import XCTest
@testable import Podcst

@MainActor
final class PlaybackTests: XCTestCase {
    func testPlaybackIntentNotifiesObserversOnToggleAndFailure() async {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        controller.restore(episode(guid: "observed"), at: 42)
        transport.becomeReady(duration: 300)

        for (index, requested) in [true, false, true, false].enumerated() {
            let changed = expectation(description: "Playback intent changed at step \(index)")
            withObservationTracking {
                _ = controller.isPlaybackRequested
            } onChange: {
                changed.fulfill()
            }

            if index == 3 {
                transport.emit(.failed)
            } else {
                controller.toggle()
            }

            XCTAssertEqual(controller.isPlaybackRequested, requested)
            XCTAssertEqual(controller.currentTime, 42)
            await fulfillment(of: [changed], timeout: 1)
        }
    }

    func testSystemAudioSessionAllowsPlaybackToReachTransport() async {
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
            nowPlaying.nowPlayingInfo = previousInfo
            for (command, enabled) in previousCommands { command.isEnabled = enabled }
            try? FileManager.default.removeItem(at: url)
        }

        XCTAssertEqual(controller.state, .idle)
        let loaded = expectation(description: "System session prepared before loading")
        transport.onLoad = { loaded.fulfill() }
        var item = episode(guid: "audio-session")
        item.file = EpisodeFile(url: url.appendingPathExtension("mp3").absoluteString)
        controller.play(item)
        await fulfillment(of: [loaded], timeout: 3)

        XCTAssertEqual(session.category, .playback)
        XCTAssertEqual(session.mode, .spokenAudio)
        XCTAssertTrue(session.categoryOptions.isEmpty)
        XCTAssertTrue(transport.hasSource)
        XCTAssertEqual(controller.state, .loading)
        transport.becomeReady(duration: 30)
        XCTAssertEqual(controller.state, .playing)
        XCTAssertEqual(transport.playedRates, [1])
        controller.shutdown()
        do {
            try await Task.detached {
                let session = AVAudioSession.sharedInstance()
                try session.setActive(false, options: .notifyOthersOnDeactivation)
                try session.setCategory(previousCategory, mode: previousMode, policy: previousPolicy, options: previousOptions)
            }.value
        } catch {
            XCTFail("Could not restore audio session: \(error)")
        }
    }

    func testPlaybackWaitsForAudioSessionAndUsesLatestRate() async {
        let session = ControlledAudioSession()
        let activation = session.request()
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport, prepareAudioSession: { try await session.prepare($0) })
        let loaded = expectation(description: "Transport loaded after activation")
        transport.onLoad = { loaded.fulfill() }

        controller.play(episode(guid: "pending"))
        await fulfillment(of: [activation.started], timeout: 2)
        XCTAssertEqual(controller.state, .loading)
        XCTAssertTrue(controller.isPlaybackRequested)
        XCTAssertFalse(transport.hasSource)
        XCTAssertTrue(transport.playedRates.isEmpty)
        controller.setRate(1.5)

        activation.succeed()
        await fulfillment(of: [activation.completed, loaded], timeout: 2)
        transport.becomeReady(duration: 300)
        XCTAssertEqual(controller.state, .playing)
        XCTAssertEqual(transport.playedRates, [1.5])
        XCTAssertEqual(session.activations, [true])
    }

    func testPauseCancelsPendingActivationAndRepeatedResumeStartsOnce() async {
        let session = ControlledAudioSession()
        let cancelled = session.request()
        let resumed = session.request()
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport, prepareAudioSession: { try await session.prepare($0) })
        let loaded = expectation(description: "Resumed transport loaded once")
        transport.onLoad = { loaded.fulfill() }

        controller.play(episode(guid: "pending"))
        await fulfillment(of: [cancelled.started], timeout: 2)
        controller.pause()
        cancelled.succeed()
        await fulfillment(of: [cancelled.completed], timeout: 2)
        XCTAssertEqual(controller.state, .paused)
        XCTAssertFalse(controller.isPlaybackRequested)
        XCTAssertFalse(transport.hasSource)

        controller.resume()
        controller.resume()
        await fulfillment(of: [resumed.started], timeout: 2)
        XCTAssertEqual(session.activations, [true, true])
        resumed.succeed()
        await fulfillment(of: [resumed.completed, loaded], timeout: 2)
        transport.becomeReady(duration: 300)
        XCTAssertEqual(transport.loadCount, 1)
        XCTAssertEqual(transport.playedRates, [1])
    }

    func testReplacedEpisodeRejectsLateActivationSuccessAndFailure() async {
        for fails in [false, true] {
            let session = ControlledAudioSession()
            let obsolete = session.request()
            let latest = session.request()
            let transport = FakePlaybackTransport()
            let controller = makeController(transport: transport, prepareAudioSession: { try await session.prepare($0) })
            let loaded = expectation(description: "Replacement loaded")
            transport.onLoad = { loaded.fulfill() }

            controller.play(episode(guid: "obsolete"))
            await fulfillment(of: [obsolete.started], timeout: 2)
            controller.play(episode(guid: "latest"), at: 42)
            await fulfillment(of: [latest.started], timeout: 2)
            latest.succeed()
            await fulfillment(of: [latest.completed, loaded], timeout: 2)
            transport.becomeReady(duration: 300)
            if fails { obsolete.fail() } else { obsolete.succeed() }
            await fulfillment(of: [obsolete.completed], timeout: 2)

            XCTAssertEqual(controller.currentEpisode?.guid, "latest")
            XCTAssertEqual(controller.currentTime, 42)
            XCTAssertEqual(controller.state, .playing)
            XCTAssertTrue(controller.isPlaybackRequested)
            XCTAssertEqual(transport.loadCount, 1)
            XCTAssertEqual(transport.playedRates, [1])
        }
    }

    func testSeekDuringInitialActivationLoadsLatestPosition() async {
        let session = ControlledAudioSession()
        let activation = session.request()
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport, prepareAudioSession: { try await session.prepare($0) })
        let loaded = expectation(description: "Latest seek position loaded")
        transport.onLoad = { loaded.fulfill() }

        controller.play(episode(guid: "pending"), at: 10)
        await fulfillment(of: [activation.started], timeout: 2)
        controller.seek(to: 90)
        controller.seek(to: 120)
        activation.succeed()
        await fulfillment(of: [activation.completed, loaded], timeout: 2)
        XCTAssertEqual(transport.position, 120)
        transport.becomeReady(duration: 300)
        XCTAssertEqual(controller.currentTime, 120)
        XCTAssertEqual(controller.state, .playing)
        XCTAssertEqual(session.activations, [true])
    }

    func testReadinessAndSeekCannotBypassPendingResumeActivation() async {
        let session = ControlledAudioSession()
        let configuration = session.request(activate: false)
        let activation = session.request()
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport, prepareAudioSession: { try await session.prepare($0) })
        let loaded = expectation(description: "Paused source loaded")
        let played = expectation(description: "Playback starts after activation")
        transport.onLoad = { loaded.fulfill() }
        transport.onPlay = { played.fulfill() }

        controller.restore(episode(guid: "restored"), at: 10)
        await fulfillment(of: [configuration.started], timeout: 2)
        configuration.succeed()
        await fulfillment(of: [configuration.completed, loaded], timeout: 2)
        transport.becomeReady(duration: 300)
        XCTAssertEqual(controller.state, .paused)

        controller.resume()
        await fulfillment(of: [activation.started], timeout: 2)
        transport.becomeReady(duration: 300)
        controller.seek(to: 180)
        transport.finishSeek()
        XCTAssertTrue(transport.playedRates.isEmpty)
        XCTAssertEqual(controller.state, .loading)
        activation.succeed()
        await fulfillment(of: [activation.completed, played], timeout: 2)
        XCTAssertEqual(controller.currentTime, 180)
        XCTAssertEqual(controller.state, .playing)
        XCTAssertEqual(transport.playedRates, [1])
        XCTAssertEqual(session.activations, [false, true])
    }

    func testRetiringPlaybackRejectsPendingActivation() async {
        for retirement in ["clear", "account", "shutdown", "remove"] {
            let session = ControlledAudioSession()
            let activation = session.request()
            let transport = FakePlaybackTransport()
            let controller = makeController(transport: transport, prepareAudioSession: { try await session.prepare($0) })
            controller.play(episode(guid: "private"))
            await fulfillment(of: [activation.started], timeout: 2)

            switch retirement {
            case "clear": controller.clear()
            case "account":
                controller.beginAccountChange()
                controller.switchAccount(to: "another-account")
            case "shutdown": controller.shutdown()
            default: controller.remove(atOffsets: IndexSet(integer: 0))
            }
            activation.succeed()
            await fulfillment(of: [activation.completed], timeout: 2)

            XCTAssertEqual(controller.state, .idle, retirement)
            XCTAssertFalse(controller.isPlaybackRequested, retirement)
            XCTAssertFalse(transport.hasSource, retirement)
            XCTAssertEqual(transport.loadCount, 0, retirement)
            XCTAssertTrue(transport.playedRates.isEmpty, retirement)
        }
    }

    func testTransportFailureCancelsPendingResumeActivation() async {
        let session = ControlledAudioSession()
        let configuration = session.request(activate: false)
        let activation = session.request()
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport, prepareAudioSession: { try await session.prepare($0) })
        let loaded = expectation(description: "Paused source loaded")
        transport.onLoad = { loaded.fulfill() }

        controller.restore(episode(guid: "restored"), at: 10)
        await fulfillment(of: [configuration.started], timeout: 2)
        configuration.succeed()
        await fulfillment(of: [configuration.completed, loaded], timeout: 2)
        transport.becomeReady(duration: 300)
        controller.resume()
        await fulfillment(of: [activation.started], timeout: 2)
        transport.emit(.failed)
        activation.succeed()
        await fulfillment(of: [activation.completed], timeout: 2)

        XCTAssertEqual(controller.state, .failed)
        XCTAssertFalse(controller.isPlaybackRequested)
        XCTAssertTrue(transport.playedRates.isEmpty)
    }

    func testActivationFailureClearsIntentAndCanBeRetried() async {
        let session = ControlledAudioSession()
        let failed = session.request()
        let retried = session.request()
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport, prepareAudioSession: { try await session.prepare($0) })
        let loaded = expectation(description: "Retry loaded")
        transport.onLoad = { loaded.fulfill() }

        controller.play(episode(guid: "pending"))
        await fulfillment(of: [failed.started], timeout: 2)
        let failureObserved = expectation(description: "Controller receives activation failure")
        withObservationTracking {
            _ = controller.state
        } onChange: {
            failureObserved.fulfill()
        }
        failed.fail()
        await fulfillment(of: [failed.completed, failureObserved], timeout: 2)
        XCTAssertEqual(controller.state, .failed)
        XCTAssertFalse(controller.isPlaybackRequested)
        XCTAssertFalse(transport.hasSource)

        controller.toggle()
        await fulfillment(of: [retried.started], timeout: 2)
        retried.succeed()
        await fulfillment(of: [retried.completed, loaded], timeout: 2)
        transport.becomeReady(duration: 300)
        XCTAssertEqual(controller.state, .playing)
        XCTAssertEqual(transport.playedRates, [1])
    }

    func testInterruptionDuringActivationResumesOnlyAfterNewActivation() async {
        let session = ControlledAudioSession()
        let interrupted = session.request()
        let resumed = session.request()
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport, prepareAudioSession: { try await session.prepare($0) })
        let loaded = expectation(description: "Interrupted playback resumed")
        transport.onLoad = { loaded.fulfill() }

        controller.play(episode(guid: "pending"))
        await fulfillment(of: [interrupted.started], timeout: 2)
        controller.handleInterruption(typeRaw: 1, optionsRaw: nil)
        interrupted.succeed()
        await fulfillment(of: [interrupted.completed], timeout: 2)
        XCTAssertEqual(controller.state, .paused)
        XCTAssertFalse(transport.hasSource)

        controller.handleInterruption(typeRaw: 0, optionsRaw: 1)
        await fulfillment(of: [resumed.started], timeout: 2)
        resumed.succeed()
        await fulfillment(of: [resumed.completed, loaded], timeout: 2)
        transport.becomeReady(duration: 300)
        XCTAssertEqual(controller.state, .playing)
        XCTAssertEqual(transport.playedRates, [1])
    }

    func testRouteDisconnectionCancelsPendingActivation() async {
        let session = ControlledAudioSession()
        let activation = session.request()
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport, prepareAudioSession: { try await session.prepare($0) })

        controller.play(episode(guid: "pending"))
        await fulfillment(of: [activation.started], timeout: 2)
        controller.handleRouteChange(reasonRaw: 2)
        activation.succeed()
        await fulfillment(of: [activation.completed], timeout: 2)
        XCTAssertEqual(controller.state, .paused)
        XCTAssertFalse(controller.isPlaybackRequested)
        XCTAssertFalse(transport.hasSource)
        XCTAssertTrue(transport.playedRates.isEmpty)
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
        XCTAssertEqual(updates.count, 1)
        clock.advance(by: 1)
        transport.advance(to: 60)
        XCTAssertEqual(updates.map(\.position), [30, 60])
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

    func testStopKeepsPlaceAndQueueAcrossRelaunch() {
        let url = temporaryURL()
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport, persistenceURL: url)
        var updates: [PlaybackUpdate] = []
        controller.onProgress = { updates.append($0) }
        controller.play(episode(guid: "first"))
        controller.enqueue(episode(guid: "second"))
        transport.becomeReady(duration: 100)
        transport.advance(to: 42)
        controller.stop()

        XCTAssertFalse(controller.isActive)
        XCTAssertFalse(controller.isPlaybackRequested)
        XCTAssertFalse(transport.hasSource)
        XCTAssertEqual(controller.currentEpisode?.guid, "first")
        XCTAssertEqual(controller.currentTime, 42)
        XCTAssertEqual(controller.queue.map(\.guid), ["first", "second"])
        XCTAssertEqual(updates.last?.position, 42)
        XCTAssertEqual(updates.last?.completed, false)

        let relaunched = makeController(transport: FakePlaybackTransport(), persistenceURL: url)
        XCTAssertFalse(relaunched.isActive)
        XCTAssertEqual(relaunched.currentEpisode?.guid, "first")
        XCTAssertEqual(relaunched.currentTime, 42)

        controller.resume()
        XCTAssertTrue(controller.isActive)
        XCTAssertTrue(controller.isPlaybackRequested)
        XCTAssertEqual(transport.position, 42)
    }

    func testStoppedSessionIgnoresInterruptionsAndReopensPaused() {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        controller.play(episode(guid: "first"))
        transport.becomeReady(duration: 100)
        controller.stop()
        controller.handleInterruption(typeRaw: 1, optionsRaw: nil)
        controller.handleInterruption(typeRaw: 0, optionsRaw: 1)

        XCTAssertFalse(controller.isActive)
        XCTAssertEqual(transport.playedRates, [1])

        controller.reopen()
        XCTAssertTrue(controller.isActive)
        XCTAssertEqual(controller.state, .paused)
        XCTAssertFalse(transport.hasSource)
    }

    func testMarkPlayedCompletesAndPlaysNext() {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        var updates: [PlaybackUpdate] = []
        controller.onProgress = { updates.append($0) }
        controller.play(episode(guid: "first"))
        controller.enqueue(episode(guid: "second"))
        transport.becomeReady(duration: 100)
        transport.advance(to: 12)
        controller.markPlayed()

        XCTAssertEqual(updates.last?.episode.guid, "first")
        XCTAssertEqual(updates.last?.completed, true)
        XCTAssertEqual(controller.queue.map(\.guid), ["second"])
        XCTAssertTrue(controller.isPlaybackRequested)

        controller.markPlayed()
        XCTAssertTrue(controller.queue.isEmpty)
        XCTAssertFalse(controller.isActive)
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

    func testEffectsWriteToTheOverrideOnlyWhenThePodcastHasOne() {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        let first = episode(guid: "first")
        controller.play(first)
        transport.becomeReady(duration: 100)
        let boost = AudioEffects(volumeBoost: true)
        controller.setEffects(boost)
        XCTAssertEqual(controller.audioPreferences.defaults.effects, boost)
        XCTAssertFalse(controller.audioPreferences.hasOverride(for: first.feed))
        XCTAssertEqual(controller.audioEffectState, .active(boost))

        controller.audioPreferences.set(AudioOptions(), for: first.feed)
        let trim = AudioEffects(trimSilence: true)
        controller.setEffects(trim)
        XCTAssertEqual(controller.audioPreferences.options(for: first.feed).effects, trim)
        XCTAssertEqual(controller.audioPreferences.defaults.effects, boost)
        XCTAssertEqual(controller.requestedEffects, trim)
    }

    func testQueueMatchesSharedVectors() throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("contracts/playback/queue.json")
        let vectors = try JSONDecoder().decode(QueueVectors.self, from: Data(contentsOf: url))
        XCTAssertFalse(vectors.cases.isEmpty)
        for vector in vectors.cases {
            let transport = FakePlaybackTransport()
            let controller = makeController(transport: transport)
            vector.initial.queue.forEach { controller.enqueue(episode(guid: $0)) }
            if vector.initial.active {
                controller.play(episode(guid: vector.initial.queue[vector.initial.current]))
            } else if vector.initial.current > 0 {
                controller.play(episode(guid: vector.initial.queue[vector.initial.current]))
                controller.stop()
            }
            for step in vector.steps {
                switch step.op {
                case "play": controller.play(episode(guid: step.episode!))
                case "enqueue": controller.enqueue(episode(guid: step.episode!), next: step.next ?? false)
                case "finish": transport.emit(.ended)
                case "markPlayed": controller.markPlayed()
                case "next": controller.next()
                case "previous": controller.previous()
                case "remove": controller.remove(atOffsets: IndexSet(step.indices!))
                case "removeUpNext": controller.removeUpNext(atOffsets: IndexSet(step.offsets!))
                case "moveUpNext": controller.moveUpNext(fromOffsets: IndexSet(integer: step.from!), toOffset: step.to!)
                case "move": controller.move(fromOffsets: IndexSet(integer: step.from!), toOffset: step.to!)
                case "clear": controller.clear()
                case "stop": controller.stop()
                case "reopen": controller.reopen()
                case "pause": controller.pause()
                default: XCTFail("Unknown operation \(step.op) in \(vector.name)")
                }
            }
            XCTAssertEqual(controller.queue.map(\.guid), vector.expected.queue, vector.name)
            XCTAssertEqual(controller.currentIndex, vector.expected.current, vector.name)
            XCTAssertEqual(controller.isActive, vector.expected.active, vector.name)
        }
    }

    func testColdLaunchRestoresNewerServerEpisodeWithoutSavingCachedPlayback() async {
        let url = temporaryURL()
        let previous = makeController(persistenceURL: url)
        previous.restore(episode(guid: "tal-899"), at: 3672)
        previous.enqueue(episode(guid: "queued"))
        previous.shutdown()
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport, persistenceURL: url)
        var updates: [PlaybackUpdate] = []
        controller.onProgress = { updates.append($0) }
        XCTAssertEqual(controller.currentEpisode?.guid, "tal-899")

        await controller.restoreProgress {
            PlaybackProgress(episode: self.episode(guid: "web-chapter-3"), position: 1271)
        }
        transport.becomeReady(duration: 1504)
        transport.emit(.seeked(1271.1))
        controller.pause()

        XCTAssertEqual(controller.currentEpisode?.guid, "web-chapter-3")
        XCTAssertEqual(controller.currentTime, 1271)
        XCTAssertEqual(controller.queue.map(\.guid), ["tal-899", "queued", "web-chapter-3"])
        XCTAssertEqual(controller.state, .paused)
        XCTAssertFalse(controller.isPlaybackRequested)
        XCTAssertTrue(transport.playedRates.isEmpty)
        XCTAssertTrue(updates.isEmpty)
        controller.shutdown()
        XCTAssertTrue(updates.isEmpty)
        let relaunched = makeController(persistenceURL: url)
        XCTAssertEqual(relaunched.currentEpisode?.guid, "web-chapter-3")
        XCTAssertEqual(relaunched.currentTime, 1271)
    }

    func testForegroundRestorationReplacesLoadedPausedPlaybackSilently() async {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        var updates: [PlaybackUpdate] = []
        controller.onProgress = { updates.append($0) }
        controller.play(episode(guid: "phone"), at: 42)
        transport.becomeReady(duration: 300)
        controller.pause()
        XCTAssertEqual(updates.map(\.position), [42])
        let oldGeneration = transport.generation

        await controller.restoreProgress {
            PlaybackProgress(episode: self.episode(guid: "web"), position: 123)
        }
        transport.emit(.position(99), generation: oldGeneration)
        transport.emit(.ended, generation: oldGeneration)
        transport.becomeReady(duration: 300)
        controller.pause()

        XCTAssertEqual(controller.currentEpisode?.guid, "web")
        XCTAssertEqual(controller.currentTime, 123)
        XCTAssertEqual(controller.state, .paused)
        XCTAssertEqual(updates.map(\.episode.guid), ["phone"])
        XCTAssertEqual(transport.playedRates, [1])
    }

    func testServerRestoresSameEpisodePositionIncludingBackwardSeek() async {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        let item = episode(guid: "same")
        controller.restore(item, at: 3672)
        var updates: [PlaybackUpdate] = []
        controller.onProgress = { updates.append($0) }
        for position in [1200.0, 1800.0] {
            await controller.restoreProgress { PlaybackProgress(episode: item, position: position) }
            transport.becomeReady(duration: 3725)
            XCTAssertEqual(controller.currentTime, position)
            XCTAssertEqual(controller.queue, [item])
        }
        XCTAssertTrue(updates.isEmpty)
    }

    func testUnchangedServerProgressDoesNotReopenStoppedPlaybackOrReloadPausedAudio() async {
        for stopped in [false, true] {
            let transport = FakePlaybackTransport()
            let controller = makeController(transport: transport)
            let item = episode(guid: "same")
            controller.play(item, at: 42.5)
            transport.becomeReady(duration: 300)
            controller.pause()
            if stopped { controller.stop() }
            var updates: [PlaybackUpdate] = []
            controller.onProgress = { updates.append($0) }
            await controller.restoreProgress { PlaybackProgress(episode: item, position: 42) }
            XCTAssertEqual(controller.state, stopped ? .idle : .paused)
            XCTAssertEqual(controller.currentTime, 42.5)
            XCTAssertEqual(transport.loadCount, 1)
            XCTAssertTrue(updates.isEmpty)
        }
    }

    func testServerRestorationDoesNotInterruptPlayingLoadingOrInterruptedAudio() async {
        for state in ["loading", "playing", "interrupted"] {
            let transport = FakePlaybackTransport()
            let controller = makeController(transport: transport)
            controller.play(episode(guid: "phone"), at: 42)
            if state != "loading" { transport.becomeReady(duration: 300) }
            if state == "interrupted" { controller.handleInterruption(typeRaw: 1, optionsRaw: nil) }
            let before = controller.state
            await controller.restoreProgress {
                PlaybackProgress(episode: self.episode(guid: "web"), position: 123)
            }
            XCTAssertEqual(controller.currentEpisode?.guid, "phone", state)
            XCTAssertEqual(controller.currentTime, 42, state)
            XCTAssertEqual(controller.state, before, state)
            XCTAssertEqual(transport.loadCount, 1, state)
        }
    }

    func testLocalActionsFenceDelayedServerRestoration() async {
        for action in ["resume-pause", "seek", "next", "stop", "clear", "complete", "account"] {
            let transport = FakePlaybackTransport()
            let controller = makeController(transport: transport)
            controller.restore(episode(guid: "phone"), at: 42)
            controller.enqueue(episode(guid: "queued"))
            transport.becomeReady(duration: 300)
            await controller.restoreProgress {
                switch action {
                case "resume-pause": controller.resume(); controller.pause()
                case "seek": controller.seek(to: 90); transport.finishSeek()
                case "next": controller.next()
                case "stop": controller.stop()
                case "clear": controller.clear()
                case "complete": controller.markPlayed()
                default: controller.beginAccountChange(); controller.switchAccount(to: "other")
                }
                return PlaybackProgress(episode: self.episode(guid: "web"), position: 123)
            }
            XCTAssertNotEqual(controller.currentEpisode?.guid, "web", action)
            XCTAssertNotEqual(controller.currentTime, 123, action)
        }
    }

    func testCancelledAndSupersededRestoresCannotReplaceNewerPlayback() async {
        for cancelled in [true, false] {
            let controller = makeController()
            controller.restore(episode(guid: "phone"), at: 42)
            let started = expectation(description: "Progress lookup started")
            var release: CheckedContinuation<PlaybackProgress?, Never>?
            let request = Task {
                await controller.restoreProgress {
                    await withCheckedContinuation {
                        release = $0
                        started.fulfill()
                    }
                }
            }
            await fulfillment(of: [started], timeout: 2)
            if cancelled {
                request.cancel()
            } else {
                await controller.restoreProgress {
                    PlaybackProgress(episode: self.episode(guid: "newer-web"), position: 180)
                }
            }
            release?.resume(returning: PlaybackProgress(episode: episode(guid: "obsolete-web"), position: 123))
            await request.value
            XCTAssertEqual(controller.currentEpisode?.guid, cancelled ? "phone" : "newer-web")
            XCTAssertEqual(controller.currentTime, cancelled ? 42 : 180)
        }
    }

    func testMissingServerProgressPreservesOfflinePlaybackAndQueue() async {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        controller.restore(episode(guid: "phone"), at: 42)
        controller.enqueue(episode(guid: "queued"))
        await controller.restoreProgress { nil }
        XCTAssertEqual(controller.currentEpisode?.guid, "phone")
        XCTAssertEqual(controller.currentTime, 42)
        XCTAssertEqual(controller.queue.map(\.guid), ["phone", "queued"])
        XCTAssertEqual(transport.loadCount, 1)
    }

    private func makeController(transport: FakePlaybackTransport = FakePlaybackTransport(), clock: FakePlaybackClock = FakePlaybackClock(), persistenceURL: URL? = nil, prepareAudioSession: (@Sendable (Bool) async throws -> Void)? = nil) -> PlaybackController {
        let url = persistenceURL ?? temporaryURL()
        let controller = PlaybackController(transport: transport, persistenceURL: url, monotonicTime: { clock.time }, prepareAudioSession: prepareAudioSession)
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

private struct QueueVectors: Decodable {
    struct State: Decodable {
        let queue: [String]
        let current: Int
        let active: Bool
    }

    struct Step: Decodable {
        let op: String
        let episode: String?
        let next: Bool?
        let indices: [Int]?
        let offsets: [Int]?
        let from: Int?
        let to: Int?
    }

    struct Case: Decodable {
        let name: String
        let initial: State
        let steps: [Step]
        let expected: State
    }

    let cases: [Case]
}

@MainActor
private final class ControlledAudioSession {
    private var requests: [PendingAudioSessionRequest] = []
    private(set) var activations: [Bool] = []

    func request(activate: Bool = true) -> PendingAudioSessionRequest {
        let request = PendingAudioSessionRequest(activate: activate)
        requests.append(request)
        return request
    }

    func prepare(_ activate: Bool) async throws {
        let index = activations.count
        activations.append(activate)
        guard requests.indices.contains(index) else {
            XCTFail("Unexpected audio session preparation")
            throw AudioSessionTestError.failed
        }
        let request = requests[index]
        XCTAssertEqual(activate, request.activate)
        try await request.wait()
    }
}

@MainActor
private final class PendingAudioSessionRequest {
    let activate: Bool
    let started = XCTestExpectation(description: "Audio session preparation started")
    let completed = XCTestExpectation(description: "Audio session preparation completed")
    private var continuation: CheckedContinuation<Void, any Error>?

    init(activate: Bool) {
        self.activate = activate
    }

    func wait() async throws {
        defer { completed.fulfill() }
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            started.fulfill()
        }
    }

    func succeed() {
        guard let continuation else { XCTFail("No audio session preparation to complete"); return }
        self.continuation = nil
        continuation.resume()
    }

    func fail() {
        guard let continuation else { XCTFail("No audio session preparation to fail"); return }
        self.continuation = nil
        continuation.resume(throwing: AudioSessionTestError.failed)
    }
}

private enum AudioSessionTestError: Error {
    case failed
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
    var onLoad: (() -> Void)?
    var onPlay: (() -> Void)?
    var loadCount = 0
    private var ready = false
    private var isPlaying = false
    private var duration: TimeInterval = 0

    func load(source: PlaybackSource, at position: TimeInterval, generation: UUID) {
        self.position = position
        self.generation = generation
        hasSource = true
        ready = false
        loadCount += 1
        onLoad?()
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
        onPlay?()
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
