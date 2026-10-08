import Foundation
import XCTest
@testable import Podcst

@MainActor
final class FeedCacheTests: XCTestCase {
    func testPodcastDetailLoadsEveryEpisodePage() async throws {
        let info = Self.podcastPayload(episodeCount: 202)
        let firstPage = [
            "episodes": [Self.episodePayload(id: 1), Self.episodePayload(id: 2)],
            "total": 202,
            "hasMore": true,
            "nextCursor": 200,
        ] as [String: Any]
        let secondPage = [
            "episodes": [Self.episodePayload(id: 3)],
            "total": 202,
            "hasMore": false,
        ] as [String: Any]
        DetailURLProtocol.responses = [
            "/api/feed/info": try JSONSerialization.data(withJSONObject: info),
            "/api/feed/episodes": try JSONSerialization.data(withJSONObject: firstPage),
            "/api/feed/episodes?cursor=200": try JSONSerialization.data(withJSONObject: secondPage),
        ]
        defer { DetailURLProtocol.reset() }

        let api = makeAPI()
        let podcast = Podcast(id: 9001, feed: "https://example.com/feed.xml", title: "Example")
        let detail = try await api.detail(of: podcast)

        XCTAssertEqual(detail.episodeCount, 202)
        XCTAssertEqual(detail.episodes.map(\.id), [1, 2, 3])
        XCTAssertEqual(DetailURLProtocol.requests.count, 3)
    }

