import XCTest
@testable import Podcst

@MainActor final class DurableStateStoreTests: XCTestCase {
    private var directory: URL!
    override func setUp() async throws { directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString) }
    override func tearDown() async throws { try? FileManager.default.removeItem(at: directory) }
    private func store(_ server: StateServer, save: ((Data, URL) throws -> Void)? = nil) -> DurableStateStore {
        DurableStateStore(directory: directory, api: server, save: save)
    }

    func testImportRetryDeadlinesSurviveRestartWithoutChangingOtherAccountWork() async throws {
        let api = StateServer()
        var state = store(api)
        try await state.activate(accountID: "a")
        let feed = "https://example.invalid/retry"
        try state.stageImport([feed])
        let now = Date()
        try state.deferImport([feed], seconds: 60, now: now)
        XCTAssertFalse(state.importReady(feed, now: now))
        state = store(api)
        try await state.activate(accountID: "a")
        XCTAssertEqual(state.pendingImportFeeds, [feed])
        XCTAssertFalse(state.importReady(feed, now: now.addingTimeInterval(59)))
        XCTAssertTrue(state.importReady(feed, now: now.addingTimeInterval(60)))
        try state.resolvedImport(feed: feed, id: StateID("9007199254740993"))
        XCTAssertTrue(state.pendingImportFeeds.isEmpty)
        XCTAssertTrue(state.followedIDs.contains(9_007_199_254_740_993))
    }

    func testGuestImportBoundPersistsAndDoesNotConsumeSourcesOnRefusal() throws {
        var state = store(StateServer())
        let feeds = (0..<FeedLimits.current.opml.pendingPerScope).map { "https://example.invalid/\($0)" }
        try state.stageGuestImport(feeds)
        XCTAssertThrowsError(try state.stageGuestImport(["https://example.invalid/overflow"]))
        state = store(StateServer())
        XCTAssertEqual(state.pendingImportFeeds, feeds)
        XCTAssertNoThrow(try state.stageGuestImport([feeds[0]]))
        let token = state.activityToken
        state.suspend()
        XCTAssertNotEqual(state.activityToken, token)
        XCTAssertEqual(state.pendingImportFeeds, feeds)
    }

    func testPendingImportBoundRejectsAdditionsWithoutConsumingSources() async throws {
        let state = store(StateServer())
        try await state.activate(accountID: "a")
        let feeds = (0..<FeedLimits.current.opml.pendingPerScope).map { "https://example.invalid/\($0)" }
        try state.stageImport(feeds)
        XCTAssertThrowsError(try state.stageImport(["https://example.invalid/overflow"]))
        XCTAssertEqual(state.pendingImportFeeds, feeds)
        XCTAssertNoThrow(try state.stageImport([feeds[0]]))
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

    func testRemotePlayedSurvivesCheckpointUntilExplicitReplay() async throws {
        let api = StateServer()
        api.progressRevision = 1
        api.position = 10
        let state = store(api)
        try await state.activate(accountID: "a")
        try await state.refreshProgress(ids: [1])
        XCTAssertEqual(state.position(1)?.completed, false)
        api.completed = true
        api.progressRevision = 2
        try state.setProgress(id: 1, position: 95, event: .checkpoint)
        XCTAssertEqual(state.position(1)?.completed, false)
        await state.flush()
        XCTAssertNil(api.progressBatches[0].changes[0].completed)
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(api.progressBatches[0])) as? [String: Any])
        XCTAssertTrue((sent["changes"] as? [[String: Any]])?.first?["completed"] is NSNull)
        XCTAssertEqual(state.position(1)?.completed, true)
        XCTAssertEqual(state.position(1)?.positionSeconds, 95)
        try state.setProgress(id: 1, position: 12, event: .replay)
        await state.flush()
        XCTAssertEqual(api.progressBatches[1].changes[0].completed, false)
        XCTAssertEqual(state.position(1)?.completed, false)
        XCTAssertEqual(state.position(1)?.positionSeconds, 12)
    }

    func testOfflineNullCheckpointRetainsKnownCompletionAcrossSuspendAndRestart() async throws {
        let api = StateServer()
        api.progressRevision = 1
        api.completed = true
        var state = store(api)
        try await state.activate(accountID: "a")
        try await state.refreshProgress(ids: [1])
        try state.setProgress(id: 1, position: 94, event: .checkpoint)
        api.status = 503
        await state.flush()
        XCTAssertNil(api.progressBatches[0].changes[0].completed)
        XCTAssertEqual(state.position(1)?.completed, true)
        try state.checkpointAndSuspend()
        state = store(api)
        try await state.activate(accountID: "a")
        XCTAssertEqual(state.position(1)?.completed, true)
        XCTAssertEqual(state.position(1)?.positionSeconds, 94)
        api.status = nil
        await state.flush()
        XCTAssertEqual(api.progressBatches[0], api.progressBatches[1])
        XCTAssertEqual(state.position(1)?.completed, true)
    }

    func testQueuedCheckpointsCoalesceWithoutDiscardingExplicitCompletion() async throws {
        let api = StateServer()
        var state = store(api)
        try await state.activate(accountID: "a")
        try state.setProgress(id: 1, position: 0, event: .played)
        for position in [94.0, 95.0, 100.0] { try state.setProgress(id: 1, position: position, event: .checkpoint) }
        XCTAssertEqual(state.position(1)?.completed, true)
        state = store(api)
        try await state.activate(accountID: "a")
        XCTAssertEqual(state.position(1)?.completed, true)
        await state.flush()
        XCTAssertEqual(api.progressBatches[0].changes.count, 2)
        XCTAssertEqual(api.progressBatches[0].changes.map(\.positionSeconds), [0, 100])
        XCTAssertEqual(api.progressBatches[0].changes[0].completed, true)
        XCTAssertNil(api.progressBatches[0].changes[1].completed)
        XCTAssertEqual(state.position(1)?.completed, true)
        try state.setProgress(id: 1, position: 70, event: .checkpoint)
        try state.setProgress(id: 1, position: 70, event: .unplayed)
        await state.flush()
        XCTAssertEqual(api.progressBatches[1].changes.count, 1)
        XCTAssertEqual(api.progressBatches[1].changes[0].completed, false)
        XCTAssertEqual(api.progressBatches[1].changes[0].positionSeconds, 0)
    }

    func testFrozenBooleanPayloadIsNeverRewrittenByCheckpointRefinement() async throws {
        for completed in [false, true] {
            directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            let api = StateServer()
            var state = store(api)
            try await state.activate(accountID: "a")
            try state.setProgress(id: 1, position: 12, event: completed ? .played : .replay)
            api.loseAck = true
            await state.flush()
            let original = api.progressBatches[0]
            let originalPayload = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as? NSDictionary)
            XCTAssertEqual(original.changes[0].completed, completed)
            api.completed = !completed
            api.progressRevision += 1
            try state.setProgress(id: 1, position: 20, event: .checkpoint)
            state = store(api)
            try await state.activate(accountID: "a")
            await state.flush()
            XCTAssertEqual(api.progressBatches[1], original)
            XCTAssertEqual(try JSONSerialization.jsonObject(with: JSONEncoder().encode(api.progressBatches[1])) as? NSDictionary, originalPayload)
            XCTAssertEqual(api.progressBatches[1].changes[0].completed, completed)
            XCTAssertNil(api.progressBatches[2].changes[0].completed)
            XCTAssertEqual(state.position(1)?.completed, !completed)
            try FileManager.default.removeItem(at: directory)
        }
    }

    func testGuestSelectionAndLegacyReapplyKeepConcreteCompletion() async throws {
        let api = StateServer()
        var state = store(api)
        try state.setProgress(id: 1, position: 0, event: .played)
        try state.setProgress(id: 1, position: 95, event: .checkpoint)
        XCTAssertEqual(state.position(1)?.completed, true)
        state = store(api)
        XCTAssertEqual(state.position(1)?.completed, true)
        try state.setProgress(id: 1, position: 12, event: .replay)
        try state.setProgress(id: 1, position: 20, event: .checkpoint)
        try await state.activate(accountID: "a")
        let selected = try XCTUnwrap(state.guestPositions.first)
        XCTAssertFalse(selected.completed)
        api.completed = true
        api.progressRevision = 1
        try state.reapplyGuest(selected)
        await state.flush()
        XCTAssertEqual(api.progressBatches[0].changes[0].completed, false)
        XCTAssertEqual(state.position(1)?.completed, false)
        let source = directory.appendingPathComponent("legacy.json")
        let bytes = Data(#"[{"episodeID":1,"position":0,"completed":true}]"#.utf8)
        try DurableStateStore.protectedWrite(bytes, source)
        try state.importLegacyProgress(source)
        try state.reapplyLegacy(try XCTUnwrap(state.legacyProgress.first))
        await state.flush()
        XCTAssertEqual(api.progressBatches[1].changes[0].completed, true)
        XCTAssertEqual(try Data(contentsOf: source), bytes)
    }

    func testCompletionCodecRequiresNullableRequestKeyAndConcreteSnapshotValue() throws {
        let decoder = JSONDecoder()
        let change = try decoder.decode(StateProgressChange.self, from: Data(#"{"episodeId":"1","positionSeconds":3,"completed":null}"#.utf8))
        XCTAssertNil(change.completed)
        let encoded = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(change)) as? [String: Any])
        XCTAssertTrue(encoded.keys.contains("completed"))
        XCTAssertTrue(encoded["completed"] is NSNull)
        for field in ["", #", "completed":"false""#, #", "completed":0"#, #", "completed":{}"#] {
            let bytes = Data((#"{"episodeId":"1","positionSeconds":3"# + field + "}").utf8)
            XCTAssertThrowsError(try decoder.decode(StateProgressChange.self, from: bytes))
        }
        for field in ["", #", "completed":null"#, #", "completed":"false""#] {
            let bytes = Data((#"{"positionSeconds":3,"revision":"1","updatedAtMs":null"# + field + "}").utf8)
            XCTAssertThrowsError(try decoder.decode(StateProgress.self, from: bytes))
        }
        let localNull = Data(#"{"episodeId":"1","positionSeconds":3,"completed":null}"#.utf8)
        XCTAssertThrowsError(try decoder.decode(LocalProgress.self, from: localNull))
        for completed in [false, true] {
            let boolean = StateProgressChange(episodeId: try StateID("1"), positionSeconds: 3, completed: completed)
            XCTAssertEqual(try decoder.decode(StateProgressChange.self, from: JSONEncoder().encode(boolean)), boolean)
        }
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
        XCTAssertNil(api.progressBatches[0].changes[0].completed)
        XCTAssertEqual(api.progressBatches[1].changes[0].completed, false)
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

    private func savedAccount() throws -> [String: Any] {
        let data = try Data(contentsOf: directory.appendingPathComponent("durable-state-v1.json"))
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        return try XCTUnwrap((root["accounts"] as? [String: [String: Any]])?["a"])
    }

    private func blockSavedStreams() throws {
        let url = directory.appendingPathComponent("durable-state-v1.json")
        var root = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        var accounts = try XCTUnwrap(root["accounts"] as? [String: [String: Any]])
        var account = try XCTUnwrap(accounts["a"])
        for name in ["progress", "follows"] {
            var stream = try XCTUnwrap(account[name] as? [String: Any])
            stream["blocked"] = "protocol_error"
            account[name] = stream
        }
        accounts["a"] = account
        root["accounts"] = accounts
        try DurableStateStore.protectedWrite(JSONSerialization.data(withJSONObject: root), url)
    }

    func testIdleBlockedGenerationRecoversBothStreamsAtomicallyAndSurvivesRestart() async throws {
        let api = StateServer()
        api.progressRevision = 352
        api.followRevision = 25
        api.members = Set(1...14)
        var state = store(api)
        try await state.activate(accountID: "a")
        await state.flush()
        try await state.refreshProgress(ids: [1, 2])
        try state.stageImport(["https://example.invalid/pending"])
        let now = Date()
        try state.deferImport(state.pendingImportFeeds, seconds: 60, now: now)
        let before = try savedAccount()
        try blockSavedStreams()
        state = store(api)
        try await state.activate(accountID: "a")
        XCTAssertTrue(state.blocked)
        api.generation = "27adbd84-d0e4-4e2d-ad9f-b084efee3211"
        api.progressRevision = 1
        api.followRevision = 1
        api.members = Set(2...15)
        await state.flush()
        XCTAssertEqual(state.scope?.generation, api.generation)
        XCTAssertFalse(state.blocked)
        XCTAssertNil(state.error)
        XCTAssertEqual(state.followedIDs, api.members)
        XCTAssertNil(state.position(1))
        XCTAssertFalse(state.importReady("https://example.invalid/pending", now: now))
        XCTAssertTrue(api.progressBatches.isEmpty)
        XCTAssertTrue(api.followBatches.isEmpty)
        let after = try savedAccount()
        for name in ["progress", "follows"] {
            XCTAssertNotEqual((before[name] as? NSDictionary)?["clientID"] as? String, (after[name] as? NSDictionary)?["clientID"] as? String)
        }
        state = store(api)
        try await state.activate(accountID: "a")
        XCTAssertEqual(state.scope?.generation, api.generation)
        XCTAssertEqual(state.followedIDs, api.members)
        XCTAssertFalse(state.blocked)
        XCTAssertEqual(state.pendingImportFeeds, ["https://example.invalid/pending"])
    }

    func testSameGenerationProbeCannotClearAProtocolBlock() async throws {
        let api = StateServer()
        var state = store(api)
        try await state.activate(accountID: "a")
        await state.flush()
        try blockSavedStreams()
        state = store(api)
        try await state.activate(accountID: "a")
        let before = try savedAccount()
        await state.flush()
        XCTAssertEqual(try savedAccount() as NSDictionary, before as NSDictionary)
        XCTAssertTrue(state.blocked)
        XCTAssertTrue(api.progressBatches.isEmpty)
        XCTAssertTrue(api.followBatches.isEmpty)
    }

    func testGenerationChangePreservesQueuedAndFrozenWorkInEitherStream() async throws {
        for resource in ["progress", "follows"] {
            for frozen in [false, true] {
                directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                let api = StateServer()
                var state = store(api)
                try await state.activate(accountID: "a")
                await state.flush()
                if resource == "progress" {
                    try state.setProgress(id: 1, position: 42, event: .checkpoint)
                    api.loseAck = frozen
                } else {
                    try state.setFollow(Podcast(id: 1, feed: "fixture", title: "Fixture"), followed: true)
                    api.loseFollowAck = frozen
                }
                if frozen { await state.flush() }
                try blockSavedStreams()
                let before = try savedAccount()
                let writes = api.progressBatches.count + api.followBatches.count
                api.generation = "27adbd84-d0e4-4e2d-ad9f-b084efee3211"
                state = store(api)
                try await state.activate(accountID: "a")
                await state.flush()
                XCTAssertEqual(try savedAccount() as NSDictionary, before as NSDictionary)
                XCTAssertEqual(api.progressBatches.count + api.followBatches.count, writes)
                XCTAssertTrue(state.pending)
                XCTAssertTrue(state.blocked)
                try FileManager.default.removeItem(at: directory)
            }
        }
    }

    func testMalformedOrWrongAccountSnapshotsCannotResetIdleState() async throws {
        for failure in ["account", "generation", "progress", "follows", "mixed-generation"] {
            directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            let api = StateServer()
            api.members = [1]
            api.followRevision = 1
            var state = store(api)
            try await state.activate(accountID: "a")
            await state.flush()
            try blockSavedStreams()
            let before = try savedAccount()
            api.generation = "27adbd84-d0e4-4e2d-ad9f-b084efee3211"
            if failure == "account" { api.progressTransform = { snapshot in var next = snapshot; next.accountId = "b"; return next } }
            if failure == "generation" { api.progressTransform = { snapshot in var next = snapshot; next.generation = "invalid"; return next } }
            if failure == "progress" {
                api.progressTransform = { snapshot in
                    var next = snapshot
                    next.items = try JSONDecoder().decode([StateProgressItem].self, from: Data(#"[{"episodeId":"1","progress":{"positionSeconds":2,"completed":false,"revision":"2","updatedAtMs":null}}]"#.utf8))
                    return next
                }
            }
            if failure == "follows" { api.followTransform = { snapshot in var next = snapshot; next.items += snapshot.items; return next } }
            if failure == "mixed-generation" { api.followTransform = { snapshot in var next = snapshot; next.generation = "37adbd84-d0e4-4e2d-ad9f-b084efee3211"; return next } }
            state = store(api)
            try await state.activate(accountID: "a")
            await state.flush()
            XCTAssertEqual(try savedAccount() as NSDictionary, before as NSDictionary, failure)
            XCTAssertTrue(state.blocked)
            XCTAssertTrue(api.progressBatches.isEmpty)
            XCTAssertTrue(api.followBatches.isEmpty)
            try FileManager.default.removeItem(at: directory)
        }
    }

    func testNewLocalWorkDuringRecoveryPreventsReset() async throws {
        let api = StateServer()
        let state = store(api)
        try await state.activate(accountID: "a")
        await state.flush()
        let oldScope = state.scope
        api.generation = "27adbd84-d0e4-4e2d-ad9f-b084efee3211"
        api.beforeFollowRead = {
            api.beforeFollowRead = nil
            try! state.setProgress(id: 1, position: 42, event: .checkpoint)
        }
        await state.flush()
        XCTAssertEqual(state.scope, oldScope)
        XCTAssertEqual(state.position(1)?.positionSeconds, 42)
        XCTAssertTrue(state.pending)
        XCTAssertTrue(api.progressBatches.isEmpty)
    }

    func testAccountSwitchDuringRecoveryCannotInstallThePreviousAccountsSnapshot() async throws {
        let api = StateServer()
        let state = store(api)
        try await state.activate(accountID: "a")
        await state.flush()
        let before = try savedAccount()
        api.generation = "27adbd84-d0e4-4e2d-ad9f-b084efee3211"
        api.beforeFollowRead = {
            api.beforeFollowRead = nil
            state.selectAccount("b")
        }
        await state.flush()
        XCTAssertEqual(try savedAccount() as NSDictionary, before as NSDictionary)
        XCTAssertEqual(state.accountID, "b")
        XCTAssertNil(state.scope)
    }

    func testRecentProgressProbeCannotRetireAnAcknowledgedFlight() async throws {
        let api = StateServer()
        var state = store(api)
        try await state.activate(accountID: "a")
        try state.setProgress(id: 1, position: 42, event: .checkpoint)
        api.beforeProgressRead = { ids in
            if ids != nil { throw URLError(.networkConnectionLost) }
        }
        await state.flush()
        XCTAssertTrue(state.pending)
        XCTAssertNotNil((try savedAccount()["progress"] as? NSDictionary)?["acknowledgement"])
        state = store(api)
        try await state.activate(accountID: "a")
        api.beforeProgressRead = { ids in
            if ids != nil { XCTAssertTrue(state.pending) }
        }
        await state.flush()
        XCTAssertFalse(state.pending)
        XCTAssertEqual(api.progressBatches.count, 1)
        XCTAssertEqual(state.position(1)?.positionSeconds, 42)
    }

    func testExplicitRecoveryUsesCurrentServerStateWithoutReplayingTheOldFlight() async throws {
        let api = StateServer()
        var state = store(api)
        try await state.activate(accountID: "a")
        try state.setProgress(id: 1, position: 30, event: .checkpoint)
        api.loseAck = true
        await state.flush()
        api.generation = "27adbd84-d0e4-4e2d-ad9f-b084efee3211"
        api.position = 66
        api.progressRevision = 2
        api.recentIDs = [2]
        api.members = Set(1...14)
        api.followRevision = 25
        state = store(api)
        try await state.activate(accountID: "a")
        await state.flush()
        XCTAssertTrue(state.canUseSyncedState)
        XCTAssertEqual(state.position(1)?.positionSeconds, 30)
        XCTAssertTrue(state.pending)
        try await state.useSyncedState()
        XCTAssertFalse(state.canUseSyncedState)
        XCTAssertFalse(state.blocked)
        XCTAssertFalse(state.pending)
        XCTAssertEqual(state.position(1)?.positionSeconds, 66)
        XCTAssertEqual(state.followedIDs, api.members)
        XCTAssertEqual(api.progressBatches.count, 1)
        XCTAssertTrue(api.followBatches.isEmpty)
        state = store(api)
        try await state.activate(accountID: "a")
        XCTAssertEqual(state.position(1)?.positionSeconds, 66)
        XCTAssertEqual(state.followedIDs, api.members)
        XCTAssertFalse(state.pending)
        await state.flush()
        XCTAssertFalse(state.blocked)
        XCTAssertEqual(api.progressBatches.count, 1)
    }

    func testExplicitRecoveryRequiresValidatedNewGeneration() async throws {
        let api = StateServer()
        var state = store(api)
        try await state.activate(accountID: "a")
        await state.flush()
        try blockSavedStreams()
        state = store(api)
        try await state.activate(accountID: "a")
        await state.flush()
        XCTAssertFalse(state.canUseSyncedState)
        do { try await state.useSyncedState(); XCTFail("Same-generation protocol blocks cannot be reset") } catch {}
        XCTAssertTrue(state.blocked)
    }

    func testExplicitRecoveryRetainsOriginalStateWhenStorageFails() async throws {
        let api = StateServer()
        var deny = false
        let state = store(api, save: { data, url in
            if deny { throw CocoaError(.fileWriteNoPermission) }
            try DurableStateStore.protectedWrite(data, url)
        })
        try await state.activate(accountID: "a")
        await state.flush()
        try state.setProgress(id: 1, position: 30, event: .checkpoint)
        api.generation = "27adbd84-d0e4-4e2d-ad9f-b084efee3211"
        await state.flush()
        let before = try savedAccount()
        deny = true
        do { try await state.useSyncedState(); XCTFail("Failed storage must not replace pending work") } catch {}
        XCTAssertEqual(try savedAccount() as NSDictionary, before as NSDictionary)
        XCTAssertEqual(state.position(1)?.positionSeconds, 30)
        XCTAssertTrue(state.pending)
        XCTAssertTrue(state.canUseSyncedState)
    }

    func testExplicitRecoveryCannotConsumeChangesMadeWhileReadingServerState() async throws {
        let api = StateServer()
        let state = store(api)
        try await state.activate(accountID: "a")
        await state.flush()
        try state.setProgress(id: 1, position: 30, event: .checkpoint)
        let oldScope = state.scope
        api.generation = "27adbd84-d0e4-4e2d-ad9f-b084efee3211"
        await state.flush()
        api.beforeFollowRead = {
            api.beforeFollowRead = nil
            try! state.setProgress(id: 1, position: 31, event: .checkpoint)
        }
        do { try await state.useSyncedState(); XCTFail("A newer position needs a new recovery decision") } catch {}
        XCTAssertEqual(state.position(1)?.positionSeconds, 31)
        XCTAssertEqual(state.scope, oldScope)
        XCTAssertTrue(state.pending)
        XCTAssertTrue(api.progressBatches.isEmpty)
    }

    func testLateFollowSnapshotCannotBlockARecoveredGeneration() async throws {
        let api = StateServer()
        let state = store(api)
        try await state.activate(accountID: "a")
        await state.flush()
        let oldGeneration = api.generation
        let started = expectation(description: "Old follow snapshot delayed")
        var release: CheckedContinuation<Void, Never>?
        api.afterFollowRead = { snapshot in
            if snapshot.generation == oldGeneration {
                started.fulfill()
                await withCheckedContinuation { release = $0 }
            }
            return snapshot
        }
        let oldFlush = Task { await state.flush() }
        await fulfillment(of: [started], timeout: 2)
        api.generation = "27adbd84-d0e4-4e2d-ad9f-b084efee3211"
        try await state.refreshProgress(ids: [1])
        XCTAssertEqual(state.scope?.generation, api.generation)
        release?.resume()
        await oldFlush.value
        XCTAssertFalse(state.blocked)
        XCTAssertNil(state.error)
        XCTAssertTrue(api.progressBatches.isEmpty)
        XCTAssertTrue(api.followBatches.isEmpty)
    }

    func testExplicitRecoveryChecksPlaybackActivityBeforeCommitting() async throws {
        let api = StateServer()
        let state = store(api)
        try await state.activate(accountID: "a")
        await state.flush()
        try state.setProgress(id: 1, position: 30, event: .checkpoint)
        api.generation = "27adbd84-d0e4-4e2d-ad9f-b084efee3211"
        await state.flush()
        let before = try savedAccount()
        var current = true
        var restored = false
        api.beforeFollowRead = { current = false }
        do {
            try await state.useSyncedState(isCurrent: { current }, didRecover: { restored = true })
            XCTFail("Playback changes must cancel recovery before commit")
        } catch {}
        XCTAssertEqual(try savedAccount() as NSDictionary, before as NSDictionary)
        XCTAssertFalse(restored)
        XCTAssertTrue(state.pending)
    }

    func testExplicitRecoveryRestoresRequestedPlaybackAlongsideTheDurableCommit() async throws {
        let api = StateServer()
        let state = store(api)
        try await state.activate(accountID: "a")
        await state.flush()
        try state.setProgress(id: 1, position: 30, event: .checkpoint)
        api.generation = "27adbd84-d0e4-4e2d-ad9f-b084efee3211"
        api.recentIDs = [2]
        api.position = 66
        api.progressRevision = 1
        await state.flush()
        var restored: Int?
        try await state.useSyncedState(episodeIDs: [3], didRecover: {
            XCTAssertFalse(state.pending)
            XCTAssertFalse(state.blocked)
            restored = state.position(3)?.positionSeconds
        })
        XCTAssertEqual(restored, 66)
        XCTAssertTrue(api.progressBatches.isEmpty)
    }

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
    var recentIDs: [Int] = []
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
    var beforeProgressRead: (([Int]?) throws -> Void)?
    var beforeFollowRead: (() -> Void)?
    var afterFollowRead: ((StateSnapshot<StateFollowItem>) async throws -> StateSnapshot<StateFollowItem>)?
    var progressTransform: ((StateSnapshot<StateProgressItem>) throws -> StateSnapshot<StateProgressItem>)?
    var followTransform: ((StateSnapshot<StateFollowItem>) throws -> StateSnapshot<StateFollowItem>)?
    func sessionUser() async throws -> User? {
        if let sessionStatus { throw APIError(statusCode: sessionStatus, message: "Synthetic session failure") }
        return User(id: user, email: "synthetic@example.invalid")
    }
    func progressState(ids: [Int]?) async throws -> StateSnapshot<StateProgressItem> {
        try beforeProgressRead?(ids)
        if let readStatus { throw APIError(statusCode: readStatus, message: "Synthetic snapshot failure") }
        let items = try (ids ?? recentIDs).map { id in
            let progress: StateProgress? = progressRevision == 0 ? nil : StateProgress(positionSeconds: position, completed: completed, revision: try StateID(String(progressRevision)), updatedAtMs: try JSONDecoder().decode(StateTimestamp.self, from: Data("null".utf8)))
            return try JSONDecoder().decode(StateProgressItem.self, from: JSONEncoder().encode(Item(episodeId: StateID(String(id)), progress: progress)))
        }
        let snapshot = StateSnapshot(protocol: 1, accountId: user, generation: generation, revision: try StateRevision(String(stale ? 0 : progressRevision)), items: items)
        return try progressTransform?(snapshot) ?? snapshot
    }
    private struct Item: Encodable { var episodeId: StateID; var progress: StateProgress?; func encode(to encoder: Encoder) throws { var c = encoder.container(keyedBy: Keys.self); try c.encode(episodeId, forKey: .episodeId); try c.encode(progress, forKey: .progress) }; enum Keys: String, CodingKey { case episodeId, progress } }
    func followState() async throws -> StateSnapshot<StateFollowItem> {
        beforeFollowRead?()
        let snapshot = StateSnapshot(protocol: 1, accountId: user, generation: generation, revision: try StateRevision(String(followRevision)), items: try members.sorted().map { StateFollowItem(podcastId: try StateID(String($0)), revision: try StateID(String(max(1, followRevision))), followedAtMs: try JSONDecoder().decode(StateTimestamp.self, from: Data("null".utf8)), availability: .available) })
        let transformed = try followTransform?(snapshot) ?? snapshot
        if let afterFollowRead { return try await afterFollowRead(transformed) }
        return transformed
    }
    func changeProgress(_ batch: StateBatch<StateProgressChange>) async throws -> StateAcknowledgement<StateProgressResult> {
        progressBatches.append(batch)
        beforeProgress?()
        if let status { throw APIError(statusCode: status, message: "Synthetic failure") }
        if batch.generation != generation { throw APIError(statusCode: 409, message: "Recovery required", code: "recovery_required") }
        let key = batch.clientId + ":" + batch.sequence.value
        if let ack = progressAcks[key] { return ack }
        for change in batch.changes { position = change.positionSeconds; completed = change.completed ?? completed; progressRevision += 1 }
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
