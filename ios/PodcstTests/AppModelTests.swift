import Foundation
import XCTest
@testable import Podcst

@MainActor
final class AppModelTests: XCTestCase {
    override func tearDown() {
        ContractURLProtocol.reset()
        AppModelURLProtocol.reset()
        super.tearDown()
    }

    func testCarPlayOnlyStartupPreservesQueuedPositionWithoutAutoplay() async throws {
        let (model, transport) = try fixture()
        let episode = Episode(id: 41, guid: "queued", feed: "https://example.test/feed", title: "Queued", duration: 300, file: EpisodeFile(url: "https://example.test/audio.mp3"))
        model.playback.restore(episode, at: 42)
        ContractURLProtocol.install([guest])

        await model.start()

        XCTAssertFalse(model.session.isLoading)
        XCTAssertTrue(model.library.hasLoaded)
        XCTAssertEqual(model.playback.currentEpisode?.identity, episode.identity)
        XCTAssertEqual(model.playback.currentTime, 42)
        XCTAssertFalse(model.playback.isPlaybackRequested)
        XCTAssertEqual(transport.playCount, 0)
        XCTAssertEqual(ContractURLProtocol.requests().map { $0.url?.path }, ["/api/auth/session"])
    }

    func testPhoneAndCarPlayShareOneStartupAndSessionRestoration() async throws {
        let (model, transport) = try fixture()
        ContractURLProtocol.install([guest])
        model.setActive(true, for: .phone)
        model.setActive(true, for: .carPlay)

        async let phone: Void = model.start()
        async let car: Void = model.start()
        _ = await (phone, car)
        model.setActive(false, for: .phone)
        await model.start()
        await model.refresh()
        model.setActive(false, for: .carPlay)

        XCTAssertFalse(model.session.isLoading)
        XCTAssertTrue(model.library.hasLoaded)
        XCTAssertEqual(ContractURLProtocol.requests().map { $0.url?.path }, ["/api/auth/session"])
        XCTAssertEqual(transport.playCount, 0)
    }

    func testCarPlayStartupRetiresCachedAccountQueueWhenSessionExpired() async throws {
        let (model, transport) = try fixture(cachedUser: User(id: "previous-account", email: "fixture@example.test"))
        let episode = Episode(id: 42, guid: "private", feed: "https://example.test/private", title: "Private", file: EpisodeFile(url: "https://example.test/private.mp3"), isPrivate: true)
        model.playback.restore(episode, at: 10)
        ContractURLProtocol.install([guest])

        await model.start()

        XCTAssertNil(model.session.user)
        XCTAssertNil(model.media.accountID)
        XCTAssertNil(model.stars.accountID)
        XCTAssertTrue(model.playback.queue.isEmpty)
        XCTAssertTrue(model.library.podcasts.isEmpty)
        XCTAssertEqual(transport.playCount, 0)
    }

    func testSignedInColdStartRestoresProgressWithoutAutoplay() async throws {
        let (model, transport) = try fixture(cachedUser: User(id: "carplay-account", email: "fixture@example.test"), protocolClass: AppModelURLProtocol.self)
        let startup = Task { await model.start() }
        try await waitForAccountRequest()
        XCTAssertNil(model.library.syncError)
        AppModelURLProtocol.releaseAccount()
        await startup.value

        XCTAssertEqual(model.playback.currentEpisode?.id, 97)
        XCTAssertEqual(model.playback.currentTime, 77)
        XCTAssertFalse(model.playback.isPlaybackRequested)
        XCTAssertEqual(transport.playCount, 0)
        XCTAssertEqual(AppModelURLProtocol.currentProgressReads, 1)
    }

    func testSlowRefreshDoesNotRestoreOverNewerPlayAndStopIntent() async throws {
        let (model, transport) = try fixture(cachedUser: User(id: "carplay-account", email: "fixture@example.test"), protocolClass: AppModelURLProtocol.self)
        let episode = Episode(id: 41, guid: "chosen", feed: "https://example.test/feed", title: "Chosen", duration: 300, file: EpisodeFile(url: "https://example.test/chosen.mp3"))
        model.playback.restore(episode, at: 42)
        let startup = Task { await model.start() }
        try await waitForAccountRequest()
        XCTAssertNil(model.library.syncError)
        model.playback.resume()
        model.playback.stop()
        AppModelURLProtocol.releaseAccount()
        await startup.value

        XCTAssertEqual(model.playback.currentEpisode?.id, 41)
        XCTAssertEqual(model.playback.currentTime, 42)
        XCTAssertFalse(model.playback.isActive)
        XCTAssertEqual(transport.playCount, 1)
        XCTAssertEqual(AppModelURLProtocol.currentProgressReads, 0)
    }

    func testForegroundRefreshCompletesPendingDeletionAndLoadsGuestLibrary() async throws {
        let preparation = DeletionPreparation(accountId: "carplay-account", operationId: UUID().uuidString.lowercased(), receipt: String(repeating: "A", count: 43), expiresAt: "2099-01-02T00:00:00.000Z", proofExpiresAt: "2099-01-01T00:00:00.000Z")
        let deletion = AccountDeletion(accountId: "carplay-account", preparation: preparation, outcome: .pending)
        let podcast = Podcast(id: 501, feed: "https://example.test/guest", title: "Guest show")
        let (model, _) = try fixture(cachedUser: User(id: "carplay-account", email: "fixture@example.test"), protocolClass: AppModelURLProtocol.self, podcasts: [podcast], deletion: deletion)
        await model.start()
        XCTAssertEqual(model.session.user?.id, "carplay-account")
        XCTAssertEqual(model.deletion.records.first?.outcome, .pending)
        XCTAssertFalse(model.session.accountWorkAllowed)

        AppModelURLProtocol.completeDeletion()
        await model.refresh()
        for _ in 0..<100 {
            if model.library.podcasts.map(\.title) == ["Guest show"] { break }
            try await Task.sleep(for: .milliseconds(20))
        }

        XCTAssertNil(model.session.user)
        XCTAssertEqual(model.deletion.records.first?.cleanup, .complete)
        XCTAssertEqual(model.library.podcasts.map(\.title), ["Guest show"])
        XCTAssertTrue(model.playback.queue.isEmpty)
    }

