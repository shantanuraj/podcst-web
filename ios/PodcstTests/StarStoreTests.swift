import XCTest
@testable import Podcst

@MainActor
final class StarStoreTests: XCTestCase {
    private var directory: URL!

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func testSharedOutboxTransitions() throws {
        struct Vectors: Decodable {
            struct Scenario: Decodable {
                struct Step: Decodable {
                    var op: String
                    var episodeId: Int?
                    var accountId: String?
                    var ids: [Int]
                    var pending: Bool
                }
                var name: String
                var steps: [Step]
            }
            var scenarios: [Scenario]
        }
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("contracts/fixtures/sync/star-outbox.json")
        let vectors = try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
        for scenario in vectors.scenarios {
            let folder = directory.appendingPathComponent(UUID().uuidString)
            var stars = StarStore(directory: folder)
            for step in scenario.steps {
                switch step.op {
                case "restart": stars = StarStore(accountID: step.accountId, directory: folder)
                case "account": try stars.switchAccount(to: step.accountId)
                case "add": XCTAssertTrue(stars.star(starEpisode(try XCTUnwrap(step.episodeId))))
                case "remove": XCTAssertTrue(stars.remove(id: try XCTUnwrap(step.episodeId)))
                default: XCTFail("Unknown vector operation")
                }
                XCTAssertEqual(stars.stars.map(\.id), step.ids, scenario.name)
                XCTAssertEqual(stars.pending, step.pending, scenario.name)
            }
        }
    }

    func testCanonicalStarsPersistOrderAndRejectMissingIDs() {
        var clock = Date(timeIntervalSince1970: 1_000)
        let stars = StarStore(directory: directory, now: { clock })
        let first = starEpisode(1)
        let second = starEpisode(2)
        XCTAssertTrue(stars.star(first))
        clock += 60
        XCTAssertTrue(stars.star(second))
        var renamed = first
        renamed.title = "Renamed"
        renamed.feed = "https://changed.example.invalid/rss"
        stars.star(renamed)
        XCTAssertEqual(stars.episodes, [second, renamed])
        XCTAssertEqual(stars.stars.last?.starredAt, Date(timeIntervalSince1970: 1_000))
        XCTAssertEqual(StarStore(directory: directory).stars, stars.stars)
        var invalid = first
        invalid.id = nil
        XCTAssertFalse(stars.star(invalid))
        XCTAssertFalse(stars.contains(invalid))
        XCTAssertTrue(stars.toggle(renamed))
        XCTAssertEqual(StarStore(directory: directory).episodes, [second])
    }

    func testGuestMergeIsConsumedOnceAndPendingWorkSurvivesAccountChanges() throws {
        let stars = StarStore(directory: directory)
        stars.star(starEpisode(1))
        try stars.switchAccount(to: "owner")
        XCTAssertEqual(stars.episodes.map(\.id), [1])
        XCTAssertTrue(stars.pending)
        stars.unstar(starEpisode(1))
        stars.star(starEpisode(2))
        try stars.switchAccount(to: nil)
        XCTAssertTrue(stars.stars.isEmpty)
        stars.star(starEpisode(3))
        try stars.switchAccount(to: "other")
        XCTAssertEqual(stars.stars.map(\.id), [3])
        try stars.switchAccount(to: "owner")
        XCTAssertEqual(stars.stars.map(\.id), [2])
        XCTAssertNil(stars.stars.first?.episode)
        XCTAssertTrue(stars.pending)
        let persisted = StarStore(accountID: "owner", directory: directory)
        XCTAssertEqual(persisted.stars.map(\.id), [2])
        XCTAssertFalse(try String(contentsOf: directory.appendingPathComponent("lists.json"), encoding: .utf8).contains("Episode 2"))
    }

