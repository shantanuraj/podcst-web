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