    private func waitForAccountRequest() async throws {
        for _ in 0..<100 {
            if AppModelURLProtocol.accountIsWaiting { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("Account refresh did not reach the fixture barrier")
        throw URLError(.timedOut)
    }

    private var guest: ContractResponse {
        ContractResponse(status: 200, data: Data(#"{"user":null}"#.utf8))
    }

    private func fixture(cachedUser: User? = nil, protocolClass: AnyClass = ContractURLProtocol.self, podcasts: [Podcast] = [], deletion: AccountDeletion? = nil) throws -> (AppModel, AppModelTransport) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        if let cachedUser { try JSONEncoder().encode(cachedUser).write(to: directory.appendingPathComponent("session.json")) }
        if let deletion { try JSONEncoder().encode([deletion]).write(to: directory.appendingPathComponent("account-deletions.json")) }
        let suite = "app-model-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defaults.set(try JSONEncoder().encode(podcasts), forKey: "guest.library.podcasts")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [protocolClass]
        let api = APIClient(baseURL: URL(string: "https://app-model-\(UUID()).example.test")!, session: URLSession(configuration: configuration), keychain: ContractCredentials(value: cachedUser == nil ? nil : "fixture-session"))
        let transport = AppModelTransport()
        let model = AppModel(api: api, directory: directory, defaults: defaults, transport: transport, integratesWithSystem: false, monitorsConnectivity: false, downloadConfiguration: configuration)
        addTeardownBlock {
            await MainActor.run {
                model.setActive(false, for: .phone)
                model.setActive(false, for: .carPlay)
                model.playback.shutdown()
            }
            UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
        }
        return (model, transport)
    }
}

@MainActor
private final class AppModelTransport: PlaybackTransport {
    var onUpdate: (@MainActor (PlaybackTransportUpdate) -> Void)?
    var hasSource = false
    var position: TimeInterval = 0
    var playCount = 0

    func load(source: PlaybackSource, at position: TimeInterval, generation: UUID) {
        self.position = position
        hasSource = true
    }

    func play(atRate rate: Double) { playCount += 1 }
    func pause() {}
    func setRate(_ rate: Double) {}
    func setEffects(_ effects: AudioEffects) {}
    func seek(to position: TimeInterval, generation: UUID) { self.position = position }
    func stop() { hasSource = false }
    func shutdown() { stop() }
}

private final class AppModelURLProtocol: URLProtocol {
    private static let state = AppModelURLProtocolState()

    static var accountIsWaiting: Bool {
        state.lock.lock()
        defer { state.lock.unlock() }
        return state.account != nil
    }

    static var currentProgressReads: Int {
        state.lock.lock()
        defer { state.lock.unlock() }
        return state.currentProgressReads
    }

    static func reset() {
        state.lock.lock()
        state.account = nil
        state.currentProgressReads = 0
        state.deletionCompleted = false
        state.lock.unlock()
    }

    static func completeDeletion() {
        state.lock.lock()
        state.deletionCompleted = true
        state.lock.unlock()
    }

    static func releaseAccount() {
        state.lock.lock()
        let request = state.account
        state.account = nil
        state.lock.unlock()
        request?.respond(#"{"passkeys":[],"preferences":{"speed":1,"volumeBoost":false,"trimSilence":false}}"#)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else { return }
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        switch url.path {
        case "/api/auth/session":
            respond(#"{"user":{"id":"carplay-account","email":"fixture@example.test","hasPasskey":false}}"#)
        case "/api/account/deletion/status":
            Self.state.lock.lock()
            let completed = Self.state.deletionCompleted
            Self.state.lock.unlock()
            respond(completed ? #"{"status":"completed"}"# : #"{"status":"pending"}"#)
        case "/api/account":
            Self.state.lock.lock()
            Self.state.account = self
            Self.state.lock.unlock()
        case "/api/subscriptions" where query.isEmpty:
            respond("[]")
        case "/api/progress" where query.isEmpty:
            Self.state.lock.lock()
            Self.state.currentProgressReads += 1
            Self.state.lock.unlock()
            respond(#"{"position":77,"episode":{"id":"97","guid":"remote","title":"Remote","feed":"https://example.test/feed","explicit":false,"duration":300,"file":{"url":"https://example.test/remote.mp3"}}}"#)
        case "/api/progress", "/api/subscriptions":
            let ids = query.first { $0.name == "episodeIds" }?.value?.split(separator: ",") ?? []
            let items = ids.map { #"{"episodeId":"\#($0)","progress":null}"# }.joined(separator: ",")
            respond(#"{"protocol":1,"accountId":"carplay-account","generation":"17adbd84-d0e4-4e2d-ad9f-b084efee3211","revision":"0","items":[\#(items)]}"#)
        default:
            respond(#"{"message":"Unavailable in this fixture"}"#, status: 503)
        }
    }

    override func stopLoading() {
        Self.state.lock.lock()
        if Self.state.account === self { Self.state.account = nil }
        Self.state.lock.unlock()
    }

    private func respond(_ json: String, status: Int = 200) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(json.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}

private final class AppModelURLProtocolState: @unchecked Sendable {
    let lock = NSLock()
    var account: AppModelURLProtocol?
    var currentProgressReads = 0
    var deletionCompleted = false
}