    func testFailedPersistenceDoesNotReportSavedOrConsumeGuestWork() throws {
        var failing = false
        let stars = StarStore(directory: directory, save: { data, url in
            if failing { throw URLError(.cannotWriteToFile) }
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
        })
        stars.star(starEpisode(1))
        failing = true
        XCTAssertFalse(stars.star(starEpisode(2)))
        XCTAssertEqual(stars.stars.map(\.id), [1])
        XCTAssertThrowsError(try stars.switchAccount(to: "owner"))
        XCTAssertEqual(StarStore(directory: directory).stars.map(\.id), [1])
        XCTAssertTrue(StarStore(accountID: "owner", directory: directory).stars.isEmpty)
        failing = false
        try stars.switchAccount(to: "owner")
        XCTAssertEqual(stars.stars.map(\.id), [1])
        XCTAssertTrue(StarStore(directory: directory).stars.isEmpty)
    }

    func testLostAcknowledgementReplaysExactlyWithoutRestoringRemoteRemoval() async throws {
        let offline = StarStore(accountID: "owner", directory: directory)
        offline.star(starEpisode(1))
        let api = StarServer()
        api.loseReply = true
        let first = StarStore(accountID: "owner", directory: directory, api: api)
        await first.refresh()
        XCTAssertTrue(first.pending)
        XCTAssertEqual(api.sent.count, 1)
        api.members.items = []
        api.members.revision = "2"
        let restored = StarStore(accountID: "owner", directory: directory, api: api)
        await restored.refresh()
        XCTAssertEqual(api.sent.count, 2)
        XCTAssertEqual(api.sent[0], api.sent[1])
        XCTAssertTrue(restored.stars.isEmpty)
        XCTAssertFalse(restored.pending)
    }

    func testAcknowledgementSurvivesSnapshotFailureAndRestart() async {
        let offline = StarStore(accountID: "owner", directory: directory)
        offline.star(starEpisode(1))
        let api = StarServer()
        api.failSnapshot = true
        let first = StarStore(accountID: "owner", directory: directory, api: api)
        await first.refresh()
        XCTAssertEqual(first.stars.map(\.id), [1])
        XCTAssertTrue(first.pending)
        api.failSnapshot = false
        let restored = StarStore(accountID: "owner", directory: directory, api: api)
        await restored.refresh()
        XCTAssertEqual(api.sent.count, 1)
        XCTAssertFalse(restored.pending)
        XCTAssertEqual(restored.episodes.map(\.id), [1])
    }

    func testProtocolConflictStopsTheStreamAcrossRelaunch() async {
        StarStore(accountID: "owner", directory: directory).star(starEpisode(1))
        let api = StarServer()
        api.status = 409
        let first = StarStore(accountID: "owner", directory: directory, api: api)
        await first.refresh()
        XCTAssertTrue(first.pending)
        XCTAssertNotNil(first.error)
        let restored = StarStore(accountID: "owner", directory: directory, api: api)
        await restored.refresh()
        XCTAssertEqual(api.sent.count, 1)
        XCTAssertTrue(restored.pending)
        XCTAssertNotNil(restored.error)
    }

    func testTerminalFailuresDoNotKeepOptimisticSuccess() async {
        StarStore(accountID: "owner", directory: directory).star(starEpisode(1))
        let api = StarServer()
        api.notFound = true
        api.failSnapshot = true
        let stars = StarStore(accountID: "owner", directory: directory, api: api)
        await stars.refresh()
        XCTAssertTrue(stars.stars.isEmpty)
        XCTAssertNotNil(stars.error)
        XCTAssertTrue(stars.pending)
        api.failSnapshot = false
        let restored = StarStore(accountID: "owner", directory: directory, api: api)
        await restored.refresh()
        XCTAssertTrue(restored.stars.isEmpty)
        XCTAssertFalse(restored.pending)
        XCTAssertNotNil(restored.error)
    }

    func testUnavailableMembershipsInvalidateMetadataAtTheSameRevision() async {
        StarStore(accountID: "owner", directory: directory).star(starEpisode(1))
        let api = StarServer()
        let stars = StarStore(accountID: "owner", directory: directory, api: api)
        await stars.refresh()
        XCTAssertEqual(stars.episodes.map(\.id), [1])
        api.members.items[0].availability = .unavailable
        await stars.refresh()
        XCTAssertEqual(stars.stars.map(\.id), [1])
        XCTAssertTrue(stars.episodes.isEmpty)
        XCTAssertTrue(StarStore(accountID: "owner", directory: directory).episodes.isEmpty)
    }