    func testSearchUsesDatabaseIdentityAndResolvesOnlyUnindexedAppleResults() async throws {
        for databaseID in [9001, nil] as [Int?] {
            let externalID = 6806963519
            var searchResult: [String: Any] = [
                "itunes_id": String(externalID),
                "feed": "https://example.com/migrated-feed.xml",
                "title": "Example",
                "author": "Author",
                "cover": "https://example.com/cover.jpg",
                "thumbnail": "https://example.com/thumbnail.jpg",
            ]
            searchResult["id"] = databaseID.map(String.init)
            let catalogue: [String: Any] = [
                "episodes": [Self.episodePayload(id: 1), Self.episodePayload(id: 2), Self.episodePayload(id: 3)],
                "total": 3,
                "hasMore": false,
            ]
            DetailURLProtocol.responses = [
                "/api/search": try JSONSerialization.data(withJSONObject: [searchResult]),
                "/api/feed/resolve": Data(#"{"id":"9001"}"#.utf8),
                "/api/feed/info": try JSONSerialization.data(withJSONObject: Self.podcastPayload(episodeCount: 3)),
                "/api/feed/episodes": try JSONSerialization.data(withJSONObject: catalogue),
            ]
            defer { DetailURLProtocol.reset() }

            let api = makeAPI()
            let results = try await api.search(term: "Example", locale: "nl")
            let podcast = try XCTUnwrap(results.first)
            XCTAssertEqual(podcast.id, databaseID)
            XCTAssertEqual(podcast.itunesId, externalID)
            XCTAssertEqual(podcast.cover, "https://example.com/cover.jpg")
            XCTAssertEqual(DetailURLProtocol.requests.count, 1)

            let detail = try await api.detail(of: podcast)

            XCTAssertEqual(detail.id, 9001)
            XCTAssertEqual(detail.feed, "https://example.com/feed.xml")
            XCTAssertEqual(detail.episodes.map(\.id), [1, 2, 3])
            XCTAssertEqual(DetailURLProtocol.requests.count, databaseID == nil ? 4 : 3)
            let infoRequest = try XCTUnwrap(DetailURLProtocol.requests.first { $0.url?.path == "/api/feed/info" })
            let episodesRequest = try XCTUnwrap(DetailURLProtocol.requests.first { $0.url?.path == "/api/feed/episodes" })
            XCTAssertEqual(Self.query("id", in: infoRequest), "9001")
            XCTAssertEqual(Self.query("podcastId", in: episodesRequest), "9001")
            XCTAssertFalse(DetailURLProtocol.requests.contains { $0.url?.path == "/api/feed" })
            let resolution = DetailURLProtocol.requests.first { $0.url?.path == "/api/feed/resolve" }
            if databaseID == nil {
                let request = try XCTUnwrap(resolution)
                XCTAssertEqual(request.httpMethod, "POST")
                let body = try XCTUnwrap(request.httpBody)
                let values = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
                XCTAssertEqual(values["itunes_id"] as? String, String(externalID))
                XCTAssertEqual(values["locale"] as? String, "nl")
                XCTAssertNil(values["id"])
            } else {
                XCTAssertNil(resolution)
            }
        }
    }

    func testAppleResolutionFailuresNeverFallBackToFeedIngestion() async throws {
        for status in [404, 409, 502] {
            DetailURLProtocol.responses = ["/api/feed/resolve": Data(#"{"message":"Cannot resolve"}"#.utf8)]
            DetailURLProtocol.statuses = ["/api/feed/resolve": status]
            defer { DetailURLProtocol.reset() }
            let api = makeAPI()
            let podcast = Podcast(itunesId: 1614253637, feed: "https://example.com/migrated-feed.xml", title: "Search Engine")
            do {
                _ = try await api.detail(of: podcast)
                XCTFail("Resolution errors must be surfaced")
            } catch {
                XCTAssertEqual((error as? APIError)?.statusCode, status)
            }
            XCTAssertEqual(DetailURLProtocol.requests.map { $0.url?.path }, ["/api/feed/resolve"])
        }
    }

    func testForcedAppleDetailResolvesBeforeRefreshingTheInternalID() async throws {
        DetailURLProtocol.responses = [
            "/api/feed/resolve": Data(#"{"id":"9001"}"#.utf8),
            "/api/feed/refresh": try JSONSerialization.data(withJSONObject: Self.feedPayload(episodeIDs: [1, 2, 3])),
        ]
        defer { DetailURLProtocol.reset() }
        let api = makeAPI()
        let podcast = Podcast(itunesId: 1614253637, feed: "https://example.com/feed.xml", title: "Example")
        let detail = try await api.detail(of: podcast, forceRefresh: true)
        XCTAssertEqual(detail.id, 9001)
        XCTAssertEqual(DetailURLProtocol.requests.map { $0.url?.path }, ["/api/feed/resolve", "/api/feed/refresh"])
        let body = try XCTUnwrap(DetailURLProtocol.requests.last?.httpBody)
        let values = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(values["podcastId"] as? String, "9001")
    }

    func testForcedPodcastDetailRefreshesCompleteCachedCatalogue() async throws {
        DetailURLProtocol.responses = [
            "/api/feed": try JSONSerialization.data(withJSONObject: Self.feedPayload(episodeIDs: [1, 2, 3])),
            "/api/feed/refresh": try JSONSerialization.data(withJSONObject: Self.feedPayload(episodeIDs: [1, 2, 3, 4], title: "Updated")),
        ]
        defer { DetailURLProtocol.reset() }
        let api = makeAPI()
        let original = try await api.podcast(feed: "https://example.com/feed.xml")
        let cached = try await api.detail(of: original)

        XCTAssertEqual(cached, original)
        XCTAssertEqual(DetailURLProtocol.requests.count, 1)

        let refreshed = try await api.detail(of: original, forceRefresh: true)

        XCTAssertEqual(refreshed.title, "Updated")
        XCTAssertEqual(refreshed.episodes.map(\.id), [1, 2, 3, 4])
        XCTAssertEqual(api.cachedPodcast(id: 9001, feed: original.feed), refreshed)
        XCTAssertEqual(api.cachedPodcast(feed: original.feed), refreshed)
        XCTAssertEqual(DetailURLProtocol.requests.map { $0.url?.path }, ["/api/feed", "/api/feed/refresh"])
        XCTAssertEqual(DetailURLProtocol.requests.last?.httpMethod, "POST")
    }

    func testForcedFeedOnlyDetailResolvesIdentityBeforeRefreshing() async throws {
        DetailURLProtocol.responses = [
            "/api/feed": try JSONSerialization.data(withJSONObject: Self.feedPayload(episodeIDs: [1, 2, 3], id: nil)),
        ]
        defer { DetailURLProtocol.reset() }
        let api = makeAPI()
        let original = try await api.podcast(feed: "https://example.com/feed.xml")
        XCTAssertNil(original.id)
        DetailURLProtocol.responses = [
            "/api/feed": try JSONSerialization.data(withJSONObject: Self.feedPayload(episodeIDs: [1, 2, 3])),
            "/api/feed/refresh": try JSONSerialization.data(withJSONObject: Self.feedPayload(episodeIDs: [1, 2, 3, 4])),
        ]

        let refreshed = try await api.detail(of: original, forceRefresh: true)

        XCTAssertEqual(refreshed.id, 9001)
        XCTAssertEqual(refreshed.episodes.map(\.id), [1, 2, 3, 4])
        XCTAssertEqual(api.cachedPodcast(feed: original.feed), refreshed)
        XCTAssertEqual(DetailURLProtocol.requests.map { $0.url?.path }, ["/api/feed", "/api/feed", "/api/feed/refresh"])
        XCTAssertEqual(Self.query("url", in: DetailURLProtocol.requests[1]), original.feed)
        XCTAssertEqual(DetailURLProtocol.requests.last?.httpMethod, "POST")
    }

    func testForcedFeedOnlyDetailRefreshesWithoutBackendIdentity() async throws {
        DetailURLProtocol.responses = [
            "/api/feed": try JSONSerialization.data(withJSONObject: Self.feedPayload(episodeIDs: [1, 2, 3], id: nil)),
        ]
        defer { DetailURLProtocol.reset() }
        let api = makeAPI()
        let original = try await api.detail(of: Podcast(feed: "https://example.com/feed.xml", title: "Example"))
        DetailURLProtocol.responses["/api/feed"] = try JSONSerialization.data(withJSONObject: Self.feedPayload(episodeIDs: [1, 2, 3, 4], id: nil, title: "Updated"))

        let refreshed = try await api.detail(of: original, forceRefresh: true)

        XCTAssertNil(refreshed.id)
        XCTAssertEqual(refreshed.title, "Updated")
        XCTAssertEqual(refreshed.episodes.map(\.id), [1, 2, 3, 4])
        XCTAssertEqual(api.cachedPodcast(feed: original.feed), refreshed)
        XCTAssertEqual(DetailURLProtocol.requests.map { $0.url?.path }, ["/api/feed", "/api/feed"])
    }

    func testForcedDetailFailuresSurfaceAndPreserveCachedCatalogue() async throws {
        for id in [9001, nil] as [Int?] {
            DetailURLProtocol.responses = [
                "/api/feed": try JSONSerialization.data(withJSONObject: Self.feedPayload(episodeIDs: [1, 2, 3], id: id)),
            ]
            defer { DetailURLProtocol.reset() }
            let api = makeAPI()
            let original = try await api.podcast(feed: "https://example.com/feed.xml", forceRefresh: true)
            let path = id == nil ? "/api/feed" : "/api/feed/refresh"
            DetailURLProtocol.responses = [path: Data(#"{"message":"Refresh unavailable"}"#.utf8)]
            DetailURLProtocol.statuses = [path: 503]

            do {
                _ = try await api.detail(of: original, forceRefresh: true)
                XCTFail("Forced refresh must report its failure")
            } catch {
                XCTAssertEqual((error as? APIError)?.statusCode, 503)
            }

            XCTAssertEqual(api.cachedPodcast(feed: original.feed), original)
            let cached = try await api.detail(of: original)
            XCTAssertEqual(cached, original)
            XCTAssertEqual(DetailURLProtocol.requests.count, 2)
        }
    }

    func testFreshPodcastResponseIsReusedByFeedAndID() async throws {
        var now = Date(timeIntervalSince1970: 100)
        let cache = FeedCache(lifetime: 300, now: { now })
        var fetches = 0
        let podcast = Podcast(id: 42, feed: "https://example.com/feed.xml", title: "Example")

        let first = try await cache.load(.feed(podcast.feed)) {
            fetches += 1
            return podcast
        }
        let second = try await cache.load(.id(42)) {
            fetches += 1
            return podcast
        }

        XCTAssertEqual(first, podcast)
        XCTAssertEqual(second, podcast)
        XCTAssertEqual(fetches, 1)
        XCTAssertEqual(cache.cached(id: 42, feed: podcast.feed), podcast)
        now = now.addingTimeInterval(301)
        let third = try await cache.load(.feed(podcast.feed)) {
            fetches += 1
            return podcast
        }
        XCTAssertEqual(third, podcast)
        XCTAssertEqual(fetches, 2)
    }

    func testRefreshBypassesFreshEntryAndUpdatesCache() async throws {
        let cache = FeedCache(lifetime: 300)
        let original = Podcast(id: 7, feed: "https://example.com/feed.xml", title: "Original")
        let refreshed = Podcast(id: 7, feed: original.feed, title: "Refreshed")

        _ = try await cache.load(.id(7)) { original }
        let result = try await cache.load(.id(7), refreshing: true) { refreshed }

        XCTAssertEqual(result, refreshed)
        XCTAssertEqual(cache.cached(id: 7, feed: original.feed), refreshed)
    }

    func testSubscribedSnapshotSurvivesRestartAndServesStaleOfflineData() async throws {
        var now = Date(timeIntervalSince1970: 100)
        let storageURL = temporaryURL()
        defer { try? FileManager.default.removeItem(at: storageURL) }
        let summary = Podcast(id: 8, feed: "https://example.com/feed.xml", title: "Example", episodes: [episode(guid: "latest")])
        let cache = FeedCache(lifetime: 300, now: { now }, storageURL: storageURL)
        cache.markSubscribed([summary])
        let full = Podcast(id: 8, feed: summary.feed, title: "Example", episodes: [episode(guid: "latest"), episode(guid: "older")])
        _ = try await cache.load(.id(8)) { full }

        let restored = FeedCache(lifetime: 300, now: { now }, storageURL: storageURL)
        XCTAssertEqual(restored.cached(id: 8, feed: summary.feed), full)
        var fetches = 0
        for elapsed: TimeInterval in [0, 30 * 86400, 3650 * 86400] {
            now = Date(timeIntervalSince1970: 100 + elapsed)
            let offline = try await restored.load(.id(8)) {
                fetches += 1
                throw APIError(statusCode: 0, message: "offline")
            }
            XCTAssertEqual(offline, full)
            XCTAssertEqual(restored.cached(id: 8, feed: summary.feed), full)
        }

        XCTAssertEqual(fetches, 3)
        let relaunched = FeedCache(now: { now }, storageURL: storageURL)
        XCTAssertEqual(relaunched.cached(id: 8, feed: summary.feed), full)
    }

    func testRepeatedSubscriptionMarkingDoesNotRenewCatalogueFreshness() async throws {
        for markByID in [false, true] {
            var now = Date(timeIntervalSince1970: 100)
            let cache = FeedCache(lifetime: 300, now: { now })
            let summary = Podcast(id: 8, feed: "https://example.com/feed.xml", title: "Example", episodes: [episode(guid: "latest")])
            let full = Podcast(id: 8, feed: summary.feed, title: "Example", episodes: [episode(guid: "latest"), episode(guid: "older")])
            let updated = Podcast(id: 8, feed: summary.feed, title: "Example", episodes: [episode(guid: "new"), episode(guid: "latest"), episode(guid: "older")])
            cache.markSubscribed([summary])
            _ = try await cache.load(.id(8)) { full }
            var fetches = 0

            for instant: TimeInterval in [200, 399, 400] {
                now = Date(timeIntervalSince1970: instant)
                if markByID {
                    cache.markSubscribed(id: 8)
                } else {
                    cache.markSubscribed([summary])
                }
                XCTAssertEqual(cache.cached(id: 8, feed: summary.feed), full)
                let result = try await cache.load(.id(8)) {
                    fetches += 1
                    return updated
                }
                XCTAssertEqual(result, instant < 400 ? full : updated)
            }

            XCTAssertEqual(fetches, 1)
            XCTAssertEqual(cache.cached(id: 8, feed: summary.feed), updated)
        }
    }

    func testRemovingSubscriptionDoesNotRenewCatalogueFreshness() async throws {
        var now = Date(timeIntervalSince1970: 100)
        let cache = FeedCache(lifetime: 300, now: { now })
        let original = Podcast(id: 8, feed: "https://example.com/feed.xml", title: "Original")
        let updated = Podcast(id: 8, feed: original.feed, title: "Updated")
        cache.markSubscribed([original])
        _ = try await cache.load(.id(8)) { original }

        now = Date(timeIntervalSince1970: 399)
        cache.removeSubscription(id: 8)
        XCTAssertEqual(cache.cached(id: 8, feed: original.feed), original)
        now = Date(timeIntervalSince1970: 400)
        var fetches = 0
        let result = try await cache.load(.id(8)) {
            fetches += 1
            return updated
        }

        XCTAssertEqual(result, updated)
        XCTAssertEqual(fetches, 1)
    }

    func testRestoredCatalogueRevalidatesDespiteSavedFutureExpiry() async throws {
        let now = Date(timeIntervalSince1970: 100)
        let storageURL = temporaryURL()
        defer { try? FileManager.default.removeItem(at: storageURL) }
        let cache = FeedCache(lifetime: 300, now: { now }, storageURL: storageURL)
        let original = Podcast(id: 8, feed: "https://example.com/feed.xml", title: "Original", episodes: [episode(guid: "latest"), episode(guid: "older")])
        let updated = Podcast(id: 8, feed: original.feed, title: "Updated", episodes: [episode(guid: "new"), episode(guid: "latest"), episode(guid: "older")])
        cache.markSubscribed([original])
        _ = try await cache.load(.id(8)) { original }
        var stored = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: storageURL)) as? [[String: Any]])
        XCTAssertEqual(stored.count, 1)
        stored[0]["expires"] = now.addingTimeInterval(7 * 86400).timeIntervalSinceReferenceDate
        try JSONSerialization.data(withJSONObject: stored).write(to: storageURL)

        let restored = FeedCache(lifetime: 300, now: { now }, storageURL: storageURL)
        XCTAssertEqual(restored.cached(id: 8, feed: original.feed), original)
        var fetches = 0
        let result = try await restored.load(.id(8)) {
            fetches += 1
            return updated
        }

        XCTAssertEqual(result, updated)
        XCTAssertEqual(fetches, 1)
        XCTAssertEqual(restored.cached(id: 8, feed: original.feed), updated)
    }

    private func episode(guid: String) -> Episode {
        Episode(guid: guid, feed: "https://example.com/feed.xml", title: guid, file: EpisodeFile(url: "https://example.com/\(guid).mp3"))
    }

    private func makeAPI() -> APIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DetailURLProtocol.self]
        return APIClient(baseURL: URL(string: "https://example.com")!, session: URLSession(configuration: configuration), keychain: FeedTestCredentials())
    }

    private static func query(_ name: String, in request: URLRequest) -> String? {
        request.url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }?
            .queryItems?.first { $0.name == name }?.value
    }

