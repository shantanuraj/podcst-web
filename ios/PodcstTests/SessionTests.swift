import Foundation
import XCTest
@testable import Podcst

@MainActor
final class SessionTests: XCTestCase {
    func testCachedAccountSurvivesOfflineRestoreAndSignsOutOffline() async throws {
        let fixture = try fixture()
        defer { fixture.cleanUp() }
        let session = SessionStore(api: fixture.api, storageURL: fixture.url)
        XCTAssertEqual(session.user?.id, "listener")
        XCTAssertEqual(fixture.api.accountID, "listener")
        await session.restore()
        XCTAssertEqual(session.user?.id, "listener")
        var transitions: [String?] = []
        session.prepareAccountChange = { transitions.append($0) }
        await session.signOut()
        XCTAssertNil(session.user)
        XCTAssertNil(fixture.api.accountID)
        XCTAssertFalse(fixture.api.hasSession)
        XCTAssertEqual(transitions.count, 1)
        XCTAssertNil(transitions.first ?? nil)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.url.path))
        XCTAssertNil(SessionStore(api: fixture.api, storageURL: fixture.url).user)
    }

    func testAuthoritativeSessionExpiryClearsCachedAccountAfterResourceRetirement() async throws {
        let fixture = try fixture(status: 401)
        defer { fixture.cleanUp() }
        let session = SessionStore(api: fixture.api, storageURL: fixture.url)
        var retired = false
        session.prepareAccountChange = { id in
            XCTAssertNil(id)
            XCTAssertEqual(session.user?.id, "listener")
            retired = true
        }
        await session.restore()
        XCTAssertTrue(retired)
        XCTAssertNil(session.user)
        XCTAssertFalse(fixture.api.hasSession)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.url.path))
    }

    func testSignOutCancelsAnUnresponsiveStartupRestore() async throws {
        let fixture = try fixture(status: 999)
        defer { fixture.cleanUp() }
        let session = SessionStore(api: fixture.api, storageURL: fixture.url)
        let started = expectation(forNotification: Notification.Name("SessionTestRequestStarted"), object: nil)
        let restore = Task { await session.restore() }
        await fulfillment(of: [started], timeout: 2)
        await session.signOut()
        await restore.value
        XCTAssertNil(session.user)
        XCTAssertFalse(fixture.api.hasSession)
        XCTAssertFalse(session.isLoading)
    }

    func testUserSnapshotAloneDoesNotRestoreAuthentication() throws {
        let fixture = try fixture()
        defer { fixture.cleanUp() }
        fixture.keychain.delete()
        let api = APIClient(keychain: fixture.keychain)
        XCTAssertNil(SessionStore(api: api, storageURL: fixture.url).user)
        XCTAssertNil(api.accountID)
    }

    func testLibraryWaitsForAccountRestoreWhenOnlyCredentialsRemain() async throws {
        let fixture = try fixture(status: 200)
        defer { fixture.api.clearSession(); fixture.cleanUp() }
        try FileManager.default.removeItem(at: fixture.url)
        let defaultsName = "LibraryBootstrap-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: defaultsName)!
        defer { defaults.removePersistentDomain(forName: defaultsName) }
        let session = SessionStore(api: fixture.api, storageURL: fixture.url)
        let library = LibraryStore(api: fixture.api, session: session, defaults: defaults)

        XCTAssertTrue(fixture.api.hasSession)
        XCTAssertNil(session.user)
        XCTAssertTrue(session.isLoading)
        XCTAssertFalse(library.hasLoaded)
        await library.load()
        XCTAssertFalse(library.hasLoaded)
        XCTAssertTrue(library.podcasts.isEmpty)

        await session.restore()
        XCTAssertEqual(session.user?.id, "listener")
        XCTAssertFalse(session.isLoading)
        XCTAssertFalse(library.hasLoaded)
        await library.load(forceRefresh: true)
        XCTAssertTrue(library.hasLoaded)
        XCTAssertEqual(library.podcasts.map(\.title), ["Restored show"])
        XCTAssertEqual(library.newReleases.map(\.title), ["Restored episode"])
    }

    func testGuestRefreshPersistsUpdatedEpisodesAndRetainsUnavailableShows() async throws {
        let unavailable = Podcast(id: 9031, feed: "https://example.test/unavailable", title: "Unavailable show")
        let original = Podcast(id: 9032, feed: "https://example.test/updated", title: "Original show")
        let episode = Episode(guid: "new", feed: original.feed, title: "New episode", file: EpisodeFile(url: "https://example.test/new.mp3"))
        let updated = Podcast(id: original.id, feed: original.feed, title: "Updated show", episodeCount: 1, episodes: [episode])
        let fixture = try await guestFixture(podcasts: [unavailable, original])
        defer { fixture.cleanUp() }
        var requests = 0
        GuestLibraryURLProtocol.handler = { request in
            XCTAssertEqual(request.request.url?.path, "/api/feed/refresh")
            XCTAssertEqual(request.request.httpMethod, "POST")
            requests += 1
            if requests == 1 {
                request.fail(URLError(.notConnectedToInternet))
            } else {
                try request.respond(updated)
            }
        }

        await fixture.library.load()
        XCTAssertEqual(requests, 0)
        await fixture.library.load(forceRefresh: true)

        XCTAssertEqual(requests, 2)
        XCTAssertEqual(fixture.library.podcasts.map(\.title), [unavailable.title, updated.title])
        XCTAssertEqual(fixture.library.newReleases.map(\.title), [episode.title])
        XCTAssertNotNil(fixture.library.error)
        XCTAssertFalse(fixture.library.isLoading)
        let restored = LibraryStore(api: fixture.api, session: fixture.session, defaults: fixture.defaults)
        XCTAssertEqual(restored.podcasts, fixture.library.podcasts)
    }

    func testGuestRefreshPreservesSubscriptionChangesDuringRequests() async throws {
        let removed = Podcast(id: 9041, feed: "https://example.test/removed", title: "Removed show")
        let kept = Podcast(id: 9042, feed: "https://example.test/kept", title: "Kept show")
        let added = Podcast(id: 9043, feed: "https://example.test/added", title: "Added show")
        var updated = kept
        updated.title = "Updated kept show"
        let fixture = try await guestFixture(podcasts: [removed, kept])
        defer { fixture.cleanUp() }
        let started = expectation(description: "Guest refresh started")
        var pending: GuestLibraryRequest?
        GuestLibraryURLProtocol.handler = { request in
            if pending == nil {
                pending = request
                started.fulfill()
            } else {
                try request.respond(updated)
            }
        }

        let refresh = Task { await fixture.library.load(forceRefresh: true) }
        await fulfillment(of: [started], timeout: 2)
        await fixture.library.toggleSubscription(removed)
        await fixture.library.toggleSubscription(added)
        try XCTUnwrap(pending).respond(removed)
        await refresh.value

        XCTAssertEqual(fixture.library.podcasts.map(\.title), [updated.title, added.title])
        XCTAssertNil(fixture.library.error)
        let restored = LibraryStore(api: fixture.api, session: fixture.session, defaults: fixture.defaults)
        XCTAssertEqual(restored.podcasts, fixture.library.podcasts)
    }

    func testCancelledGuestRefreshDoesNotReplaceSavedPodcasts() async throws {
        let original = Podcast(id: 9051, feed: "https://example.test/cancelled", title: "Original show")
        var updated = original
        updated.title = "Updated show"
        let fixture = try await guestFixture(podcasts: [original])
        defer { fixture.cleanUp() }
        let started = expectation(description: "Guest refresh started")
        var pending: GuestLibraryRequest?
        GuestLibraryURLProtocol.handler = { request in
            pending = request
            started.fulfill()
        }

        let refresh = Task { await fixture.library.load(forceRefresh: true) }
        await fulfillment(of: [started], timeout: 2)
        refresh.cancel()
        try XCTUnwrap(pending).respond(updated)
        await refresh.value

        XCTAssertEqual(fixture.library.podcasts, [original])
        XCTAssertNil(fixture.library.error)
        let restored = LibraryStore(api: fixture.api, session: fixture.session, defaults: fixture.defaults)
        XCTAssertEqual(restored.podcasts, [original])
    }

    func testGuestRefreshDoesNotApplyAfterAccountRestore() async throws {
        let original = Podcast(id: 9061, feed: "https://example.test/account-change", title: "Guest show")
        let fixture = try await guestFixture(podcasts: [original])
        defer { fixture.cleanUp() }
        fixture.session.prepareAccountChange = { _ in await fixture.library.resetProgressSync() }
        let started = expectation(description: "Guest refresh started")
        var pending: GuestLibraryRequest?
        GuestLibraryURLProtocol.handler = { request in
            if request.request.url?.path == "/api/auth/session" {
                try request.respond(["user": User(id: "new-listener", email: "new@example.test")])
            } else {
                pending = request
                started.fulfill()
            }
        }

        let refresh = Task { await fixture.library.load(forceRefresh: true) }
        await fulfillment(of: [started], timeout: 2)
        await fixture.session.restore()
        try XCTUnwrap(pending).respond(original)
        await refresh.value

        XCTAssertEqual(fixture.session.user?.id, "new-listener")
        XCTAssertTrue(fixture.library.podcasts.isEmpty)
        let saved = try XCTUnwrap(fixture.defaults.data(forKey: "guest.library.podcasts"))
        XCTAssertEqual(try JSONDecoder().decode([Podcast].self, from: saved), [original])
    }

    func testSharingUsesOnlyDeclaredPublicWebpages() {
        let feed = "https://example.test/private-feed?token=feed-secret"
        let audio = "https://example.test/audio.mp3?token=audio-secret"
        var episode = Episode(guid: "private", feed: feed, title: "Private episode", file: EpisodeFile(url: audio))
        var podcast = Podcast(feed: feed, title: "Private podcast")
        XCTAssertNil(episode.shareURL)
        XCTAssertNil(podcast.shareURL)
        for link in [feed, audio, "file:///tmp/audio.mp3", "https://listener:secret@example.test/episode", "/episode"] {
            episode.link = link
            XCTAssertNil(episode.shareURL)
        }
        for link in [feed, "file:///tmp/feed.xml", "https://listener:secret@example.test/show", "/show"] {
            podcast.link = link
            XCTAssertNil(podcast.shareURL)
        }
        episode.link = "https://example.test/episode"
        podcast.link = "https://example.test/show"
        XCTAssertEqual(episode.shareURL?.absoluteString, episode.link)
        XCTAssertEqual(podcast.shareURL?.absoluteString, podcast.link)
    }

    func testArtworkRetentionIncludesOwnedEpisodeAndFallbackArt() {
        let libraryCover = "https://example.test/library.jpg"
        let fallback = "https://example.test/cover.jpg"
        let episodeArt = "https://example.test/episode.jpg?token=private"
        let episode = Episode(guid: "queued", feed: "https://example.test/feed", title: "Queued", cover: fallback, episodeArt: episodeArt, file: EpisodeFile(url: "https://example.test/audio.mp3"))
        let snapshot = ArtworkRetentionSnapshot(
            accountID: "listener",
            podcasts: [Podcast(feed: "https://example.test/library", title: "Library", cover: libraryCover)],
            episodes: [episode, episode]
        )

        XCTAssertEqual(snapshot.urls, Set([libraryCover, fallback, episodeArt].compactMap(URL.init(string:))))
        XCTAssertEqual(snapshot.accountID, "listener")
    }

    func testArtworkRetentionKeepsSharedArtUntilItsLastOwnerLeaves() {
        let cover = "https://example.test/shared.jpg"
        let episode = Episode(guid: "download", feed: "https://example.test/feed", title: "Downloaded", cover: cover, file: EpisodeFile(url: "https://example.test/audio.mp3"))
        let subscribed = Podcast(feed: episode.feed, title: "Subscribed", cover: cover)
        let both = ArtworkRetentionSnapshot(accountID: "listener", podcasts: [subscribed], episodes: [episode])
        let downloaded = ArtworkRetentionSnapshot(accountID: "listener", podcasts: [], episodes: [episode])
        let removed = ArtworkRetentionSnapshot(accountID: "listener", podcasts: [], episodes: [])

        XCTAssertEqual(both, downloaded)
        XCTAssertFalse(downloaded.urls.isEmpty)
        XCTAssertTrue(removed.urls.isEmpty)
        XCTAssertNotEqual(downloaded, ArtworkRetentionSnapshot(accountID: "other", podcasts: [], episodes: [episode]))
        XCTAssertNotEqual(downloaded, ArtworkRetentionSnapshot(accountID: "listener", podcasts: [], episodes: [episode], isActive: false))
    }

    private func fixture(status: Int? = nil) throws -> SessionFixture {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("session.json")
        try JSONEncoder().encode(User(id: "listener", email: "listener@example.test")).write(to: url)
        let keychain = MemorySessionCredentials()
        keychain.write("test-session")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SessionURLProtocol.self]
        let api = APIClient(baseURL: URL(string: status.map { "https://status-\($0).example.test" } ?? "https://offline.example.test")!, session: URLSession(configuration: configuration), keychain: keychain)
        return SessionFixture(api: api, keychain: keychain, url: url)
    }

    private func guestFixture(podcasts: [Podcast]) async throws -> GuestLibraryFixture {
        let defaultsName = "GuestLibrary-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: defaultsName)!
        defaults.set(try JSONEncoder().encode(podcasts), forKey: "guest.library.podcasts")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("json")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [GuestLibraryURLProtocol.self]
        let api = APIClient(baseURL: URL(string: "https://guest.example.test")!, session: URLSession(configuration: configuration), keychain: MemorySessionCredentials())
        GuestLibraryURLProtocol.handler = { request in
            try request.respond(["user": Optional<User>.none])
        }
        let session = SessionStore(api: api, storageURL: url)
        await session.restore()
        let library = LibraryStore(api: api, session: session, defaults: defaults)
        return GuestLibraryFixture(api: api, session: session, library: library, defaults: defaults, defaultsName: defaultsName, url: url)
    }
}

