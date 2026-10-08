import XCTest
@testable import Podcst

@MainActor final class DurableStateStoreTests: XCTestCase {
    private var directory: URL!
    override func setUp() async throws { directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString) }
    override func tearDown() async throws { try? FileManager.default.removeItem(at: directory) }
    private func store(_ server: StateServer, save: ((Data, URL) throws -> Void)? = nil) -> DurableStateStore {
        DurableStateStore(directory: directory, api: server, save: save)
    }

    func testLostAckOppositeActionAndRestartRetiresOnlyWithAuthoritativeRead() async throws {
        let api = StateServer()
        var state = store(api)
        try await state.activate(accountID: "a")
        try state.setProgress(id: 9_007_199_254_740_993, position: 90, event: .checkpoint)
        api.loseAck = true
        await state.flush()
        XCTAssertTrue(state.pending)
        api.position = 12; api.progressRevision = 2
        state = store(api)
        try await state.activate(accountID: "a")
        await state.flush()
        XCTAssertEqual(api.progressBatches.count, 2)
        XCTAssertEqual(api.progressBatches[0], api.progressBatches[1])
        XCTAssertEqual(state.position(9_007_199_254_740_993)?.positionSeconds, 12)
        XCTAssertFalse(state.pending)
        let data = try Data(contentsOf: directory.appendingPathComponent("durable-state-v1.json"))
        XCTAssertTrue(String(decoding: data, as: UTF8.self).contains("9007199254740993"))
    }

    func testFollowLostAckCannotResurrectRemoteUnfollow() async throws {
        let api = StateServer()
        var state = store(api)
        try await state.activate(accountID: "a")
        try state.setFollow(Podcast(id: 9_007_199_254_740_993, feed: "fixture", title: "Fixture"), followed: true)
        api.loseFollowAck = true
        await state.flush()
        XCTAssertTrue(state.followedIDs.contains(9_007_199_254_740_993))
        api.members = []; api.followRevision = 2
        state = store(api)
        try await state.activate(accountID: "a")
        await state.flush()
        XCTAssertEqual(api.followBatches.count, 2)
        XCTAssertEqual(api.followBatches[0], api.followBatches[1])
        XCTAssertTrue(state.followedIDs.isEmpty)
        XCTAssertFalse(state.pending)
    }

    func testStorageFailureAtFreezeAckAndReadPreservesExactWork() async throws {
        for boundary in ["flight", "acknowledgement", "positions"] {
            directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            let api = StateServer()
            var fail = false
            var failed = false
            let state = store(api, save: { data, url in
                let text = String(decoding: data, as: UTF8.self)
                let matches: Bool
                if boundary == "positions" { matches = text.contains("\"positions\":{") && !text.contains("\"positions\":{}") && !text.contains("\"flight\"") }
                else { matches = text.contains("\"\(boundary)\"") }
                if fail && matches && !failed { failed = true; throw CocoaError(.fileWriteNoPermission) }
                try DurableStateStore.protectedWrite(data, url)
            })
            try await state.activate(accountID: "a")
            try state.setProgress(id: 1, position: 90, event: .checkpoint)
            fail = true
            await state.flush()
            XCTAssertTrue(failed, boundary)
            XCTAssertTrue(state.pending, boundary)
            XCTAssertEqual(state.position(1)?.positionSeconds, 90)
            let recovered = store(api)
            try await recovered.activate(accountID: "a")
            await recovered.flush()
            XCTAssertFalse(recovered.pending, boundary)
            if api.progressBatches.count == 2 { XCTAssertEqual(api.progressBatches[0], api.progressBatches[1]) }
            try FileManager.default.removeItem(at: directory)
        }
    }

    func testNewerIntentDuringFlightSurvivesAndUsesNextSequence() async throws {
        let api = StateServer()
        let state = store(api)
        try await state.activate(accountID: "a")
        try state.setProgress(id: 1, position: 90, event: .checkpoint)
        api.beforeProgress = {
            api.beforeProgress = nil
            try! state.setProgress(id: 1, position: 12, event: .replay)
        }
        await state.flush()
        XCTAssertEqual(api.progressBatches.map { $0.sequence.value }, ["1", "2"])
        XCTAssertEqual(api.progressBatches.map { $0.changes[0].positionSeconds }, [90, 12])
        XCTAssertEqual(state.position(1)?.positionSeconds, 12)
    }

    func testGuestUnionIsAtomicAndAccountWorkSurvivesAToBToA() async throws {
        let api = StateServer()
        var deny = false
        var state = store(api, save: { data, url in
            if deny { throw CocoaError(.fileWriteNoPermission) }
            try DurableStateStore.protectedWrite(data, url)
        })
        try state.setFollow(Podcast(id: 1, feed: "fixture", title: "Guest"), followed: true)
        try state.setProgress(id: 1, position: 90, event: .checkpoint)
        deny = true
        do { try await state.activate(accountID: "a"); XCTFail("Guest consume must fail atomically") } catch {}
        XCTAssertEqual(state.guestFollows.count, 1)
        state = store(api)
        try await state.activate(accountID: "a")
        XCTAssertTrue(state.guestFollows.isEmpty)
        XCTAssertNil(state.position(1))
        XCTAssertEqual(state.followedIDs, [1])
        try state.setProgress(id: 1, position: 12, event: .checkpoint)
        try state.checkpointAndSuspend()
        XCTAssertFalse(state.pending)
        api.user = "b"
        try await state.activate(accountID: "b")
        XCTAssertNil(state.position(1)); XCTAssertTrue(state.followedIDs.isEmpty)
        api.user = "a"
        try await state.activate(accountID: "a")
        XCTAssertEqual(state.position(1)?.positionSeconds, 12)
        XCTAssertEqual(state.followedIDs, [1])
        await state.flush()
        XCTAssertEqual(api.followBatches.count, 1)
        try await state.activate(accountID: "a")
        await state.flush()
        XCTAssertEqual(api.followBatches.count, 1)
    }

    func testAuthExpiryPausesAndGenerationConflictBlocksWithoutNewStream() async throws {
        let api = StateServer()
        var state = store(api)
        try await state.activate(accountID: "a")
        try state.setProgress(id: 1, position: 90, event: .checkpoint)
        api.status = 401
        await state.flush()
        XCTAssertFalse(state.verified)
        XCTAssertNil(state.position(1))
        api.sessionStatus = 401
        do { try await state.activate(accountID: "a", verifiedAccountID: "a"); XCTFail("A previously verified session cannot bypass an auth pause") } catch {}
        XCTAssertFalse(state.verified)
        XCTAssertEqual(api.progressBatches.count, 1)
        api.sessionStatus = nil
        api.status = nil
        api.generation = "27adbd84-d0e4-4e2d-ad9f-b084efee3211"
        state = store(api)
        try await state.activate(accountID: "a")
        await state.flush()
        XCTAssertTrue(state.blocked)
        let count = api.progressBatches.count
        state = store(api)
        try await state.activate(accountID: "a")
        await state.flush()
        XCTAssertEqual(api.progressBatches.count, count)
        XCTAssertTrue(state.pending)
        XCTAssertEqual(api.progressBatches.first?.clientId, api.progressBatches.last?.clientId)
    }

    func testExpiredSnapshotPausesBeforeAnyMutation() async throws {
        let api = StateServer()
        let state = store(api)
        try await state.activate(accountID: "a")
        try state.setProgress(id: 1, position: 12, event: .checkpoint)
        api.readStatus = 401
        do { try await state.refreshProgress(ids: [1]); XCTFail("Expired read must fail") } catch {}
        XCTAssertFalse(state.verified)
        await state.flush()
        XCTAssertTrue(api.progressBatches.isEmpty)
    }

    func testStaleReadAndOrderedResultMismatchCannotConsumeFlight() async throws {
        for malformed in [false, true] {
            directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            let api = StateServer()
            api.stale = !malformed; api.malformedAck = malformed
            let state = store(api)
            try await state.activate(accountID: "a")
            try state.setProgress(id: 1, position: 90, event: .checkpoint)
            await state.flush()
            XCTAssertTrue(state.pending); XCTAssertTrue(state.blocked)
            XCTAssertEqual(state.position(1)?.positionSeconds, 90)
            try FileManager.default.removeItem(at: directory)
        }
    }

    func testCompletionRequiresEndedOrPlayedAndReplayClearsIt() async throws {
        let state = store(StateServer())
        for position in [94.0, 95.0, 100.0] {
            try state.setProgress(id: 1, position: position, event: .checkpoint)
            XCTAssertEqual(state.position(1)?.completed, false)
        }
        try state.setProgress(id: 1, position: 0, event: .played)
        XCTAssertEqual(state.position(1)?.completed, true)
        try state.setProgress(id: 1, position: 0, event: .checkpoint)
        XCTAssertEqual(state.position(1)?.completed, true)
        try state.setProgress(id: 1, position: 12, event: .replay)
        XCTAssertEqual(state.position(1)?.completed, false)
        try state.setProgress(id: 1, position: 12, event: .ended)
        try state.setProgress(id: 1, position: 12, event: .unplayed)
        XCTAssertEqual(state.position(1)?.completed, false)
        XCTAssertEqual(state.position(1)?.positionSeconds, 0)
    }

    func testLegacyProgressPreservesSourceAndRequiresExplicitSafeReapply() async throws {
        let api = StateServer()
        let source = directory.appendingPathComponent("legacy.json")
        let bytes = Data(#"[{"episodeID":1,"position":90,"completed":false},{"episodeID":9007199254740993,"position":12,"completed":true}]"#.utf8)
        try DurableStateStore.protectedWrite(bytes, source)
        let state = store(api)
        try await state.activate(accountID: "a")
        try state.importLegacyProgress(source)
        await state.flush()
        XCTAssertTrue(api.progressBatches.isEmpty)
        XCTAssertEqual(state.legacyProgress.count, 2)
        XCTAssertThrowsError(try state.reapplyLegacy(state.legacyProgress[1]))
        try state.reapplyLegacy(state.legacyProgress[0])
        await state.flush()
        XCTAssertEqual(api.progressBatches.count, 1)
        XCTAssertEqual(try Data(contentsOf: source), bytes)
        let restart = store(api)
        try await restart.activate(accountID: "a")
        try restart.importLegacyProgress(source)
        XCTAssertEqual(restart.legacyProgress.count, 1)
    }

    func testCorruptOrDeniedStorageIsVisibleAndNeverOverwritten() async throws {
        let api = StateServer()
        let url = directory.appendingPathComponent("durable-state-v1.json")
        try DurableStateStore.protectedWrite(Data("bad".utf8), url)
        let state = store(api)
        XCTAssertTrue(state.blocked)
        XCTAssertThrowsError(try state.setProgress(id: 1, position: 1, event: .checkpoint))
        XCTAssertEqual(try Data(contentsOf: url), Data("bad".utf8))
        XCTAssertNotNil(state.error)
    }

    func testActualFilesystemWriteDenialCannotPublishSavedIntent() throws {
        let bytes = Data("not a directory".utf8)
        try bytes.write(to: directory)
        let state = store(StateServer())
        XCTAssertThrowsError(try state.setProgress(id: 1, position: 12, event: .checkpoint))
        XCTAssertNil(state.position(1))
        XCTAssertEqual(try Data(contentsOf: directory), bytes)
        XCTAssertNotNil(state.error)
    }

    func testRateLimitedFrozenWorkRetriesIdenticallyAfterRestart() async throws {
        let api = StateServer()
        var state = store(api)
        try await state.activate(accountID: "a")
        try state.setProgress(id: 1, position: 90, event: .checkpoint)
        api.status = 429
        await state.flush()
        await state.flush()
        XCTAssertEqual(api.progressBatches.count, 1)
        XCTAssertTrue(state.pending)
        api.status = nil
        state = store(api)
        try await state.activate(accountID: "a")
        await state.flush()
        XCTAssertEqual(api.progressBatches.count, 2)
        XCTAssertEqual(api.progressBatches[0], api.progressBatches[1])
        XCTAssertFalse(state.pending)
    }

    func testTerminalEraseIsExplicitAndDoesNotEraseOtherAccountsOrGuest() async throws {
        let api = StateServer()
        let state = store(api)
        try state.setProgress(id: 1, position: 7, event: .checkpoint)
        try await state.activate(accountID: "a")
        try state.setProgress(id: 1, position: 12, event: .checkpoint)
        api.user = "b"
        try await state.activate(accountID: "b")
        try state.setProgress(id: 2, position: 13, event: .checkpoint)
        try state.terminalErase(accountID: "a")
        XCTAssertEqual(state.position(2)?.positionSeconds, 13)
        api.user = "a"
        try await state.activate(accountID: "a")
        XCTAssertNil(state.position(1))
        try await state.activate(accountID: nil)
        XCTAssertEqual(state.position(1)?.positionSeconds, 7)
    }

    func testCanonicalIdentityAndLegacyMediaBytesArePreserved() throws {
        let episode = Episode(id: 9_007_199_254_740_993, guid: "guid", feed: "one", title: "Episode", file: EpisodeFile(url: "old"))
        var moved = episode; moved.feed = "two"; moved.file.url = "new"
        XCTAssertEqual(episode.identity, moved.identity)
        XCTAssertEqual(MediaKey(accountID: nil, episode: episode), MediaKey(accountID: nil, episode: moved))
        var another = episode; another.id = 9_007_199_254_740_994
        XCTAssertNotEqual(episode.identity, another.identity)
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(episode)) as? [String: Any])
        json["id"] = Int64(9_007_199_254_740_993)
        let legacy = try JSONDecoder().decode(Episode.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertNil(legacy.id)
        XCTAssertTrue(legacy.identity.hasPrefix("local:"))
        XCTAssertEqual(MediaKey(accountID: nil, episode: legacy), MediaKey(accountID: nil, episode: episode))
        let saved = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(legacy)) as? [String: Any])
        XCTAssertEqual((saved["id"] as? NSNumber)?.int64Value, 9_007_199_254_740_993)
        XCTAssertEqual(try JSONDecoder().decode(Episode.self, from: JSONEncoder().encode(episode)).id, episode.id)
    }

    // Run these individually in separate xcodebuild invocations to prove a process boundary.
    private var processDirectory: URL { FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("DurableStateSyntheticRestart") }
    func testProcessRestartWrite() async throws {
        try? FileManager.default.removeItem(at: processDirectory)
        let api = StateServer(); api.loseAck = true
        let state = DurableStateStore(directory: processDirectory, api: api)
        try await state.activate(accountID: "a")
        try state.setProgress(id: 1, position: 90, event: .checkpoint)
        await state.flush()
        try Data(String(ProcessInfo.processInfo.processIdentifier).utf8).write(to: processDirectory.appendingPathComponent("pid"))
        XCTAssertTrue(state.pending)
        let attrs = try FileManager.default.attributesOfItem(atPath: processDirectory.appendingPathComponent("durable-state-v1.json").path)
        #if targetEnvironment(simulator)
        // Simulator does not implement the device data-protection filesystem attribute.
        XCTAssertGreaterThan((attrs[.size] as? NSNumber)?.intValue ?? 0, 0)
        #else
        XCTAssertEqual(attrs[.protectionKey] as? FileProtectionType, .completeUntilFirstUserAuthentication)
        #endif
    }
    func testProcessRestartRead() async throws {
        let pidURL = processDirectory.appendingPathComponent("pid")
        guard FileManager.default.fileExists(atPath: pidURL.path) else { throw XCTSkip("Run testProcessRestartWrite in a separate invocation first") }
        XCTAssertNotEqual(try String(contentsOf: pidURL, encoding: .utf8), String(ProcessInfo.processInfo.processIdentifier))
        let api = StateServer()
        let state = DurableStateStore(directory: processDirectory, api: api)
        try await state.activate(accountID: "a")
        XCTAssertEqual(state.position(1)?.positionSeconds, 90)
        await state.flush()
        XCTAssertEqual(api.progressBatches.first?.sequence.value, "1")
        XCTAssertFalse(state.pending)
        try FileManager.default.removeItem(at: processDirectory)
    }
}

