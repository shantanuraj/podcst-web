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

    func testRetiringPlaybackRejectsPendingActivation() async throws {
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
                try controller.switchAccount(to: "another-account")
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

    func testDeliberatePlaybackAndSeekingEmitReplayRatherThanPassiveCompletion() {
        let controller = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: temporaryURL())
        var replayPositions: [Double] = []
        controller.onProgress = { if $0.event == .replay { replayPositions.append($0.position); XCTAssertFalse($0.completed) } }
        controller.play(episode(guid: "first"), at: 90)
        controller.seek(to: 12)
        controller.enqueue(episode(guid: "second"))
        controller.next()
        controller.previous()
        XCTAssertEqual(replayPositions, [90, 12, 0, 0])
    }

    func testCorruptScopedQueueCannotOverwriteSourceAndExplicitRetryReloadsIt() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let legacy = root.appendingPathComponent("playback.json")
        let scoped = queueStorageURL(legacy, accountID: "a")
        let legacyBytes = try queueStorageBytes(accountID: "a", guid: "legacy")
        let corrupt = Data("meaningful but corrupt queue".utf8)
        try DurableStateStore.protectedWrite(legacyBytes, legacy)
        try DurableStateStore.protectedWrite(corrupt, scoped)
        let controller = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: legacy, accountID: "a")
        XCTAssertTrue(controller.queueStorageBlocked)
        XCTAssertNotNil(controller.queueStorageError)
        controller.enqueue(episode(guid: "replacement"))
        controller.play(episode(guid: "replacement"))
        controller.clear()
        XCTAssertTrue(controller.queue.isEmpty)
        XCTAssertThrowsError(try controller.checkpointQueue())
        XCTAssertThrowsError(try controller.switchAccount(to: "b"))
        controller.shutdown()
        XCTAssertEqual(try Data(contentsOf: scoped), corrupt)
        XCTAssertEqual(try Data(contentsOf: legacy), legacyBytes)
        let restarted = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: legacy, accountID: "a")
        XCTAssertThrowsError(try restarted.retryQueueStorage())
        XCTAssertEqual(try Data(contentsOf: scoped), corrupt)
        try FileManager.default.removeItem(at: scoped)
        XCTAssertThrowsError(try restarted.retryQueueStorage())
        XCTAssertFalse(FileManager.default.fileExists(atPath: scoped.path))
        try DurableStateStore.protectedWrite(queueStorageBytes(accountID: "a", guid: "repaired"), scoped)
        try restarted.retryQueueStorage()
        XCTAssertFalse(restarted.queueStorageBlocked)
        XCTAssertNil(restarted.queueStorageError)
        XCTAssertEqual(restarted.currentEpisode?.guid, "repaired")
        XCTAssertEqual(restarted.currentTime, 37)
        XCTAssertEqual(try Data(contentsOf: legacy), legacyBytes)
        restarted.shutdown()
    }

    func testUnreadableScopedQueueAndInvalidOwnerBlockActivation() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let legacy = root.appendingPathComponent("playback.json")
        let scoped = queueStorageURL(legacy, accountID: "a")
        try FileManager.default.createDirectory(at: scoped, withIntermediateDirectories: true)
        let sentinel = scoped.appendingPathComponent("source")
        try Data("retain".utf8).write(to: sentinel)
        let controller = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: legacy, accountID: "a")
        XCTAssertTrue(controller.queueStorageBlocked)
        XCTAssertThrowsError(try controller.checkpointQueue())
        XCTAssertThrowsError(try controller.retryQueueStorage())
        XCTAssertEqual(try Data(contentsOf: sentinel), Data("retain".utf8))
        try FileManager.default.removeItem(at: scoped)
        let wrongOwner = try queueStorageBytes(accountID: "b", guid: "foreign")
        try DurableStateStore.protectedWrite(wrongOwner, scoped)
        XCTAssertThrowsError(try controller.retryQueueStorage())
        XCTAssertEqual(try Data(contentsOf: scoped), wrongOwner)
        let restarted = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: legacy, accountID: "a")
        XCTAssertTrue(restarted.queueStorageBlocked)
        XCTAssertTrue(restarted.queue.isEmpty)
        XCTAssertThrowsError(try restarted.switchAccount(to: "b"))
        controller.shutdown(); restarted.shutdown()
        XCTAssertEqual(try Data(contentsOf: scoped), wrongOwner)
    }

    func testQueueWriteFailurePreservesSavedFileAndBlocksCheckpointAndAccountSwitch() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let legacy = root.appendingPathComponent("playback.json")
        let scoped = queueStorageURL(legacy, accountID: "a")
        let directory = scoped.deletingLastPathComponent()
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path); try? FileManager.default.removeItem(at: root) }
        let controller = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: legacy, accountID: "a")
        controller.enqueue(episode(guid: "saved"))
        let saved = try Data(contentsOf: scoped)
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
        controller.enqueue(episode(guid: "unsaved"))
        XCTAssertTrue(controller.queueStorageBlocked)
        XCTAssertNotNil(controller.queueStorageError)
        XCTAssertEqual(controller.queue.map(\.guid), ["saved", "unsaved"])
        XCTAssertThrowsError(try controller.checkpointQueue())
        XCTAssertThrowsError(try controller.switchAccount(to: "b"))
        XCTAssertEqual(try Data(contentsOf: scoped), saved)
        XCTAssertFalse(FileManager.default.fileExists(atPath: queueStorageURL(legacy, accountID: "b").path))
        let restarted = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: legacy, accountID: "a")
        XCTAssertEqual(restarted.queue.map(\.guid), ["saved"])
        restarted.shutdown()
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        XCTAssertThrowsError(try controller.checkpointQueue())
        try controller.retryQueueStorage()
        XCTAssertNil(controller.queueStorageError)
        XCTAssertFalse(controller.queueStorageBlocked)
        let recovered = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: legacy, accountID: "a")
        XCTAssertEqual(recovered.queue.map(\.guid), ["saved", "unsaved"])
        recovered.shutdown(); controller.shutdown()
    }

    func testQueueAccountRoundTripAndFailedTargetActivationPreserveBothSources() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let legacy = root.appendingPathComponent("playback.json")
        let guest = try queueStorageBytes(accountID: nil, guid: "guest")
        try DurableStateStore.protectedWrite(guest, legacy)
        let controller = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: legacy, accountID: "a")
        controller.restore(episode(guid: "a"), at: 12)
        try controller.switchAccount(to: "b")
        XCTAssertTrue(controller.queue.isEmpty)
        controller.restore(episode(guid: "b"), at: 90)
        try controller.switchAccount(to: "a")
        XCTAssertEqual(controller.currentEpisode?.guid, "a")
        XCTAssertEqual(controller.currentTime, 12)
        let b = queueStorageURL(legacy, accountID: "b")
        let originalB = try Data(contentsOf: b)
        let broken = Data("broken target".utf8)
        try broken.write(to: b, options: .atomic)
        XCTAssertThrowsError(try controller.validateQueueStorage(accountID: "b"))
        XCTAssertThrowsError(try controller.switchAccount(to: "b"))
        XCTAssertEqual(controller.currentEpisode?.guid, "a")
        XCTAssertNotNil(controller.queueStorageError)
        XCTAssertEqual(try Data(contentsOf: b), broken)
        try originalB.write(to: b, options: .atomic)
        try controller.switchAccount(to: "b")
        XCTAssertEqual(controller.currentEpisode?.guid, "b")
        XCTAssertEqual(controller.currentTime, 90)
        try controller.switchAccount(to: "a")
        XCTAssertEqual(controller.currentEpisode?.guid, "a")
        XCTAssertEqual(try Data(contentsOf: legacy), guest)
        controller.shutdown()
    }

    func testTerminalQueueErasureIsTargetedDurableAndRejectsStaleControllerWrites() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let legacy = root.appendingPathComponent("playback.json")
        try DurableStateStore.protectedWrite(queueStorageBytes(accountID: "a", guid: "a"), legacy)
        let controller = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: legacy, accountID: "a")
        try controller.checkpointQueue()
        let stale = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: legacy, accountID: "a")
        let guestURL = queueStorageURL(legacy, accountID: nil)
        let otherURL = queueStorageURL(legacy, accountID: "b")
        let guest = try queueStorageBytes(accountID: nil, guid: "guest")
        let other = try queueStorageBytes(accountID: "b", guid: "b")
        try DurableStateStore.protectedWrite(guest, guestURL)
        try DurableStateStore.protectedWrite(other, otherURL)
        try controller.terminalEraseQueue(accountID: "a")
        let scoped = queueStorageURL(legacy, accountID: "a")
        let marker = try Data(contentsOf: scoped)
        XCTAssertEqual((try JSONSerialization.jsonObject(with: marker) as? [String: Any])?["erased"] as? Bool, true)
        XCTAssertFalse(FileManager.default.fileExists(atPath: legacy.path))
        XCTAssertTrue(controller.queue.isEmpty)
        XCTAssertTrue(controller.queueStorageBlocked)
        XCTAssertFalse(controller.canRetryQueueStorage)
        XCTAssertThrowsError(try controller.retryQueueStorage())
        controller.play(episode(guid: "late")); controller.enqueue(episode(guid: "late"))
        stale.enqueue(episode(guid: "stale"))
        XCTAssertTrue(stale.queue.isEmpty)
        XCTAssertThrowsError(try stale.checkpointQueue())
        controller.shutdown(); stale.shutdown()
        XCTAssertEqual(try Data(contentsOf: scoped), marker)
        let restarted = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: legacy, accountID: "a")
        XCTAssertTrue(restarted.queueStorageBlocked)
        XCTAssertTrue(restarted.queue.isEmpty)
        restarted.shutdown()
        XCTAssertEqual(try Data(contentsOf: scoped), marker)
        XCTAssertEqual(try Data(contentsOf: guestURL), guest)
        XCTAssertEqual(try Data(contentsOf: otherURL), other)
        let transition = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: legacy, accountID: "a")
        try transition.checkpointQueueForAccountChange(to: "b")
        try transition.switchAccount(to: "b")
        XCTAssertEqual(transition.currentEpisode?.guid, "b")
        try transition.switchAccount(to: "a")
        XCTAssertTrue(transition.queue.isEmpty)
        XCTAssertTrue(transition.queueStorageBlocked)
        transition.shutdown()
        XCTAssertEqual(try Data(contentsOf: scoped), marker)
    }

    func testQueueErasePreservesForeignLegacyAndRetriesUnattributedCleanup() throws {
        for owner in [nil, "b"] as [String?] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root) }
            let legacy = root.appendingPathComponent("playback.json")
            let source = try queueStorageBytes(accountID: owner, guid: "foreign")
            try DurableStateStore.protectedWrite(source, legacy)
            let controller = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: legacy, accountID: "b")
            try controller.terminalEraseQueue(accountID: "a")
            XCTAssertEqual(try Data(contentsOf: legacy), source)
            let corrupt = Data("unattributed queue source".utf8)
            try corrupt.write(to: legacy, options: .atomic)
            XCTAssertThrowsError(try controller.terminalEraseQueue(accountID: "a"))
            XCTAssertNotNil(controller.queueStorageError)
            XCTAssertEqual(try Data(contentsOf: legacy), corrupt)
            let tombstone = try Data(contentsOf: queueStorageURL(legacy, accountID: "a"))
            XCTAssertEqual((try JSONSerialization.jsonObject(with: tombstone) as? [String: Any])?["erased"] as? Bool, true)
            let restarted = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: legacy, accountID: "a")
            XCTAssertTrue(restarted.queueStorageError?.contains("cleanup is incomplete") == true)
            XCTAssertThrowsError(try restarted.terminalEraseQueue(accountID: "a"))
            XCTAssertEqual(try Data(contentsOf: legacy), corrupt)
            try Data(#"{"accountID":"a","queue":"damaged but attributable"}"#.utf8).write(to: legacy, options: .atomic)
            try restarted.terminalEraseQueue(accountID: "a")
            XCTAssertFalse(FileManager.default.fileExists(atPath: legacy.path))
            let completed = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: queueStorageURL(legacy, accountID: "a"))) as? [String: Any])
            XCTAssertEqual(completed["erased"] as? Bool, true)
            XCTAssertEqual(completed["eraseCleanupPending"] as? Bool, false)
            controller.shutdown(); restarted.shutdown()
        }
    }

    func testQueueEraseWriteFailureDoesNotClaimSuccessOrRemoveLegacy() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let legacy = root.appendingPathComponent("playback.json")
        let scoped = queueStorageURL(legacy, accountID: "a")
        let directory = scoped.deletingLastPathComponent()
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path); try? FileManager.default.removeItem(at: root) }
        let source = try queueStorageBytes(accountID: "a", guid: "a")
        try DurableStateStore.protectedWrite(source, legacy)
        try DurableStateStore.protectedWrite(source, scoped)
        let controller = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: legacy, accountID: "a")
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
        XCTAssertThrowsError(try controller.terminalEraseQueue(accountID: "a"))
        XCTAssertNotNil(controller.queueStorageError)
        XCTAssertEqual(try Data(contentsOf: scoped), source)
        XCTAssertEqual(try Data(contentsOf: legacy), source)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        try controller.terminalEraseQueue(accountID: "a")
        XCTAssertFalse(FileManager.default.fileExists(atPath: legacy.path))
        controller.shutdown()
    }

    func testDelayedProgressAndTransportCannotRepopulateErasedQueue() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let legacy = root.appendingPathComponent("playback.json")
        let transport = FakePlaybackTransport()
        let controller = PlaybackController(transport: transport, persistenceURL: legacy, accountID: "a")
        controller.restore(episode(guid: "a"), at: 12)
        let oldGeneration = transport.generation
        let arrived = expectation(description: "Pending restore")
        var release: CheckedContinuation<PlaybackProgress?, Never>?
        let loading = Task {
            await controller.restoreProgress {
                arrived.fulfill()
                return await withCheckedContinuation { release = $0 }
            }
        }
        await fulfillment(of: [arrived], timeout: 2)
        let eraser = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: legacy, accountID: "b")
        try eraser.terminalEraseQueue(accountID: "a")
        let marker = try Data(contentsOf: queueStorageURL(legacy, accountID: "a"))
        release?.resume(returning: PlaybackProgress(episode: episode(guid: "late"), position: 90))
        await loading.value
        transport.emit(.seeked(55), generation: oldGeneration)
        transport.emit(.ended, generation: oldGeneration)
        XCTAssertTrue(controller.queue.isEmpty)
        XCTAssertFalse(transport.hasSource)
        XCTAssertEqual(try Data(contentsOf: queueStorageURL(legacy, accountID: "a")), marker)
        controller.shutdown(); eraser.shutdown()
    }

    private var queueProcessDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("SyntheticQueueRestart")
    }

    func testQueueProcessRestartWrite() throws {
        let root = queueProcessDirectory
        try? FileManager.default.removeItem(at: root)
        let legacy = root.appendingPathComponent("playback.json")
        try DurableStateStore.protectedWrite(queueStorageBytes(accountID: "a", guid: "a"), legacy)
        try DurableStateStore.protectedWrite(Data("corrupt preserved queue".utf8), queueStorageURL(legacy, accountID: "a"))
        try DurableStateStore.protectedWrite(queueStorageBytes(accountID: "b", guid: "b"), queueStorageURL(legacy, accountID: "b"))
        try DurableStateStore.protectedWrite(queueStorageBytes(accountID: nil, guid: "guest"), queueStorageURL(legacy, accountID: nil))
        let controller = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: legacy, accountID: "a")
        XCTAssertThrowsError(try controller.checkpointQueue())
        controller.shutdown()
        XCTAssertEqual(try Data(contentsOf: queueStorageURL(legacy, accountID: "a")), Data("corrupt preserved queue".utf8))
        try Data(String(ProcessInfo.processInfo.processIdentifier).utf8).write(to: root.appendingPathComponent("pid"))
    }

    func testQueueProcessRestartRead() throws {
        let root = queueProcessDirectory
        let pid = root.appendingPathComponent("pid")
        guard FileManager.default.fileExists(atPath: pid.path) else { throw XCTSkip("Run the queue process write test in a separate invocation first") }
        XCTAssertNotEqual(try String(contentsOf: pid, encoding: .utf8), String(ProcessInfo.processInfo.processIdentifier))
        defer { try? FileManager.default.removeItem(at: root) }
        let legacy = root.appendingPathComponent("playback.json")
        let other = try Data(contentsOf: queueStorageURL(legacy, accountID: "b"))
        let guest = try Data(contentsOf: queueStorageURL(legacy, accountID: nil))
        let controller = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: legacy, accountID: "a")
        XCTAssertTrue(controller.queueStorageBlocked)
        XCTAssertTrue(controller.queue.isEmpty)
        controller.clear()
        XCTAssertThrowsError(try controller.checkpointQueue())
        XCTAssertEqual(try Data(contentsOf: queueStorageURL(legacy, accountID: "a")), Data("corrupt preserved queue".utf8))
        try controller.terminalEraseQueue(accountID: "a")
        XCTAssertFalse(FileManager.default.fileExists(atPath: legacy.path))
        XCTAssertEqual(try Data(contentsOf: queueStorageURL(legacy, accountID: "b")), other)
        XCTAssertEqual(try Data(contentsOf: queueStorageURL(legacy, accountID: nil)), guest)
        controller.shutdown()
    }

    private func queueStorageURL(_ legacy: URL, accountID: String?) -> URL {
        legacy.appendingPathExtension("scopes").appendingPathComponent(MediaKey.scope(accountID) + ".json")
    }

    private func queueStorageBytes(accountID: String?, guid: String) throws -> Data {
        let value: [String: Any] = ["accountID": accountID as Any? ?? NSNull(), "queue": [try JSONSerialization.jsonObject(with: JSONEncoder().encode(episode(guid: guid)))], "currentIndex": 0, "currentTime": 37, "stopped": true]
        return try JSONSerialization.data(withJSONObject: value, options: .sortedKeys)
    }

    func testPlaybackStateBelongsToItsAccountAndSwitchingRetainsIt() throws {
        let url = temporaryURL()
        let transport = FakePlaybackTransport()
        let first = PlaybackController(transport: transport, persistenceURL: url, accountID: "first")
        first.play(episode(guid: "private"), at: 30)
        let sameAccount = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: url, accountID: "first")
        XCTAssertEqual(sameAccount.currentEpisode?.guid, "private")
        let otherAccount = PlaybackController(transport: FakePlaybackTransport(), persistenceURL: url, accountID: "second")
        XCTAssertNil(otherAccount.currentEpisode)
        try first.switchAccount(to: "second")
        XCTAssertFalse(transport.hasSource)
        XCTAssertTrue(first.queue.isEmpty)
        XCTAssertEqual(first.state, .idle)
        XCTAssertEqual(PlaybackController(transport: FakePlaybackTransport(), persistenceURL: url, accountID: "first").currentEpisode?.guid, "private")
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

    func testAccountRetirementRejectsPlayRequestsUntilScopeChanges() throws {
        let transport = FakePlaybackTransport()
        let controller = PlaybackController(transport: transport, persistenceURL: temporaryURL(), accountID: "first")
        controller.play(episode(guid: "private"))
        controller.beginAccountChange()
        controller.resume()
        controller.next()
        controller.play(episode(guid: "replacement"))
        XCTAssertFalse(transport.hasSource)
        XCTAssertFalse(controller.isPlaybackRequested)
        try controller.switchAccount(to: "second")
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
        controller.onProgress = { if $0.event != .replay { updates.append($0) } }
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
        controller.onProgress = { if $0.event != .replay { updates.append($0) } }
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
        controller.onProgress = { if $0.event != .replay { updates.append($0) } }
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
        controller.onProgress = { if $0.event != .replay { updates.append($0) } }
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
        controller.onProgress = { if $0.event != .replay { updates.append($0) } }
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
        controller.onProgress = { if $0.event != .replay { updates.append($0) } }
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
        controller.onProgress = { if $0.event != .replay { updates.append($0) } }
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
        controller.onProgress = { if $0.event != .replay { updates.append($0) } }
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
        controller.onProgress = { if $0.event != .replay { updates.append($0) } }
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
        controller.onProgress = { if $0.event != .replay { updates.append($0) } }
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
            controller.onProgress = { if $0.event != .replay { updates.append($0) } }
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
                default:
                    controller.beginAccountChange()
                    do { try controller.switchAccount(to: "other") }
                    catch { XCTFail("Account switch failed: \(error)") }
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

    func testSharedClipBorrowsTheQueueWithoutProgressAndPausesAtItsEnd() async {
        let url = temporaryURL()
        let transport = FakePlaybackTransport()
        let clock = FakePlaybackClock()
        let controller = makeController(transport: transport, clock: clock, persistenceURL: url)
        var updates: [PlaybackUpdate] = []
        controller.onProgress = { updates.append($0) }
        controller.enqueue(episode(guid: "earlier"))
        controller.play(episode(guid: "current"), at: 40)
        controller.enqueue(episode(guid: "later"))
        transport.becomeReady(duration: 600)
        updates.removeAll()

        controller.playClip(episode(guid: "shared"), from: 100, to: 160)
        XCTAssertEqual(updates.map(\.episode.guid), ["current"])
        updates.removeAll()
        XCTAssertEqual(controller.queue.map(\.guid), ["earlier", "shared", "current", "later"])
        XCTAssertEqual(controller.currentEpisode?.guid, "shared")
        XCTAssertEqual(controller.upNext.first?.guid, "current")
        XCTAssertEqual(transport.position, 100)

        transport.emit(.seeked(100))
        transport.becomeReady(duration: 600)
        XCTAssertEqual(controller.state, .playing)
        clock.advance(by: 45)
        transport.advance(to: 145)
        controller.seek(to: 10)
        XCTAssertEqual(controller.currentTime, 100)
        controller.seek(to: 900)
        XCTAssertEqual(controller.currentTime, 160)
        transport.finishSeek()
        transport.advance(to: 159)
        XCTAssertEqual(controller.clip?.ended, false)
        transport.advance(to: 160.4)
        XCTAssertEqual(controller.clip?.ended, true)
        XCTAssertEqual(controller.state, .paused)
        XCTAssertFalse(controller.isPlaybackRequested)
        transport.emit(.ended)
        controller.pause()
        await controller.restoreProgress { PlaybackProgress(episode: self.episode(guid: "web"), position: 5) }

        XCTAssertTrue(updates.isEmpty)
        XCTAssertEqual(controller.currentEpisode?.guid, "shared")
        XCTAssertEqual(controller.queue.map(\.guid), ["earlier", "shared", "current", "later"])
        let relaunched = makeController(persistenceURL: url)
        XCTAssertEqual(relaunched.queue.map(\.guid), ["earlier", "current", "later"])
        XCTAssertEqual(relaunched.currentEpisode?.guid, "current")
        XCTAssertEqual(relaunched.currentTime, 40)
    }

    func testKeepListeningOrPlayingAfterTheEndLeavesClipAndSavesProgressAgain() {
        let transport = FakePlaybackTransport()
        let clock = FakePlaybackClock()
        let controller = makeController(transport: transport, clock: clock)
        controller.play(episode(guid: "current"), at: 40)
        transport.becomeReady(duration: 600)
        controller.playClip(episode(guid: "shared"), from: 100, to: 160)
        transport.becomeReady(duration: 600)
        transport.advance(to: 160)
        XCTAssertEqual(controller.clip?.ended, true)
        var updates: [PlaybackUpdate] = []
        controller.onProgress = { updates.append($0) }

        controller.resume()
        XCTAssertNil(controller.clip)
        XCTAssertEqual(controller.currentTime, 160)
        XCTAssertEqual(transport.position, 160)
        XCTAssertEqual(controller.state, .playing)
        clock.advance(by: 30)
        transport.advance(to: 190)

        XCTAssertEqual(updates.map(\.episode.guid), ["shared"])
        XCTAssertEqual(updates.map(\.position), [190])
        XCTAssertEqual(updates.map(\.completed), [false])
        XCTAssertEqual(controller.queue.map(\.guid), ["shared", "current"])
    }

    func testReplayRestartsTheClipWithoutLeavingClipMode() {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        var updates: [PlaybackUpdate] = []
        controller.onProgress = { updates.append($0) }
        controller.playClip(episode(guid: "shared"), from: 100, to: 160, chapter: 2)
        transport.becomeReady(duration: 600)
        transport.advance(to: 161)
        XCTAssertEqual(controller.clip?.ended, true)

        controller.replayClip()

        XCTAssertEqual(controller.currentTime, 100)
        XCTAssertEqual(controller.clip?.ended, false)
        XCTAssertEqual(controller.clip?.chapter, 2)
        XCTAssertTrue(controller.isPlaybackRequested)
        transport.finishSeek()
        transport.advance(to: 130)
        XCTAssertTrue(updates.isEmpty)
    }

    func testClosingClipRemovesBorrowedEpisodeAndPausesThePreviousOne() {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        var updates: [PlaybackUpdate] = []
        controller.play(episode(guid: "current"), at: 40)
        controller.enqueue(episode(guid: "later"))
        transport.becomeReady(duration: 600)
        controller.playClip(episode(guid: "shared"), from: 100, to: 160)
        transport.becomeReady(duration: 600)
        controller.onProgress = { updates.append($0) }

        controller.closeClip()
        transport.becomeReady(duration: 600)

        XCTAssertNil(controller.clip)
        XCTAssertEqual(controller.queue.map(\.guid), ["current", "later"])
        XCTAssertEqual(controller.currentEpisode?.guid, "current")
        XCTAssertEqual(controller.currentTime, 40)
        XCTAssertEqual(transport.position, 40)
        XCTAssertEqual(controller.state, .paused)
        XCTAssertFalse(controller.isPlaybackRequested)
        XCTAssertTrue(updates.isEmpty)
    }

    func testClosingClipKeepsAnEpisodeThatWasAlreadyQueued() {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        controller.play(episode(guid: "current"), at: 40)
        controller.enqueue(episode(guid: "later"))
        controller.enqueue(episode(guid: "shared"))
        controller.playClip(episode(guid: "shared"), from: 100, to: 160)
        XCTAssertEqual(controller.queue.map(\.guid), ["shared", "current", "later"])

        controller.closeClip()

        XCTAssertEqual(controller.queue.map(\.guid), ["shared", "current", "later"])
        XCTAssertEqual(controller.currentEpisode?.guid, "current")
        XCTAssertEqual(controller.currentTime, 40)
        XCTAssertFalse(controller.isPlaybackRequested)
    }

    func testAddingClipToQueueMovesItToTheEndAndPausesThePreviousOne() {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        var updates: [PlaybackUpdate] = []
        controller.play(episode(guid: "current"), at: 40)
        controller.enqueue(episode(guid: "later"))
        controller.playClip(episode(guid: "shared"), from: 100, to: 160)
        controller.onProgress = { updates.append($0) }

        controller.closeClip(enqueueing: true)

        XCTAssertNil(controller.clip)
        XCTAssertEqual(controller.queue.map(\.guid), ["current", "later", "shared"])
        XCTAssertEqual(controller.currentEpisode?.guid, "current")
        XCTAssertEqual(controller.currentTime, 40)
        XCTAssertFalse(controller.isPlaybackRequested)
        XCTAssertTrue(updates.isEmpty)
    }

    func testPlayingSomethingElseOrSkippingLeavesClipByItsBorrowingRules() {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        controller.play(episode(guid: "current"), at: 40)
        controller.enqueue(episode(guid: "later"))
        controller.playClip(episode(guid: "shared"), from: 100, to: 160)
        controller.next()
        XCTAssertNil(controller.clip)
        XCTAssertEqual(controller.queue.map(\.guid), ["current", "later"])
        XCTAssertEqual(controller.currentEpisode?.guid, "later")

        controller.playClip(episode(guid: "shared"), from: 100, to: 160)
        XCTAssertEqual(controller.queue.map(\.guid), ["current", "shared", "later"])
        controller.play(episode(guid: "other"))
        XCTAssertNil(controller.clip)
        XCTAssertEqual(controller.queue.map(\.guid), ["current", "later", "other"])
        XCTAssertEqual(controller.currentEpisode?.guid, "other")
    }

    func testSharedChapterAdvancesToTheNextChapterWithinClipMode() {
        let transport = FakePlaybackTransport()
        let controller = makeController(transport: transport)
        var chaptered = episode(guid: "chaptered")
        chaptered.showNotes = "<p>00:00 Opening</p><p>01:40 Middle</p><p>05:00 Closing</p>"
        controller.playClip(chaptered, from: 100, to: 300, chapter: 2)
        transport.becomeReady(duration: 600)
        transport.advance(to: 300)
        XCTAssertEqual(controller.nextClipChapter, 2)

        controller.playNextClipChapter()

        XCTAssertEqual(controller.clip?.chapter, 3)
        XCTAssertEqual(controller.clip?.start, 300)
        XCTAssertEqual(controller.clip?.end, 600)
        XCTAssertEqual(controller.clip?.ended, false)
        XCTAssertNil(controller.nextClipChapter)
        XCTAssertTrue(controller.isPlaybackRequested)
    }

    func testTimeLinkInsertsBeforeCurrentAndPlaysWithNormalProgress() {
        let transport = FakePlaybackTransport()
        let clock = FakePlaybackClock()
        let controller = makeController(transport: transport, clock: clock)
        var updates: [PlaybackUpdate] = []
        controller.enqueue(episode(guid: "earlier"))
        controller.play(episode(guid: "current"), at: 40)
        controller.enqueue(episode(guid: "later"))
        transport.becomeReady(duration: 600)
        controller.onProgress = { updates.append($0) }

        controller.playShared(episode(guid: "shared"), at: 1092)
        transport.becomeReady(duration: 3000)
        clock.advance(by: 30)
        transport.advance(to: 1122)

        XCTAssertNil(controller.clip)
        XCTAssertEqual(controller.queue.map(\.guid), ["earlier", "shared", "current", "later"])
        XCTAssertEqual(controller.currentEpisode?.guid, "shared")
        XCTAssertEqual(controller.state, .playing)
        XCTAssertEqual(updates.map(\.episode.guid), ["current", "shared", "shared"])
        XCTAssertEqual(updates.map(\.position), [40, 1092, 1122])
        XCTAssertEqual(updates.map(\.event), [nil, .replay, nil])
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