@MainActor
private struct GuestLibraryFixture {
    let api: APIClient
    let session: SessionStore
    let library: LibraryStore
    let defaults: UserDefaults
    let defaultsName: String
    let url: URL

    func cleanUp() {
        GuestLibraryURLProtocol.handler = nil
        defaults.removePersistentDomain(forName: defaultsName)
        try? FileManager.default.removeItem(at: url)
    }
}

private final class GuestLibraryURLProtocol: URLProtocol, @unchecked Sendable {
    @MainActor static var handler: (@MainActor (GuestLibraryRequest) throws -> Void)?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let request = GuestLibraryRequest(request: request) { [self] result in
            switch result {
            case .success(let data):
                let response = HTTPURLResponse(url: self.request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data)
                client?.urlProtocolDidFinishLoading(self)
            case .failure(let error):
                client?.urlProtocol(self, didFailWithError: error)
            }
        }
        Task { @MainActor in
            do { try GuestLibraryURLProtocol.handler?(request) }
            catch { request.fail(error) }
        }
    }

    override func stopLoading() {}
}

private struct GuestLibraryRequest: Sendable {
    let request: URLRequest
    let complete: @Sendable (Result<Data, Error>) -> Void

    func respond<T: Encodable>(_ value: T) throws {
        complete(.success(try JSONEncoder().encode(value)))
    }

