import Foundation
import XCTest
@testable import Podcst

@MainActor
final class PodcastDetailStoreTests: XCTestCase {
    func testFirstPageIsReadyWithoutReadingOlderPages() async {
        let service = DetailServiceStub()
        let store = PodcastDetailStore()
        await store.load(service.info, api: service)
        XCTAssertEqual(store.episodes.count, 30)
        XCTAssertEqual(store.latest?.id, 1)
        XCTAssertFalse(store.isLoading)
        XCTAssertEqual(service.requests.map(\.cursor), [nil])
        let gate = DetailGate()
        service.readPage = { _, cursor in
            await gate.wait()
            return DetailServiceStub.page(start: 31, count: 30, total: 90, next: 60)
        }
        let more = Task { await store.loadMore(api: service) }
        await gate.entered()
        XCTAssertEqual(store.episodes.count, 30)
        await store.loadMore(api: service)
        XCTAssertEqual(service.requests.count, 2)
        gate.release()
        await more.value
        XCTAssertEqual(store.episodes.count, 60)
    }

    func testMetadataAndEpisodesBecomeVisibleIndependently() async {
        let service = DetailServiceStub()
        let gate = DetailGate()
        service.readPage = { _, _ in await gate.wait(); return DetailServiceStub.page() }
        let store = PodcastDetailStore()
        let loading = Task { await store.load(Podcast(id: 61, feed: "", title: "Chart title"), api: service) }
        await gate.entered()
        await settle { store.podcast?.description == "Full description" }
        XCTAssertEqual(store.podcast?.description, "Full description")
        XCTAssertTrue(store.episodes.isEmpty)
        gate.release()
        await loading.value

        service.readPage = nil
        let metadataGate = DetailGate()
        service.readInfo = { await metadataGate.wait(); return service.info }
        let second = PodcastDetailStore()
        let secondLoad = Task { await second.load(service.info, api: service) }
        await metadataGate.entered()
        await settle { !second.isLoading }
        XCTAssertEqual(second.episodes.count, 30)
        XCTAssertNotNil(second.latest)
        metadataGate.release()
        await secondLoad.value
    }

    func testCachedPageIsImmediateAndSurvivesReadAndRefreshFailure() async {
        let service = DetailServiceStub()
        let cached = DetailServiceStub.page(state: .stale)
        service.podcastPages.store(cached, id: 61, query: PodcastEpisodeQuery())
        let gate = DetailGate()
        service.readPage = { _, _ in await gate.wait(); throw URLError(.notConnectedToInternet) }
        service.readRefresh = { throw APIError(statusCode: 503, message: "Busy") }
        let store = PodcastDetailStore()
        let loading = Task { await store.load(service.info, api: service) }
        await gate.entered()
        XCTAssertEqual(store.episodes, cached.episodes)
        XCTAssertNotNil(store.latest)
        gate.release()
        await loading.value
        XCTAssertEqual(store.episodes, cached.episodes)
        XCTAssertTrue(store.loadFailed)
        XCTAssertEqual(service.podcastPages.page(61, query: PodcastEpisodeQuery())?.episodes, cached.episodes)
    }

    func testSlowRefreshAdmissionDoesNotGatePlayableResults() async {
        let service = DetailServiceStub()
        service.readPage = { _, _ in DetailServiceStub.page(state: .stale) }
        let gate = DetailGate()
        service.readRefresh = { await gate.wait(); throw APIError(statusCode: 503, message: "Busy") }
        let store = PodcastDetailStore()
        let loading = Task { await store.load(service.info, api: service) }
        await gate.entered()
        XCTAssertEqual(store.episodes.count, 30)
        XCTAssertNotNil(store.latest)
        XCTAssertFalse(store.isLoading)
        gate.release()
        await loading.value
        XCTAssertEqual(store.episodes.count, 30)
        XCTAssertTrue(store.updateFailed)
    }