@MainActor private final class StateServer: DurableStateAPI {
    var user = "a"
    var generation = "17adbd84-d0e4-4e2d-ad9f-b084efee3211"
    var position = 0
    var completed = false
    var progressRevision = 0
    var followRevision = 0
    var members: Set<Int> = []
    var progressBatches: [StateBatch<StateProgressChange>] = []
    var followBatches: [StateBatch<StateFollowChange>] = []
    var progressAcks: [String: StateAcknowledgement<StateProgressResult>] = [:]
    var followAcks: [String: StateAcknowledgement<StateFollowResult>] = [:]
    var loseAck = false
    var loseFollowAck = false
    var stale = false
    var malformedAck = false
    var status: Int?
    var sessionStatus: Int?
    var readStatus: Int?
    var beforeProgress: (() -> Void)?
    func sessionUser() async throws -> User? {
        if let sessionStatus { throw APIError(statusCode: sessionStatus, message: "Synthetic session failure") }
        return User(id: user, email: "synthetic@example.invalid")
    }
    func progressState(ids: [Int]?) async throws -> StateSnapshot<StateProgressItem> {
        if let readStatus { throw APIError(statusCode: readStatus, message: "Synthetic snapshot failure") }
        let items = try (ids ?? []).map { id in
            let progress: StateProgress? = progressRevision == 0 ? nil : StateProgress(positionSeconds: position, completed: completed, revision: try StateID(String(progressRevision)), updatedAtMs: try JSONDecoder().decode(StateTimestamp.self, from: Data("null".utf8)))
            return try JSONDecoder().decode(StateProgressItem.self, from: JSONEncoder().encode(Item(episodeId: StateID(String(id)), progress: progress)))
        }
        return StateSnapshot(protocol: 1, accountId: user, generation: generation, revision: try StateRevision(String(stale ? 0 : progressRevision)), items: items)
    }
    private struct Item: Encodable { var episodeId: StateID; var progress: StateProgress?; func encode(to encoder: Encoder) throws { var c = encoder.container(keyedBy: Keys.self); try c.encode(episodeId, forKey: .episodeId); try c.encode(progress, forKey: .progress) }; enum Keys: String, CodingKey { case episodeId, progress } }
    func followState() async throws -> StateSnapshot<StateFollowItem> {
        StateSnapshot(protocol: 1, accountId: user, generation: generation, revision: try StateRevision(String(followRevision)), items: try members.sorted().map { StateFollowItem(podcastId: try StateID(String($0)), revision: try StateID(String(max(1, followRevision))), followedAtMs: try JSONDecoder().decode(StateTimestamp.self, from: Data("null".utf8)), availability: .available) })
    }
    func changeProgress(_ batch: StateBatch<StateProgressChange>) async throws -> StateAcknowledgement<StateProgressResult> {
        progressBatches.append(batch)
        beforeProgress?()
        if let status { throw APIError(statusCode: status, message: "Synthetic failure") }
        if batch.generation != generation { throw APIError(statusCode: 409, message: "Recovery required", code: "recovery_required") }
        let key = batch.clientId + ":" + batch.sequence.value
        if let ack = progressAcks[key] { return ack }
        for change in batch.changes { position = change.positionSeconds; completed = change.completed; progressRevision += 1 }
        let ack = StateAcknowledgement(protocol: 1, accountId: user, generation: generation, clientId: batch.clientId, sequence: batch.sequence, revision: try StateRevision(String(progressRevision)), results: try batch.changes.map { StateProgressResult(episodeId: malformedAck ? try StateID("999") : $0.episodeId, status: .applied) })
        progressAcks[key] = ack
        if loseAck { loseAck = false; throw URLError(.networkConnectionLost) }
        return ack
    }
    func changeFollows(_ batch: StateBatch<StateFollowChange>) async throws -> StateAcknowledgement<StateFollowResult> {
        followBatches.append(batch)
        let key = batch.clientId + ":" + batch.sequence.value
        if let ack = followAcks[key] { return ack }
        for change in batch.changes {
            if change.followed { members.insert(change.podcastId.number) } else { members.remove(change.podcastId.number) }
            followRevision += 1
        }
        let ack = StateAcknowledgement(protocol: 1, accountId: user, generation: generation, clientId: batch.clientId, sequence: batch.sequence, revision: try StateRevision(String(followRevision)), results: batch.changes.map { StateFollowResult(podcastId: $0.podcastId, status: .applied) })
        followAcks[key] = ack
        if loseFollowAck { loseFollowAck = false; throw URLError(.networkConnectionLost) }
        return ack
    }
}
