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

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DetailURLProtocol.self]
        let api = APIClient(baseURL: URL(string: "https://example.com")!, session: URLSession(configuration: configuration))
        let podcast = Podcast(id: 9001, feed: "https://example.com/feed.xml", title: "Example")
        let detail = try await api.detail(of: podcast)

        XCTAssertEqual(detail.episodeCount, 202)
        XCTAssertEqual(detail.episodes.map(\.id), [1, 2, 3])
        XCTAssertEqual(DetailURLProtocol.requests.count, 3)
    }

    func testSearchResolvesAppleIdentityThroughFeedBeforeLoadingFullCatalogue() async throws {
        let externalID = 1253186678
        let searchResult: [String: Any] = [
            "id": externalID,
            "feed": "https://example.com/feed.xml",
            "title": "Example",
            "author": "Author",
            "cover": "https://example.com/cover.jpg",
            "thumbnail": "https://example.com/thumbnail.jpg",
        ]
        var preview = Self.podcastPayload(episodeCount: 3)
        preview["episodes"] = [Self.episodePayload(id: 1), Self.episodePayload(id: 2)]
        let catalogue: [String: Any] = [
            "episodes": [Self.episodePayload(id: 1), Self.episodePayload(id: 2), Self.episodePayload(id: 3)],
            "total": 3,
            "hasMore": false,
        ]
        DetailURLProtocol.responses = [
            "/api/search": try JSONSerialization.data(withJSONObject: [searchResult]),
            "/api/feed": try JSONSerialization.data(withJSONObject: preview),
            "/api/feed/info": try JSONSerialization.data(withJSONObject: Self.podcastPayload(episodeCount: 3)),
            "/api/feed/episodes": try JSONSerialization.data(withJSONObject: catalogue),
        ]
        defer { DetailURLProtocol.reset() }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DetailURLProtocol.self]
        let api = APIClient(baseURL: URL(string: "https://example.com")!, session: URLSession(configuration: configuration))
        let results = try await api.search(term: "Example")
        let podcast = try XCTUnwrap(results.first)
        XCTAssertNil(podcast.id)
        XCTAssertEqual(podcast.cover, "https://example.com/cover.jpg")

        let detail = try await api.detail(of: podcast)

        XCTAssertEqual(detail.id, 9001)
        XCTAssertEqual(detail.episodes.map(\.id), [1, 2, 3])
        XCTAssertEqual(DetailURLProtocol.requests.count, 4)
        let feedRequest = try XCTUnwrap(DetailURLProtocol.requests.first { $0.url?.path == "/api/feed" })
        let infoRequest = try XCTUnwrap(DetailURLProtocol.requests.first { $0.url?.path == "/api/feed/info" })
        let episodesRequest = try XCTUnwrap(DetailURLProtocol.requests.first { $0.url?.path == "/api/feed/episodes" })
        XCTAssertEqual(Self.query("url", in: feedRequest), podcast.feed)
        XCTAssertEqual(Self.query("id", in: infoRequest), "9001")
        XCTAssertEqual(Self.query("podcastId", in: episodesRequest), "9001")
        XCTAssertFalse(DetailURLProtocol.requests.contains { $0.url?.absoluteString.contains(String(externalID)) == true })
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
        let summary = Podcast(id: 8, feed: "https://example.com/feed.xml", title: "Example", episodes: [episode(guid: "latest")])
        let cache = FeedCache(lifetime: 300, persistentLifetime: 100, now: { now }, storageURL: storageURL)
        cache.markSubscribed([summary])
        let full = Podcast(id: 8, feed: summary.feed, title: "Example", episodes: [episode(guid: "latest"), episode(guid: "older")])
        _ = try await cache.load(.id(8)) { full }

        let restored = FeedCache(lifetime: 300, persistentLifetime: 100, now: { now }, storageURL: storageURL)
        XCTAssertEqual(restored.cached(id: 8, feed: summary.feed), full)
        now = now.addingTimeInterval(101)
        let offline = try await restored.load(.id(8)) { throw APIError(statusCode: 0, message: "offline") }

        XCTAssertEqual(offline, full)
    }

    private func episode(guid: String) -> Episode {
        Episode(guid: guid, feed: "https://example.com/feed.xml", title: guid, file: EpisodeFile(url: "https://example.com/\(guid).mp3"))
    }

    private static func query(_ name: String, in request: URLRequest) -> String? {
        request.url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }?
            .queryItems?.first { $0.name == name }?.value
    }

    private static func podcastPayload(episodeCount: Int) -> [String: Any] {
        [
            "id": 9001,
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

    private static func episodePayload(id: Int) -> [String: Any] {
        [
            "id": id,
            "podcastId": 9001,
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

private final class DetailURLProtocol: URLProtocol {
    nonisolated(unsafe) static var responses: [String: Data] = [:]
    nonisolated(unsafe) static var requests: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else {
            client?.urlProtocol(self, didFailWithError: APIError(statusCode: 0, message: "Missing URL"))
            return
        }
        Self.requests.append(request)
        let key = url.path + (url.query?.contains("cursor=200") == true ? "?cursor=200" : "")
        guard let data = Self.responses[key] else {
            client?.urlProtocol(self, didFailWithError: APIError(statusCode: 404, message: "Missing fixture"))
            return
        }
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    static func reset() {
        responses = [:]
        requests = []
    }
}