    func testSearchAndOldestOrderReadTheServerAndKeepLatestUnchanged() async {
        let service = DetailServiceStub()
        let store = PodcastDetailStore(wait: { _ in })
        await store.load(service.info, api: service)
        let latest = store.latest
        let query = PodcastEpisodeQuery(search: "archive match", newestFirst: false)
        service.readPage = { requested, cursor in
            XCTAssertEqual(requested, query)
            XCTAssertNil(cursor)
            return DetailServiceStub.page(start: 900, count: 1, total: 1, next: nil)
        }
        await store.load(service.info, api: service, query: query)
        XCTAssertEqual(store.episodes.first?.id, 900)
        XCTAssertEqual(store.latest, latest)
        XCTAssertEqual(service.requests.last?.query, query)
    }

    func testLateQueryAndPaginationResponsesCannotReplaceNewSearch() async {
        let service = DetailServiceStub()
        let store = PodcastDetailStore(wait: { _ in })
        let queryGate = DetailGate()
        service.readPage = { query, _ in
            if query.search == "old" { await queryGate.wait() }
            return DetailServiceStub.page(start: query.search == "old" ? 100 : 200, count: 1, total: 1, next: nil)
        }
        let old = Task { await store.load(service.info, api: service, query: PodcastEpisodeQuery(search: "old")) }
        await queryGate.entered()
        await store.load(service.info, api: service, query: PodcastEpisodeQuery(search: "new"))
        queryGate.release()
        await old.value
        XCTAssertEqual(store.episodes.first?.id, 200)

        service.readPage = { _, _ in DetailServiceStub.page() }
        await store.load(service.info, api: service)
        let pageGate = DetailGate()
        service.readPage = { _, cursor in
            if cursor != nil { await pageGate.wait(); return DetailServiceStub.page(start: 31) }
            return DetailServiceStub.page(start: 500, count: 1, total: 1, next: nil)
        }
        let more = Task { await store.loadMore(api: service) }
        await pageGate.entered()
        await store.load(service.info, api: service, query: PodcastEpisodeQuery(search: "new"))
        pageGate.release()
        await more.value
        XCTAssertEqual(store.episodes.map(\.id), [500])
        XCTAssertFalse(store.isLoadingMore)
    }

    func testPaginationFailureCanRetryAndDuplicateEpisodesAreRemoved() async {
        let service = DetailServiceStub()
        let store = PodcastDetailStore()
        await store.load(service.info, api: service)
        service.readPage = { _, _ in throw URLError(.timedOut) }
        await store.loadMore(api: service)
        XCTAssertEqual(store.episodes.count, 30)
        XCTAssertEqual(store.page?.nextCursor, 30)
        XCTAssertTrue(store.moreFailed)
        service.readPage = { _, cursor in
            XCTAssertEqual(cursor, 30)
            return DetailServiceStub.page(start: 30, count: 31, total: 60, next: nil)
        }
        await store.loadMore(api: service)
        XCTAssertEqual(store.episodes.count, 60)
        XCTAssertEqual(Set(store.episodes.map(\.identity)).count, 60)
        XCTAssertFalse(store.moreFailed)
        XCTAssertFalse(store.hasMore)
    }

    func testCancellationDoesNotAppendAndAllowsRetry() async {
        let service = DetailServiceStub()
        let store = PodcastDetailStore()
        await store.load(service.info, api: service)
        let gate = DetailGate()
        service.readPage = { _, _ in await gate.wait(); return DetailServiceStub.page(start: 31) }
        let more = Task { await store.loadMore(api: service) }
        await gate.entered()
        more.cancel()
        gate.release()
        await more.value
        XCTAssertEqual(store.episodes.count, 30)
        XCTAssertFalse(store.isLoadingMore)
        XCTAssertFalse(store.moreFailed)
    }

    func testPendingReadsPollWithoutRepeatedAdmissionAndRespectWindow() async {
        let service = DetailServiceStub()
        var clock = Date(timeIntervalSince1970: 1000)
        var waits: [TimeInterval] = []
        var reads = 0
        service.readPage = { _, _ in
            reads += 1
            return reads < 3 ? DetailServiceStub.page(count: 0, state: .pending) : DetailServiceStub.page()
        }
        let store = PodcastDetailStore(now: { clock }, wait: { delay in waits.append(delay); clock.addTimeInterval(delay) })
        await store.load(service.info, api: service)
        XCTAssertEqual(waits, [5, 5])
        XCTAssertEqual(store.episodes.count, 30)
        XCTAssertEqual(service.refreshCount, 0)

        service.readPage = { _, _ in DetailServiceStub.page(count: 0, state: .pending) }
        let empty = PodcastDetailStore(now: { clock }, wait: { delay in clock.addTimeInterval(delay) })
        service.podcastPages.clear()
        let start = clock
        await empty.load(service.info, api: service)
        XCTAssertLessThan(clock.timeIntervalSince(start), 120)
        XCTAssertTrue(empty.loadFailed)
        XCTAssertFalse(empty.isRechecking)
    }

