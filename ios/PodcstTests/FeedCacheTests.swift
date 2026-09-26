import Foundation
import XCTest
@testable import Podcst

@MainActor
final class FeedCacheTests: XCTestCase {
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

    private func temporaryURL() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("json")
    }
}
