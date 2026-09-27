import AVFoundation
import Foundation
import Network
import XCTest
@testable import Podcst

@MainActor
final class MediaTests: XCTestCase {
    func testValidatedRangesResumeAcrossRelaunchWithoutNetwork() async throws {
        let body = payload(count: 800_019)
        let server = try MediaHTTPServer(data: body)
        let url = try await server.start()
        defer { server.stop() }
        let directory = temporaryDirectory()
        let source = try HTTPMediaByteSource(url: url, directory: directory)
        let first = try await source.read(offset: 13, count: 87)
        XCTAssertEqual(first, body.subdata(in: 13..<100))
        let remote = try await source.read(offset: 600_010, count: 150)
        XCTAssertEqual(remote, body.subdata(in: 600_010..<600_160))
        let partial = await source.snapshot()
        XCTAssertLessThan(partial.storedBytes, Int64(body.count))
        let requests = server.requests
        XCTAssertTrue(requests.contains { $0["if-range"] == "\"version-1\"" })
        let restored = try HTTPMediaByteSource(url: URL(string: "http://127.0.0.1:1/unavailable")!, directory: directory)
        let cached = try await restored.read(offset: 600_010, count: 150)
        XCTAssertEqual(cached, remote)
        let complete = try await source.materialize()
        XCTAssertEqual(try Data(contentsOf: complete), body)
        let relaunched = try HTTPMediaByteSource(url: URL(string: "http://127.0.0.1:1/unavailable")!, directory: directory)
        let cachedURL = try await relaunched.materialize()
        XCTAssertEqual(try Data(contentsOf: cachedURL), body)
    }

    func testChangedValidatorCannotMixRepresentations() async throws {
        let body = payload(count: 600_000)
        let server = try MediaHTTPServer(data: body)
        let url = try await server.start()
        defer { server.stop() }
        let source = try HTTPMediaByteSource(url: url, directory: temporaryDirectory())
        let old = try await source.read(offset: 0, count: 100)
        server.replace(data: Data(repeating: 99, count: body.count), etag: "\"version-2\"")
        do {
            _ = try await source.read(offset: 400_000, count: 100)
            XCTFail("A changed representation must be rejected")
        } catch { XCTAssertEqual(error as? MediaFailure, .representationChanged) }
        let preserved = try await source.read(offset: 0, count: 100)
        XCTAssertEqual(preserved, old)
        let complete = await source.completeFileURL()
        XCTAssertNil(complete)
        try await source.restartRepresentation()
        let replacement = try await source.materialize()
        XCTAssertEqual(try Data(contentsOf: replacement), Data(repeating: 99, count: body.count))
    }

    func testNonRangeAndUnvalidatedServersExplicitlyRequireCompleteFile() async throws {
        for mode in [MediaHTTPServer.Mode.ignoreRange, .weakValidator] {
            let body = payload(count: 350_000)
            let server = try MediaHTTPServer(data: body, mode: mode)
            let url = try await server.start()
            let source = try HTTPMediaByteSource(url: url, directory: temporaryDirectory())
            let metadata = try await source.metadata()
            XCTAssertEqual(metadata.capability, .completeFileRequired)
            let probe = await source.snapshot()
            XCTAssertEqual(probe.storedBytes, 0, "Capability probes must not silently download the entire episode")
            if mode == .weakValidator {
                do {
                    _ = try await source.read(offset: 0, count: 16)
                    XCTFail("Unvalidated partial responses must not be stitched together")
                } catch { XCTAssertEqual(error as? MediaFailure, .requiresCompleteFile) }
            }
            let file = try await source.materialize()
            XCTAssertEqual(try Data(contentsOf: file), body)
            server.stop()
        }
    }

    func testCancelledTransferCanRetryWithoutPublishingPartialBytes() async throws {
        let server = try MediaHTTPServer(data: payload(count: 400_000), delay: 0.25)
        let url = try await server.start()
        defer { server.stop() }
        let source = try HTTPMediaByteSource(url: url, directory: temporaryDirectory())
        let pending = Task { try await source.materialize() }
        try await waitForRequests(server, count: 1)
        await source.cancel()
        do { _ = try await pending.value; XCTFail("Cancelled materialization must fail") }
        catch { XCTAssertEqual(error as? MediaFailure, .cancelled) }
        let partial = await source.snapshot()
        XCTAssertEqual(partial.storedBytes, 0)
        let file = try await source.materialize()
        XCTAssertEqual(try Data(contentsOf: file).count, 400_000)
    }