    func testStaleSnapshotsCannotRetireAcknowledgedWork() async {
        StarStore(accountID: "owner", directory: directory).star(starEpisode(1))
        let api = StarServer()
        api.snapshotRevision = "0"
        let stars = StarStore(accountID: "owner", directory: directory, api: api)
        await stars.refresh()
        XCTAssertTrue(stars.pending)
        XCTAssertEqual(stars.stars.map(\.id), [1])
        api.snapshotRevision = nil
        let restored = StarStore(accountID: "owner", directory: directory, api: api)
        await restored.refresh()
        XCTAssertFalse(restored.pending)
        XCTAssertEqual(api.sent.count, 1)
    }

    func testRapidToggleIsQueuedBehindFrozenWork() async {
        StarStore(accountID: "owner", directory: directory).star(starEpisode(1))
        let api = StarServer()
        let arrived = expectation(description: "Frozen batch sent")
        var release: CheckedContinuation<Void, Never>?
        api.beforeChange = {
            arrived.fulfill()
            await withCheckedContinuation { release = $0 }
        }
        let stars = StarStore(accountID: "owner", directory: directory, api: api)
        let sending = Task { await stars.refresh() }
        await fulfillment(of: [arrived], timeout: 2)
        XCTAssertTrue(stars.unstar(starEpisode(1)))
        api.beforeChange = nil
        release?.resume()
        await sending.value
        XCTAssertEqual(api.sent.map(\.sequence), ["1", "2"])
        XCTAssertEqual(api.sent[0].changes, [ListChange(op: .add, episodeId: 1)])
        XCTAssertEqual(api.sent[1].changes, [ListChange(op: .remove, episodeId: 1)])
        XCTAssertTrue(stars.stars.isEmpty)
    }

    func testLateSnapshotCannotEnterAnotherAccount() async throws {
        let api = StarServer()
        api.members.items = [ListMembership(episodeId: 1, addedAt: 1, availability: .available)]
        let arrived = expectation(description: "Snapshot requested")
        var release: CheckedContinuation<Void, Never>?
        api.beforeSnapshot = {
            arrived.fulfill()
            await withCheckedContinuation { release = $0 }
        }
        let stars = StarStore(accountID: "owner", directory: directory, api: api)
        let loading = Task { await stars.refresh() }
        await fulfillment(of: [arrived], timeout: 2)
        try stars.switchAccount(to: "other")
        release?.resume()
        await loading.value
        XCTAssertEqual(stars.accountID, "other")
        XCTAssertTrue(stars.stars.isEmpty)
        XCTAssertTrue(api.sent.isEmpty)
    }

    func testUnconfirmedAccountCannotClaimGuestStarsOrSendAccountWork() async throws {
        StarStore(directory: directory).star(starEpisode(1))
        let api = StarServer()
        api.user = "other"
        let stars = StarStore(accountID: "owner", directory: directory, api: api)
        await stars.refresh()
        XCTAssertTrue(api.sent.isEmpty)
        XCTAssertFalse(stars.ready)
        XCTAssertEqual(StarStore(directory: directory).stars.map(\.id), [1])
    }

    func testAuthenticationMustFinishBeforeTheNewScopeIsVisibleOrSends() async throws {
        let api = StarServer()
        let stars = StarStore(directory: directory, api: api)
        stars.star(starEpisode(1))
        try stars.switchAccount(to: "owner", activate: false)
        await stars.refresh()
        XCTAssertFalse(stars.ready)
        XCTAssertTrue(stars.stars.isEmpty)
        XCTAssertTrue(api.sent.isEmpty)
        stars.resume(accountID: "other")
        await stars.refresh()
        XCTAssertTrue(api.sent.isEmpty)
        stars.resume(accountID: "owner")
        await stars.refresh()
        XCTAssertTrue(stars.ready)
        XCTAssertEqual(stars.stars.map(\.id), [1])
    }