    func testAccessDenialEvictsPrivateDataAndOldSessionCannotRepopulate() async {
        let service = DetailServiceStub()
        let store = PodcastDetailStore()
        await store.load(service.info, api: service)
        service.readPage = { _, _ in throw APIError(statusCode: 403, message: "Forbidden") }
        await store.load(service.info, api: service)
        XCTAssertTrue(store.unavailable)
        XCTAssertTrue(store.episodes.isEmpty)
        XCTAssertNil(store.latest)
        XCTAssertNil(service.podcastPages.page(61, query: PodcastEpisodeQuery()))
        XCTAssertNil(service.podcastPages.info(61))

        let gate = DetailGate()
        service.readPage = { _, _ in await gate.wait(); return DetailServiceStub.page() }
        let loading = Task { await store.load(service.info, api: service) }
        await gate.entered()
        service.activityToken = UUID()
        service.podcastPages.clear()
        gate.release()
        await loading.value
        XCTAssertNil(service.podcastPages.page(61, query: PodcastEpisodeQuery()))
    }

    func testChangingQueryBeforeInitialPageCompletesStillLoadsNewest() async {
        let service = DetailServiceStub()
        let store = PodcastDetailStore(wait: { _ in })
        let gate = DetailGate()
        var defaultReads = 0
        service.readPage = { query, _ in
            if query.isDefault {
                defaultReads += 1
                if defaultReads == 1 { await gate.wait() }
                return DetailServiceStub.page()
            }
            return DetailServiceStub.page(start: 700, count: 1, total: 1, next: nil)
        }
        let initial = Task { await store.load(service.info, api: service) }
        await gate.entered()
        initial.cancel()
        await store.load(service.info, api: service, query: PodcastEpisodeQuery(search: "archive", newestFirst: false))
        XCTAssertEqual(store.latest?.id, 1)
        XCTAssertEqual(store.episodes.first?.id, 700)
        gate.release()
        await initial.value
        XCTAssertEqual(store.episodes.first?.id, 700)
    }

    func testRevalidationKeepsLoadedRowsUntilTheirWindowIsRebuilt() async {
        let service = DetailServiceStub()
        service.readPage = { _, cursor in
            DetailServiceStub.page(start: cursor == nil ? 1 : 31, next: cursor == nil ? 30 : 60)
        }
        let store = PodcastDetailStore()
        await store.load(service.info, api: service)
        await store.loadMore(api: service)
        XCTAssertEqual(store.episodes.count, 60)
        let gate = DetailGate()
        service.readPage = { _, cursor in
            if cursor != nil { await gate.wait() }
            return DetailServiceStub.page(start: cursor == nil ? 101 : 131, next: cursor == nil ? 30 : 60)
        }
        let refreshing = Task { await store.load(service.info, api: service) }
        await gate.entered()
        XCTAssertEqual(store.episodes.count, 60)
        XCTAssertEqual(store.episodes.first?.id, 1)
        XCTAssertEqual(store.latest?.id, 101)
        gate.release()
        await refreshing.value
        XCTAssertEqual(store.episodes.count, 60)
        XCTAssertEqual(store.episodes.first?.id, 101)
        XCTAssertEqual(store.page?.nextCursor, 60)
    }

    func testReusedStoreResetsPodcastIdentityAndIgnoresPreviousLoad() async {
        let service = DetailServiceStub()
        let original = service.info
        let gate = DetailGate()
        service.readInfo = { await gate.wait(); return original }
        let store = PodcastDetailStore()
        let first = Task { await store.load(original, api: service) }
        await gate.entered()
        service.info = Podcast(id: 62, feed: "https://example.test/other", title: "Other podcast")
        service.readInfo = nil
        service.readPage = { _, _ in DetailServiceStub.page(start: 500, count: 1, total: 1, next: nil) }
        await store.load(service.info, api: service)
        gate.release()
        await first.value
        XCTAssertEqual(store.podcast?.id, 62)
        XCTAssertEqual(store.latest?.id, 500)
        XCTAssertEqual(store.episodes.first?.id, 500)
    }

