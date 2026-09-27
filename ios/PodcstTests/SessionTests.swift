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