    private static func podcastPayload(episodeCount: Int) -> [String: Any] {
        [
            "id": "9001",
            "feed": "https://example.com/feed.xml",
            "title": "Example",
            "author": "Author",
            "cover": "https://example.com/cover.jpg",
            "description": "Description",
            "link": NSNull(),
            "published": NSNull(),
            "explicit": false,
            "keywords": [],
            "episodeCount": episodeCount,
        ]
    }

    private static func feedPayload(episodeIDs: [Int], id: Int? = 9001, title: String = "Example") -> [String: Any] {
        var payload = podcastPayload(episodeCount: episodeIDs.count)
        payload["id"] = id.map(String.init)
        payload["title"] = title
        payload["episodes"] = episodeIDs.map(episodePayload)
        return payload
    }

    private static func episodePayload(id: Int) -> [String: Any] {
        [
            "id": String(id),
            "podcastId": "9001",
            "feed": "https://example.com/feed.xml",
            "podcastTitle": "Example",
            "guid": "episode-\(id)",
            "title": "Episode \(id)",
            "summary": "Summary",
            "published": id,
            "duration": 60,
            "cover": "https://example.com/cover.jpg",
            "episodeArt": NSNull(),
            "explicit": false,
            "link": NSNull(),
            "showNotes": "Summary",
            "author": "Author",
            "file": ["url": "https://example.com/episode-\(id).mp3", "length": 100, "type": "audio/mpeg"],
        ]
    }

    private func temporaryURL() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("json")
    }
}

@MainActor
private final class FeedTestCredentials: SessionCredentialStore {
    func read() -> String? { nil }
    func write(_ value: String) {}
    func delete() {}
}

private final class DetailURLProtocol: URLProtocol {
    nonisolated(unsafe) static var responses: [String: Data] = [:]
    nonisolated(unsafe) static var statuses: [String: Int] = [:]
    nonisolated(unsafe) static var requests: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else {
            client?.urlProtocol(self, didFailWithError: APIError(statusCode: 0, message: "Missing URL"))
            return
        }
        var recorded = request
        if recorded.httpBody == nil, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                guard count > 0 else { break }
                data.append(contentsOf: buffer.prefix(count))
            }
            recorded.httpBody = data
        }
        Self.requests.append(recorded)
        let key = url.path + (url.query?.contains("cursor=200") == true ? "?cursor=200" : "")
        guard let data = Self.responses[key] else {
            client?.urlProtocol(self, didFailWithError: APIError(statusCode: 404, message: "Missing fixture"))
            return
        }
        let response = HTTPURLResponse(url: url, statusCode: Self.statuses[key] ?? 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    static func reset() {
        responses = [:]
        statuses = [:]
        requests = []
    }
}