    func testInvalidationPurgesLegacyCacheAndPendingRequests() async throws {
        let cache = FeedCache()
        let podcast = Podcast(id: 61, feed: "https://example.test/private", title: "Private", isPrivate: true)
        _ = try await cache.load(.id(61)) { podcast }
        let gate = DetailGate()
        let pending = Task { try await cache.load(.id(61), refreshing: true) { await gate.wait(); return podcast } }
        await gate.entered()
        cache.invalidate(61)
        XCTAssertNil(cache.cached(id: 61, feed: podcast.feed))
        gate.release()
        do { _ = try await pending.value; XCTFail("Invalidated request must not return cached content") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertNil(cache.cached(id: 61, feed: podcast.feed))
    }

    func testFailedSearchNeverShowsRowsFromAnotherQuery() async {
        let service = DetailServiceStub()
        let store = PodcastDetailStore(wait: { _ in })
        await store.load(service.info, api: service)
        service.readPage = { _, _ in throw URLError(.notConnectedToInternet) }
        await store.load(service.info, api: service, query: PodcastEpisodeQuery(search: "uncached search"))
        XCTAssertTrue(store.episodes.isEmpty)
        XCTAssertTrue(store.loadFailed)
        XCTAssertEqual(store.latest?.id, 1)
        XCTAssertNotNil(service.podcastPages.page(61, query: PodcastEpisodeQuery()))
    }

    func testFailedWindowRevalidationKeepsRowsAndRetriesBeforeAdvancingCursor() async {
        let service = DetailServiceStub()
        service.readPage = { _, cursor in DetailServiceStub.page(start: cursor == nil ? 1 : 31, next: cursor == nil ? 30 : 60) }
        let store = PodcastDetailStore()
        await store.load(service.info, api: service)
        await store.loadMore(api: service)
        service.readPage = { _, cursor in
            if cursor != nil { throw URLError(.timedOut) }
            return DetailServiceStub.page(start: 101)
        }
        await store.load(service.info, api: service)
        XCTAssertEqual(store.episodes.count, 60)
        XCTAssertEqual(store.episodes.first?.id, 1)
        XCTAssertTrue(store.loadFailed)
        let requests = service.requests.count
        await store.loadMore(api: service)
        XCTAssertEqual(service.requests.count, requests)
        service.readPage = { _, cursor in DetailServiceStub.page(start: cursor == nil ? 101 : 131, next: cursor == nil ? 30 : 60) }
        await store.load(service.info, api: service)
        XCTAssertEqual(store.episodes.count, 60)
        XCTAssertEqual(store.episodes.first?.id, 101)
        XCTAssertFalse(store.loadFailed)
    }

    func testFailureFromSupersededPageDoesNotPoisonRebasedCursor() async throws {
        let service = DetailServiceStub()
        let store = PodcastDetailStore()
        let refreshGate = DetailGate()
        service.readPage = { _, _ in DetailServiceStub.page(state: .stale) }
        service.readRefresh = {
            await refreshGate.wait()
            return try JSONDecoder().decode(FeedRefreshResponse.self, from: Data(#"{"podcastId":"61","freshness":{"content":"cached","state":"fresh","checkedAtMs":2000,"retryAtMs":null}}"#.utf8))
        }
        let loading = Task { await store.load(service.info, api: service) }
        await refreshGate.entered()
        let gate = DetailGate()
        service.readPage = { _, cursor in
            if cursor != nil { await gate.wait(); throw URLError(.timedOut) }
            return DetailServiceStub.page(start: 101)
        }
        let more = Task { await store.loadMore(api: service) }
        await gate.entered()
        refreshGate.release()
        await loading.value
        gate.release()
        await more.value
        XCTAssertEqual(store.episodes.first?.id, 101)
        XCTAssertFalse(store.moreFailed)
    }

    func testFollowedFirstPageSurvivesRestartWithoutMasqueradingAsFullArchive() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("feeds.json")
        let service = DetailServiceStub()
        let cache = FeedCache(storageURL: url)
        cache.storePage(DetailServiceStub.page(), podcast: service.info)
        cache.markSubscribed([service.info])
        var preview = service.info
        preview.episodes = Array(DetailServiceStub.page().episodes.prefix(2))
        cache.markSubscribed([preview])
        let restored = FeedCache(storageURL: url)
        let snapshot = try XCTUnwrap(restored.cached(id: 61, feed: service.info.feed))
        XCTAssertEqual(snapshot.episodes.count, 30)
        XCTAssertEqual(snapshot.episodeCount, 90)
        var fetches = 0
        do {
            _ = try await restored.load(.id(61)) { fetches += 1; throw URLError(.notConnectedToInternet) }
            XCTFail("A partial page must not satisfy a full-catalogue read")
        } catch { XCTAssertEqual((error as? URLError)?.code, .notConnectedToInternet) }
        XCTAssertEqual(fetches, 1)
        XCTAssertEqual(restored.cached(id: 61, feed: service.info.feed)?.episodes.count, 30)
        restored.invalidate(61)
        XCTAssertNil(FeedCache(storageURL: url).cached(id: 61, feed: service.info.feed))
    }

    func testFirstPageRefreshPreservesPreviouslySavedArchiveAcrossRestart() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("feeds.json")
        let service = DetailServiceStub()
        var archive = service.info
        archive.episodes = DetailServiceStub.page(count: 90, next: nil).episodes
        let cache = FeedCache(storageURL: url)
        _ = try await cache.load(.id(61)) { archive }
        cache.markSubscribed([archive])
        var newest = DetailServiceStub.page()
        newest.episodes.insert(DetailServiceStub.page(start: 1000, count: 1).episodes[0], at: 0)
        newest.episodes.removeLast()
        cache.storePage(newest, podcast: service.info)
        var preview = service.info
        preview.episodes = Array(newest.episodes.prefix(2))
        cache.markSubscribed([preview])
        let restored = FeedCache(storageURL: url)
        let saved = try XCTUnwrap(restored.cached(id: 61, feed: archive.feed))
        XCTAssertEqual(saved.episodes.count, 91)
        XCTAssertTrue(saved.episodes.contains { $0.id == 90 })
        XCTAssertTrue(saved.episodes.contains { $0.id == 1000 })
        var reads = 0
        _ = try await restored.load(.id(61)) { reads += 1; return archive }
        XCTAssertEqual(reads, 1)
        var smallerArchive = service.info
        smallerArchive.episodeCount = 3
        restored.storePage(DetailServiceStub.page(count: 3, total: 3, next: nil), podcast: smallerArchive)
        _ = try await restored.load(.id(61)) { reads += 1; return archive }
        XCTAssertEqual(reads, 2)
        service.saved = saved
        service.readPage = { _, _ in throw URLError(.notConnectedToInternet) }
        let store = PodcastDetailStore()
        await store.load(service.info, api: service)
        XCTAssertEqual(store.episodes.count, 91)
        XCTAssertTrue(store.loadFailed)
    }

    func testAPIPageQueryUsesBoundedServerSearchAndLatestUsesOneEpisode() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DetailPageURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let api = APIClient(baseURL: URL(string: "https://example.test")!, session: session, keychain: DetailCredentials())
        let query = PodcastEpisodeQuery(search: "an old archive episode", newestFirst: false)
        _ = try await api.episodePage(podcastID: 61, query: query, cursor: 60)
        let request = try XCTUnwrap(DetailPageURLProtocol.captured())
        let url = try XCTUnwrap(request.url)
        let items = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        let values = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(url.path, "/api/feed/episodes")
        XCTAssertEqual(values["limit"], "30")
        XCTAssertEqual(values["cursor"], "60")
        XCTAssertEqual(values["sortBy"], "published")
        XCTAssertEqual(values["sortDir"], "asc")
        XCTAssertEqual(values["search"], query.search)
        _ = try await api.latestEpisode(of: Podcast(id: 61, feed: "", title: "Podcast"))
        let latest = try XCTUnwrap(DetailPageURLProtocol.captured()?.url)
        XCTAssertEqual(URLComponents(url: latest, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "limit" }?.value, "1")
        api.podcastPages.store(DetailServiceStub.page(), id: 61, query: PodcastEpisodeQuery())
        api.clearSession()
        XCTAssertNil(api.podcastPages.page(61, query: PodcastEpisodeQuery()))
    }