    func testDownloadCatalogSurvivesRelaunchAndAccountPurgeRespectsPins() async throws {
        let body = payload(count: 350_000)
        let server = try MediaHTTPServer(data: body)
        let url = try await server.start()
        defer { server.stop() }
        let root = temporaryDirectory()
        let episode = episode(url: url)
        let store = MediaStore(accountID: "private-account", rootURL: root, quotaBytes: 0)
        try await store.download(episode)
        XCTAssertEqual(store.status(for: episode), .available(bytes: Int64(body.count)))
        await store.trimCache()
        let relaunched = MediaStore(accountID: "private-account", rootURL: root, quotaBytes: 0)
        XCTAssertEqual(relaunched.downloadedEpisodes, [episode])
        XCTAssertEqual(relaunched.status(for: episode), .available(bytes: Int64(body.count)))
        let lease = try await relaunched.pin(episode)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(lease.completeFileURL)), body)
        do { try await relaunched.switchAccount(to: "other-account"); XCTFail("An active lease must prevent account purge") }
        catch { XCTAssertEqual(error as? MediaFailure, .pinned) }
        XCTAssertEqual(relaunched.accountID, "private-account")
        await lease.release()
        try await relaunched.switchAccount(to: "other-account")
        XCTAssertTrue(relaunched.downloadedEpisodes.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(MediaKey.scope("private-account")).path))
        do { _ = try await lease.byteSource.metadata(); XCTFail("A retired source cannot recreate a purged account") }
        catch { XCTAssertEqual(error as? MediaFailure, .accountChanged) }
    }

    func testPlaybackReadPreemptsDownloadWithoutCancellingItsRecovery() async throws {
        let body = payload(count: 1_000_000)
        let server = try MediaHTTPServer(data: body, delay: 0.1)
        let url = try await server.start()
        defer { server.stop() }
        let source = try HTTPMediaByteSource(url: url, directory: temporaryDirectory())
        _ = try await source.metadata()
        let download = Task { try await source.materialize() }
        try await waitForRequests(server, count: 2)
        let seek = try await source.read(offset: 900_000, count: 100)
        XCTAssertEqual(seek, body.subdata(in: 900_000..<900_100))
        XCTAssertEqual(server.requests[2]["range"], "bytes=786432-999999")
        let file = try await download.value
        XCTAssertEqual(try Data(contentsOf: file), body)
    }

    func testMalformedRangesAuthorizationAndConnectionLossNeverBecomeCachedAudio() async throws {
        for mode in [MediaHTTPServer.Mode.badRange, .unauthorized, .truncated] {
            let server = try MediaHTTPServer(data: payload(count: 350_000), mode: mode)
            let url = try await server.start()
            let source = try HTTPMediaByteSource(url: url, directory: temporaryDirectory())
            do {
                _ = try await source.materialize()
                XCTFail("Invalid media response must fail")
            } catch {
                if mode == .unauthorized { XCTAssertEqual(error as? MediaFailure, .unavailable(403)) }
            }
            let snapshot = await source.snapshot()
            XCTAssertEqual(snapshot.storedBytes, 0)
            XCTAssertFalse(snapshot.isComplete)
            server.stop()
        }
    }

    func testRedirectsAndMissingLengthHaveExplicitSuccessfulCapabilities() async throws {
        for mode in [MediaHTTPServer.Mode.redirect, .missingLength] {
            let body = payload(count: 350_000)
            let server = try MediaHTTPServer(data: body, mode: mode)
            let url = try await server.start()
            let source = try HTTPMediaByteSource(url: url, directory: temporaryDirectory())
            let file = try await source.materialize()
            XCTAssertEqual(try Data(contentsOf: file), body)
            let metadata = try await source.metadata()
            XCTAssertEqual(metadata.capability, mode == .missingLength ? .completeFileRequired : .randomAccess)
            server.stop()
        }
    }

    func testStorageFailureDoesNotLeavePinOrCompletionState() async throws {
        let directory = temporaryDirectory()
        try Data([1]).write(to: directory)
        let source = try HTTPMediaByteSource(url: URL(string: "https://example.test/audio")!, directory: directory)
        do { try await source.pin(); XCTFail("An unwritable directory must fail") }
        catch { XCTAssertEqual(error as? MediaFailure, .storageUnavailable) }
        let pinned = await source.isPinned()
        XCTAssertFalse(pinned)
        let snapshot = await source.snapshot()
        XCTAssertFalse(snapshot.isComplete)
    }

    func testCancelledDownloadCatalogAndRangesSurviveRelaunchThenRetry() async throws {
        let body = payload(count: 600_000)
        let server = try MediaHTTPServer(data: body, delay: 0.1)
        let url = try await server.start()
        defer { server.stop() }
        let root = temporaryDirectory()
        let episode = episode(url: url)
        let store = MediaStore(accountID: "one", rootURL: root)
        let pending = Task { try await store.download(episode) }
        try await waitForRequests(server, count: 2)
        await store.cancel(episode)
        do { try await pending.value; XCTFail("Cancelled download must stop") }
        catch { XCTAssertEqual(error as? MediaFailure, .cancelled) }
        let relaunched = MediaStore(accountID: "one", rootURL: root)
        XCTAssertEqual(relaunched.downloadedEpisodes, [episode])
        guard case .paused(let received, _) = relaunched.status(for: episode) else { return XCTFail("Partial download must restore as paused") }
        XCTAssertGreaterThan(received, 0)
        try await relaunched.retry(episode)
        XCTAssertEqual(relaunched.status(for: episode), .available(bytes: Int64(body.count)))
        try await relaunched.remove(episode)
        XCTAssertTrue(relaunched.downloadedEpisodes.isEmpty)
        XCTAssertTrue(MediaStore(accountID: "one", rootURL: root).downloadedEpisodes.isEmpty)
    }

    func testRouterReleaseDuringPreparationAllowsAccountSwitchWithoutLeakedPin() async throws {
        for waitForNetwork in [false, true] {
            let server = try MediaHTTPServer(data: payload(count: 350_000), delay: 2)
            let url = try await server.start()
            let media = MediaStore(accountID: "one", rootURL: temporaryDirectory())
            let router = RoutingAudioTransport(media: media)
            router.load(source: .episode(episode(url: url)), at: 0, generation: UUID())
            if waitForNetwork { try await waitForRequests(server, count: 1) }
            let start = ContinuousClock.now
            await router.releaseMedia()
            XCTAssertLessThan(start.duration(to: .now), .seconds(1), "A canceled consumer must not wait for the shared network transfer")
            try await media.switchAccount(to: "two")
            XCTAssertEqual(media.accountID, "two")
            XCTAssertTrue(media.downloadedEpisodes.isEmpty)
            router.shutdown()
            server.stop()
        }
    }

    func testRouterPreparationFailureReleasesItsMediaLease() async throws {
        let server = try MediaHTTPServer(data: payload(count: 350_000), mode: .unauthorized)
        let url = try await server.start()
        defer { server.stop() }
        let media = MediaStore(accountID: "one", rootURL: temporaryDirectory())
        let router = RoutingAudioTransport(media: media)
        var failed = false
        router.onUpdate = { update in
            if case .failed = update.event { failed = true }
        }
        let episode = episode(url: url)
        router.load(source: .episode(episode), at: 0, generation: UUID())
        for _ in 0..<100 {
            if failed { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(failed)
        try await media.remove(episode)
        await router.releaseMedia()
        router.shutdown()
    }

    func testAccountSwitchFailsClosedWhenOldDiskCleanupFails() async throws {
        let server = try MediaHTTPServer(data: payload(count: 350_000))
        let url = try await server.start()
        defer { server.stop() }
        let root = temporaryDirectory()
        let episode = episode(url: url)
        let store = MediaStore(accountID: "one", rootURL: root)
        try await store.download(episode)
        let account = root.appendingPathComponent(MediaKey.scope("one"))
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: account.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: account.path) }
        do { try await store.switchAccount(to: "two"); XCTFail("Read-only old storage must report failed cleanup") }
        catch { XCTAssertEqual(error as? MediaFailure, .storageUnavailable) }
        XCTAssertEqual(store.accountID, "two")
        XCTAssertTrue(store.downloadedEpisodes.isEmpty)
        XCTAssertEqual(store.status(for: episode), .notDownloaded)
    }

    func testDurablePromotionPreventsEvictionFromAnOlderSnapshot() async throws {
        let server = try MediaHTTPServer(data: payload(count: 350_000))
        let url = try await server.start()
        defer { server.stop() }
        let source = try HTTPMediaByteSource(url: url, directory: temporaryDirectory())
        _ = try await source.read(offset: 0, count: 100)
        let candidate = await source.snapshot()
        XCTAssertFalse(candidate.durable)
        try await source.markDurable(episode: episode(url: url))
        let evicted = try await source.evictIfTransient()
        XCTAssertFalse(evicted)
        let preserved = try await source.read(offset: 0, count: 100)
        XCTAssertEqual(preserved.count, 100)
    }

    func testRapidCancelAndRetryCannotPauseTheReplacementDownload() async throws {
        let body = payload(count: 350_000)
        let server = try MediaHTTPServer(data: body, delay: 0.1)
        let url = try await server.start()
        defer { server.stop() }
        let store = MediaStore(accountID: "one", rootURL: temporaryDirectory())
        let episode = episode(url: url)
        let first = Task { try await store.download(episode) }
        try await waitForRequests(server, count: 1)
        let cancellation = Task { await store.cancel(episode) }
        let replacement = Task { try await store.retry(episode) }
        await cancellation.value
        _ = try? await first.value
        try await replacement.value
        XCTAssertEqual(store.status(for: episode), .available(bytes: Int64(body.count)))
    }

    func testFailedInvalidLocatorRemainsVisibleAndCanBeRemoved() async throws {
        let invalid = episode(url: URL(string: "file:///private/unavailable.mp3")!)
        let store = MediaStore(accountID: "one", rootURL: temporaryDirectory())
        do { try await store.download(invalid); XCTFail("Remote download rejects local paths") }
        catch { XCTAssertEqual(error as? MediaFailure, .invalidSource) }
        XCTAssertEqual(store.downloadedEpisodes, [invalid])
        XCTAssertEqual(store.status(for: invalid), .failed(.invalidSource))
        try await store.remove(invalid)
        XCTAssertTrue(store.downloadedEpisodes.isEmpty)
    }

    func testOrphanedPartialFileIsTruncatedAndMetadataStaysPrivate() async throws {
        let body = payload(count: 350_000)
        let server = try MediaHTTPServer(data: body)
        let url = try await server.start()
        defer { server.stop() }
        let directory = temporaryDirectory()
        try HTTPMediaByteSource.prepareDirectory(directory)
        try Data(repeating: 1, count: 500_000).write(to: directory.appendingPathComponent("media"))
        try Data("invalid manifest".utf8).write(to: directory.appendingPathComponent("manifest.json"))
        let source = try HTTPMediaByteSource(url: url, directory: directory)
        let file = try await source.materialize()
        XCTAssertEqual(try Data(contentsOf: file), body)
        let manifest = try String(contentsOf: directory.appendingPathComponent("manifest.json"), encoding: .utf8)
        XCTAssertFalse(manifest.contains("secret"))
        XCTAssertFalse(manifest.contains("127.0.0.1"))
        #if !targetEnvironment(simulator)
        let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
        XCTAssertEqual(attributes[.protectionKey] as? String, FileProtectionType.completeUntilFirstUserAuthentication.rawValue)
        #endif
        XCTAssertEqual(try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
    }

    func testOpaqueKeysIgnoreSignedLocatorAndSeparateAccounts() throws {
        let first = episode(url: URL(string: "https://example.test/private.mp3?token=secret-one")!)
        let second = episode(url: URL(string: "https://example.test/private.mp3?token=secret-two")!)
        XCTAssertEqual(MediaKey(accountID: "one", episode: first), MediaKey(accountID: "one", episode: second))
        XCTAssertNotEqual(MediaKey(accountID: "one", episode: first), MediaKey(accountID: "two", episode: first))
        XCTAssertEqual(MediaKey(accountID: "one", episode: first).rawValue.count, 64)
    }

    func testStreamingCacheEvictsOnlyAfterFinalLeaseReleases() async throws {
        let server = try MediaHTTPServer(data: payload(count: 400_000))
        let url = try await server.start()
        defer { server.stop() }
        let root = temporaryDirectory()
        let store = MediaStore(accountID: "one", rootURL: root, quotaBytes: 0)
        let episode = episode(url: url)
        let lease = try await store.pin(episode)
        _ = try await lease.byteSource.read(offset: 0, count: 100)
        await store.trimCache()
        let before = await lease.byteSource.snapshot()
        XCTAssertGreaterThan(before.storedBytes, 0)
        await lease.release()
        let directory = root.appendingPathComponent(MediaKey.scope("one")).appendingPathComponent(store.key(for: episode).rawValue)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
    }

    func testProgressiveDecoderReadsAndSeeksPCMWithoutDownloadingWholeFile() async throws {
        let data = try pcmFixture(frames: 480_000)
        let server = try MediaHTTPServer(data: data, contentType: "audio/wav")
        let url = try await server.start()
        defer { server.stop() }
        let source = try HTTPMediaByteSource(url: url, directory: temporaryDirectory())
        let decoder = ProgressiveAudioDecoder(source: source, blockFrames: 1024, bufferCount: 2)
        let first = UUID()
        let info = try await decoder.open(url: url, at: 0, generation: first)
        XCTAssertEqual(info.frameCount, 480_000)
        let block = try await decoder.read(slot: 0, generation: first)
        XCTAssertEqual(block.lease.buffer.frameLength, 1024)
        let samples = try XCTUnwrap(block.lease.buffer.floatChannelData)
        for frame in 0..<1024 { XCTAssertEqual(samples[0][frame], sample(frame), accuracy: 0.000001) }
        await decoder.release(slot: 0, generation: first)
        let partial = await source.snapshot()
        XCTAssertLessThan(partial.storedBytes, Int64(data.count))
        let next = UUID()
        _ = try await decoder.open(url: url, at: 6, generation: next)
        await decoder.close(generation: first)
        let sought = try await decoder.read(slot: 0, generation: next)
        XCTAssertEqual(sought.sourceStart, 288_000)
        let soughtSamples = try XCTUnwrap(sought.lease.buffer.floatChannelData)
        for frame in 0..<1024 { XCTAssertEqual(soughtSamples[0][frame], sample(frame + 288_000), accuracy: 0.000001) }
        await decoder.release(slot: 0, generation: next)
        let tailGeneration = UUID()
        _ = try await decoder.open(url: url, at: Double(480_000 - 257) / 48_000, generation: tailGeneration)
        let tail = try await decoder.read(slot: 0, generation: tailGeneration)
        XCTAssertEqual(tail.lease.buffer.frameLength, 257)
        XCTAssertFalse(tail.endOfFile)
        await decoder.release(slot: 0, generation: tailGeneration)
        let end = try await decoder.read(slot: 0, generation: tailGeneration)
        XCTAssertEqual(end.sourceStart, 480_000)
        XCTAssertEqual(end.lease.buffer.frameLength, 0)
        XCTAssertTrue(end.endOfFile)
        await decoder.release(slot: 0, generation: tailGeneration)
        let cleanup = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            await decoder.close(generation: tailGeneration)
        }
        await cleanup.value
        let remaining = await decoder.allocatedBytes()
        XCTAssertEqual(remaining, 0)
    }

    func testRealVBRMP3ProgressiveSeeksMatchLocalAppleDecoder() async throws {
        let fixture = try XCTUnwrap(Bundle(for: MediaTests.self).url(forResource: "progressive-vbr", withExtension: "mp3"))
        let data = try Data(contentsOf: fixture)
        let server = try MediaHTTPServer(data: data, contentType: "audio/mpeg")
        let url = try await server.start()
        defer { server.stop() }
        let source = try HTTPMediaByteSource(url: url, directory: temporaryDirectory())
        let decoder = ProgressiveAudioDecoder(source: source, blockFrames: 1024, bufferCount: 2)
        let local = try AVAudioFile(forReading: fixture)
        let expected = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: local.processingFormat, frameCapacity: 1024))
        for position in [0.0, 15.375, 76.12] {
            let generation = UUID()
            let info = try await decoder.open(url: url, at: position, generation: generation)
            XCTAssertTrue(info.durationIsEstimated)
            XCTAssertEqual(info.duration, 90, accuracy: 0.1)
            let block = try await decoder.read(slot: 0, generation: generation)
            XCTAssertEqual(block.sourceStart, info.startFrame)
            local.framePosition = info.startFrame
            try local.read(into: expected, frameCount: 1024)
            XCTAssertEqual(block.lease.buffer.frameLength, expected.frameLength)
            let actual = try XCTUnwrap(block.lease.buffer.floatChannelData)
            let reference = try XCTUnwrap(expected.floatChannelData)
            for frame in 0..<Int(expected.frameLength) {
                XCTAssertEqual(actual[0][frame], reference[0][frame], accuracy: 0.000002, "Source sample differs after VBR seek")
            }
            await decoder.release(slot: 0, generation: generation)
            if position == 0 {
                let partial = await source.snapshot()
                XCTAssertLessThan(partial.storedBytes, Int64(data.count))
            }
            await decoder.close(generation: generation)
        }
    }

    func testProgressiveAppleDecodingForMP3AACAndM4A() async throws {
        let fixtures = [
            ("audio/mpeg", try mp3Fixture()),
            ("audio/aac", try aacFixture(extension: "aac")),
            ("audio/mp4", try aacFixture(extension: "m4a"))
        ]
        for (contentType, data) in fixtures {
            let server = try MediaHTTPServer(data: data, contentType: contentType)
            let url = try await server.start()
            let source = try HTTPMediaByteSource(url: url, directory: temporaryDirectory())
            let decoder = ProgressiveAudioDecoder(source: source, blockFrames: 1024, bufferCount: 2)
            let generation = UUID()
            let info = try await decoder.open(url: url, at: 0, generation: generation)
            XCTAssertGreaterThan(info.frameCount, 100_000, contentType)
            let block = try await decoder.read(slot: 0, generation: generation)
            let samples = try XCTUnwrap(block.lease.buffer.floatChannelData)
            XCTAssertGreaterThan(block.lease.buffer.frameLength, 0, contentType)
            XCTAssertTrue((0..<Int(block.lease.buffer.frameLength)).allSatisfy { samples[0][$0].isFinite }, contentType)
            await decoder.release(slot: 0, generation: generation)
            let partial = await source.snapshot()
            XCTAssertLessThan(partial.storedBytes, Int64(data.count), "Initial decode must remain progressive for \(contentType)")
            let position = Double(info.frameCount / 2) / info.sampleRate
            let soughtGeneration = UUID()
            let soughtInfo = try await decoder.open(url: url, at: position, generation: soughtGeneration)
            let sought = try await decoder.read(slot: 1, generation: soughtGeneration)
            XCTAssertEqual(sought.sourceStart, soughtInfo.startFrame, contentType)
            XCTAssertGreaterThan(sought.lease.buffer.frameLength, 0, contentType)
            await decoder.release(slot: 1, generation: soughtGeneration)
            await decoder.close(generation: soughtGeneration)
            server.stop()
        }
    }

    private func aacFixture(extension suffix: String) throws -> Data {
        let directory = temporaryDirectory()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("fixture.\(suffix)")
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 128_000]
        var file: AVAudioFile? = try AVAudioFile(forWriting: url, settings: settings)
        let format = try XCTUnwrap(file?.processingFormat)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096))
        var offset = 0
        let frames = 48_000 * 45
        while offset < frames {
            let count = min(4096, frames - offset)
            buffer.frameLength = AVAudioFrameCount(count)
            let samples = try XCTUnwrap(buffer.floatChannelData)
            for frame in 0..<count { samples[0][frame] = sample(offset + frame) }
            try file?.write(from: buffer)
            offset += count
        }
        file = nil
        return try Data(contentsOf: url)
    }

    private func mp3Fixture() throws -> Data {
        let url = try XCTUnwrap(Bundle(for: MediaTests.self).url(forResource: "progressive-vbr", withExtension: "mp3"))
        return try Data(contentsOf: url)
    }

    private func temporaryDirectory() -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("media-test-\(UUID())", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory
    }

    private func payload(count: Int) -> Data { Data((0..<count).map { UInt8(($0 * 17) % 251) }) }

    private func episode(url: URL) -> Episode {
        Episode(id: 42, podcastId: 7, guid: "episode-42", feed: "https://example.test/private-feed?key=private", podcastTitle: "Test", title: "Private episode", file: EpisodeFile(url: url.absoluteString))
    }

    private func waitForRequests(_ server: MediaHTTPServer, count: Int) async throws {
        for _ in 0..<100 {
            if server.requests.count >= count { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("The controlled HTTP server did not receive a request")
    }

    private func sample(_ frame: Int) -> Float { Float(sin(Double(frame) * 0.013) * 0.2) }

    private func pcmFixture(frames: Int) throws -> Data {
        let directory = temporaryDirectory()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("fixture.wav")
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1))
        var file: AVAudioFile? = try AVAudioFile(forWriting: url, settings: format.settings)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096))
        var offset = 0
        while offset < frames {
            let count = min(4096, frames - offset)
            buffer.frameLength = AVAudioFrameCount(count)
            let samples = try XCTUnwrap(buffer.floatChannelData)
            for frame in 0..<count { samples[0][frame] = sample(offset + frame) }
            try file?.write(from: buffer)
            offset += count
        }
        file = nil
        return try Data(contentsOf: url)
    }
}