    func fail(_ error: Error) {
        complete(.failure(error))
    }
}

@MainActor
private struct SessionFixture {
    let api: APIClient
    let keychain: MemorySessionCredentials
    let url: URL

    func cleanUp() {
        keychain.delete()
        try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    }
}

private final class SessionURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        assert(!request.httpShouldHandleCookies)
        if let url = request.url, url.host == "status-200.example.test" {
            let payload: String
            switch url.path {
            case "/api/auth/session":
                payload = #"{"user":{"id":"listener","email":"listener@example.test","hasPasskey":false}}"#
            case "/api/subscriptions":
                payload = #"[{"id":9021,"feed":"https://example.test/feed","title":"Restored show","author":"Author","cover":"","explicit":false,"episodes":[{"id":9022,"guid":"restored","title":"Restored episode","explicit":false,"file":{"url":"https://example.test/audio.mp3"}}]}]"#
            case "/api/progress":
                payload = "null"
            default:
                client?.urlProtocol(self, didFailWithError: URLError(.resourceUnavailable))
                return
            }
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(payload.utf8))
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        if request.url?.host == "status-999.example.test", request.url?.path == "/api/auth/session" {
            NotificationCenter.default.post(name: Notification.Name("SessionTestRequestStarted"), object: nil)
            return
        }
        guard let url = request.url, url.host == "status-401.example.test" else {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let response = HTTPURLResponse(url: url, statusCode: 401, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{\"message\":\"Expired\"}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor
private final class MemorySessionCredentials: SessionCredentialStore {
    private var value: String?
    func read() -> String? { value }
    func write(_ value: String) { self.value = value }
    func delete() { value = nil }
}