    private func settle(_ predicate: () -> Bool) async {
        for _ in 0..<1000 {
            if predicate() { return }
            await Task.yield()
        }
        XCTFail("Expected async state transition")
    }
}

@MainActor
private final class DetailGate {
    private var continuation: CheckedContinuation<Void, Never>?
    private var started = false

    func wait() async {
        started = true
        await withCheckedContinuation { continuation = $0 }
    }

    func entered() async {
        for _ in 0..<1000 {
            if started { return }
            await Task.yield()
        }
        XCTFail("Expected request to start")
    }

    func release() {
        continuation?.resume()
        continuation = nil
    }
}

@MainActor
private final class DetailServiceStub: PodcastDetailService {
    struct Request { let query: PodcastEpisodeQuery; let cursor: Int? }
    var activityToken = UUID()
    let podcastPages = PodcastPageCache()
    var info = Podcast(id: 61, feed: "https://example.test/feed", title: "Podcast", description: "Full description", episodeCount: 90)
    var readInfo: (() async throws -> Podcast)?
    var readPage: ((PodcastEpisodeQuery, Int?) async throws -> EpisodePage)?
    var readRefresh: (() async throws -> FeedRefreshResponse)?
    var saved: Podcast?
    var requests: [Request] = []
    var refreshCount = 0