private final class MediaHTTPServer: @unchecked Sendable {
    enum Mode { case ranges, ignoreRange, weakValidator, badRange, unauthorized, truncated, redirect, missingLength }
    private let listener: NWListener
    private let queue = DispatchQueue(label: "app.podcst.tests.http")
    private let lock = NSLock()
    private var data: Data
    private var etag = "\"version-1\""
    private var recorded: [[String: String]] = []
    private var connections: [NWConnection] = []
    private let mode: Mode
    private let delay: TimeInterval
    private let contentType: String

    init(data: Data, mode: Mode = .ranges, delay: TimeInterval = 0, contentType: String = "audio/mpeg") throws {
        self.data = data
        self.mode = mode
        self.delay = delay
        self.contentType = contentType
        listener = try NWListener(using: .tcp, on: .any)
    }

    var requests: [[String: String]] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    func replace(data: Data, etag: String) {
        lock.lock()
        self.data = data
        self.etag = etag
        lock.unlock()
    }

    func start() async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            listener.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                switch state {
                case .ready:
                    self.listener.stateUpdateHandler = nil
                    continuation.resume(returning: URL(string: "http://127.0.0.1:\(self.listener.port!.rawValue)/episode?private=secret")!)
                case .failed(let error):
                    self.listener.stateUpdateHandler = nil
                    continuation.resume(throwing: error)
                default: break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                guard let self else { return }
                self.lock.lock()
                self.connections.append(connection)
                self.lock.unlock()
                connection.start(queue: self.queue)
                self.receive(connection, pending: Data())
            }
            listener.start(queue: queue)
        }
    }

    func stop() {
        listener.cancel()
        lock.lock()
        let connections = connections
        self.connections = []
        lock.unlock()
        for connection in connections { connection.cancel() }
    }

    private func receive(_ connection: NWConnection, pending: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, complete, error in
            guard let self, error == nil else { connection.cancel(); return }
            let received = pending + (data ?? Data())
            guard let text = String(data: received, encoding: .utf8), text.contains("\r\n\r\n") else {
                if complete { connection.cancel() }
                else { self.receive(connection, pending: received) }
                return
            }
            self.respond(connection, request: text)
        }
    }

    private func respond(_ connection: NWConnection, request: String) {
        var headers: [String: String] = [:]
        for line in request.components(separatedBy: "\r\n").dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            headers[String(line[..<colon]).lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        lock.lock()
        recorded.append(headers)
        let data = data
        let etag = etag
        lock.unlock()
        if mode == .redirect, !request.hasPrefix("GET /redirected ") {
            let response = Data("HTTP/1.1 302 Found\r\nLocation: /redirected\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8)
            connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
            return
        }
        if mode == .unauthorized {
            connection.send(content: Data("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8), completion: .contentProcessed { _ in connection.cancel() })
            return
        }
        var body = data
        var status = "200 OK"
        var extra = ""
        if mode != .ignoreRange, mode != .missingLength, headers["if-range"] == nil || headers["if-range"] == etag,
           let range = headers["range"], range.hasPrefix("bytes=") {
            let bounds = range.dropFirst(6).split(separator: "-")
            if bounds.count == 2, let first = Int(bounds[0]), let last = Int(bounds[1]), first < data.count, last >= first {
                let upper = min(data.count, last + 1)
                body = data.subdata(in: first..<upper)
                status = "206 Partial Content"
                extra = "Content-Range: bytes \(mode == .badRange ? first + 1 : first)-\(upper - 1)/\(data.count)\r\n"
            }
        }
        let validator = mode == .weakValidator ? "W/\(etag)" : etag
        let length = mode == .missingLength ? "" : "Content-Length: \(mode == .truncated ? body.count + 10 : body.count)\r\n"
        let response = "HTTP/1.1 \(status)\r\n\(length)Content-Type: \(contentType)\r\nETag: \(validator)\r\n\(extra)Connection: close\r\n\r\n"
        let responseData = Data(response.utf8) + body
        queue.asyncAfter(deadline: .now() + delay) {
            connection.send(content: responseData, completion: .contentProcessed { _ in connection.cancel() })
        }
    }
}