    func testExpiredSessionHidesMetadataButKeepsTheExactAccountBatch() async {
        StarStore(accountID: "owner", directory: directory).star(starEpisode(1))
        let api = StarServer()
        api.status = 401
        let stars = StarStore(accountID: "owner", directory: directory, api: api)
        await stars.refresh()
        XCTAssertFalse(stars.ready)
        XCTAssertTrue(stars.stars.isEmpty)
        XCTAssertTrue(stars.pending)
        XCTAssertTrue(StarStore(directory: directory).stars.isEmpty)
        api.status = nil
        let restored = StarStore(accountID: "owner", directory: directory, api: api)
        await restored.refresh()
        XCTAssertEqual(api.sent.count, 2)
        XCTAssertEqual(api.sent[0], api.sent[1])
        XCTAssertFalse(restored.pending)
    }

    func testCorruptOutboxIsNotSilentlyReset() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("lists.json")
        try Data("corrupt".utf8).write(to: url)
        let stars = StarStore(accountID: "owner", directory: directory)
        XCTAssertFalse(stars.star(starEpisode(1)))
        XCTAssertFalse(stars.ready)
        XCTAssertEqual(try String(contentsOf: url, encoding: .utf8), "corrupt")
    }
}

private func starEpisode(_ id: Int) -> Episode {
    Episode(id: id, guid: "same-guid", feed: "https://example.invalid/rss", title: "Episode \(id)", file: EpisodeFile(url: "https://example.invalid/audio.mp3"))
}

@MainActor
private final class StarServer: StarAPI {
    let id = "0c339753-cb50-477c-843e-e641b414a060"
    var user = "owner"
    var members = ListSnapshot(listId: "0c339753-cb50-477c-843e-e641b414a060", revision: "0", items: [])
    var sent: [ListBatch] = []
    var accepted: [String: ListAcknowledgement] = [:]
    var loseReply = false
    var failSnapshot = false
    var snapshotRevision: String?
    var status: Int?
    var notFound = false
    var beforeChange: (() async -> Void)?
    var beforeSnapshot: (() async -> Void)?

    func sessionUser() async throws -> User? { User(id: user, email: "\(user)@example.invalid") }
    func lists() async throws -> [AccountEpisodeList] { [AccountEpisodeList(id: id, kind: "starred", revision: members.revision, itemCount: members.items.count)] }
    func listMembership(id: String) async throws -> ListSnapshot {
        await beforeSnapshot?()
        if failSnapshot { throw URLError(.notConnectedToInternet) }
        var snapshot = members
        snapshot.revision = snapshotRevision ?? members.revision
        return snapshot
    }
    func listEpisodes(id: String, cursor: String?) async throws -> ListEpisodePage {
        ListEpisodePage(listId: id, revision: members.revision, items: members.items.map { ListEpisodeItem(membership: $0, episode: $0.availability == .available ? starEpisode($0.episodeId) : nil) }, nextCursor: nil)
    }
    func changeList(id: String, batch: ListBatch) async throws -> ListAcknowledgement {
        sent.append(batch)
        await beforeChange?()
        if let status { throw APIError(statusCode: status, message: "Request rejected") }
        let key = "\(batch.clientId):\(batch.sequence)"
        if let result = accepted[key] { return result }
        for change in batch.changes {
            if change.op == .remove { members.items.removeAll { $0.episodeId == change.episodeId } }
            else if !notFound, !members.items.contains(where: { $0.episodeId == change.episodeId }) { members.items.append(ListMembership(episodeId: change.episodeId, addedAt: Double(change.episodeId), availability: .available)) }
        }
        members.revision = String((Int(members.revision) ?? 0) + 1)
        let result = ListAcknowledgement(clientId: batch.clientId, sequence: batch.sequence, listId: id, revision: members.revision, results: batch.changes.map { ListChangeResult(episodeId: $0.episodeId, status: notFound ? .notFound : .applied) })
        accepted[key] = result
        if loseReply { loseReply = false; throw URLError(.networkConnectionLost) }
        return result
    }
}