    func cachedPodcast(id: Int?, feed: String) -> Podcast? { saved }
    func invalidatePodcast(id: Int) { podcastPages.remove(id) }
    func persistPodcastPage(id: Int) {}
    func resolvePodcast(_ podcast: Podcast) async throws -> Podcast { info }
    func podcastInfo(id: Int) async throws -> Podcast { try await readInfo?() ?? info }
    func episodePage(podcastID: Int, query: PodcastEpisodeQuery, cursor: Int?) async throws -> EpisodePage {
        requests.append(Request(query: query, cursor: cursor))
        return try await readPage?(query, cursor) ?? Self.page()
    }
    func refresh(podcastID: Int) async throws -> FeedRefreshResponse {
        refreshCount += 1
        if let readRefresh { return try await readRefresh() }
        throw APIError(statusCode: 503, message: "Unavailable")
    }

    static func page(start: Int = 1, count: Int = 30, total: Int = 90, next: Int? = 30, state: FeedFreshness.State = .fresh) -> EpisodePage {
        let episodes = (start..<(start + count)).map { Episode(id: $0, podcastId: 61, guid: "episode-\($0)", feed: "https://example.test/feed", title: "Episode \($0)", file: EpisodeFile(url: "https://example.test/\($0).mp3")) }
        let missing = state == .pending && count == 0
        let raw: [String: Any] = ["content": missing ? "missing" : "cached", "state": state.rawValue, "checkedAtMs": missing ? NSNull() : 1000, "retryAtMs": state == .pending || state == .backoff ? 1000 : NSNull()]
        let freshness = try! JSONDecoder().decode(FeedFreshness.self, from: JSONSerialization.data(withJSONObject: raw))
        return EpisodePage(episodes: episodes, total: total, hasMore: !missing && next != nil, nextCursor: missing ? nil : next, freshness: freshness)
    }
}


@MainActor
private final class DetailCredentials: SessionCredentialStore {
    func read() -> String? { nil }
    func write(_ value: String) {}
    func delete() throws {}
}

private final class DetailPageURLProtocol: URLProtocol {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var lastRequest: URLRequest?

    static func captured() -> URLRequest? { lock.withLock { lastRequest } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.withLock { Self.lastRequest = request }
        let data = Data(#"{"freshness":{"content":"cached","state":"fresh","checkedAtMs":1000,"retryAtMs":null},"episodes":[],"total":0,"hasMore":false,"nextCursor":null}"#.utf8)
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
