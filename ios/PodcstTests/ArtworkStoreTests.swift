import Foundation
import MediaPlayer
import UIKit
import XCTest
@testable import Podcst

@MainActor
final class ArtworkStoreTests: XCTestCase {
    func testFramePixelsSelectSmallestSufficientVariant() {
        XCTAssertEqual(ArtworkStore.pixelSize(for: 44, scale: 3), 160)
        XCTAssertEqual(ArtworkStore.pixelSize(for: 52, scale: 3), 160)
        XCTAssertEqual(ArtworkStore.pixelSize(for: 110, scale: 3), 384)
        XCTAssertEqual(ArtworkStore.pixelSize(for: 128, scale: 3), 384)
        XCTAssertEqual(ArtworkStore.pixelSize(for: 300, scale: 3), 1024)
        XCTAssertGreaterThanOrEqual(ArtworkStore.pixelSize(for: 600, scale: 3), 1800)
    }

    func testSmallFramesDecodeSmallImagesAndDoNotUpscaleSmallSources() async throws {
        let fixture = makeFixture(width: 3000)
        let store = makeStore(fixture)
        let image = await store.image(fixture.url, pixelSize: 160)
        XCTAssertEqual(image?.cgImage?.width, 160)
        XCTAssertEqual(image?.cgImage?.height, 160)
        let small = makeFixture(width: 100)
        let smallImage = await store.image(small.url, pixelSize: 1024)
        XCTAssertEqual(smallImage?.cgImage?.width, 100)
    }

    func testLandscapeSourcesKeepEnoughPixelsForSquareArtworkFrames() async throws {
        let fixture = makeFixture(width: 1200, height: 600)
        let store = makeStore(fixture)
        let image = await store.image(fixture.url, pixelSize: 160)
        XCTAssertEqual(image?.cgImage?.width, 320)
        XCTAssertEqual(image?.cgImage?.height, 160)
        let small = makeFixture(width: 100, height: 50)
        let smallImage = await store.image(small.url, pixelSize: 160)
        XCTAssertEqual(smallImage?.cgImage?.width, 100)
        XCTAssertEqual(smallImage?.cgImage?.height, 50)
    }

    func testConcurrentRequestsShareTransferAndWarmRevisitsDoNotFetch() async throws {
        let fixture = makeFixture(width: 1024)
        fixture.holdResponses = true
        let store = makeStore(fixture)
        let first = Task { await store.image(fixture.url, pixelSize: 384) }
        let second = Task { await store.image(fixture.url, pixelSize: 384) }
        try await wait { fixture.requests.count == 1 }
        fixture.releaseResponses()
        let images = await [first.value, second.value]
        XCTAssertEqual(images.compactMap { $0 }.count, 2)
        let revisit = await store.image(fixture.url, pixelSize: 384)
        XCTAssertNotNil(revisit)
        XCTAssertEqual(fixture.requests.count, 1)
    }

    func testConcurrentImageTransfersAreBoundedAcrossDifferentHosts() async throws {
        let fixtures = (0..<4).map { _ in makeFixture(width: 384) }
        fixtures.forEach { $0.holdResponses = true }
        let store = makeStore(fixtures[0])
        let pending = fixtures.map { fixture in Task { await store.image(fixture.url, pixelSize: 160) } }
        try await wait { fixtures.reduce(0) { $0 + $1.requests.count } == 3 }
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(fixtures.reduce(0) { $0 + $1.requests.count }, 3)
        try XCTUnwrap(fixtures.first { !$0.requests.isEmpty }).releaseResponses()
        try await wait { fixtures.reduce(0) { $0 + $1.requests.count } == 4 }
        fixtures.forEach { $0.releaseResponses() }
        for task in pending {
            let image = await task.value
            XCTAssertNotNil(image)
        }
        XCTAssertTrue(fixtures.allSatisfy { $0.requests.count == 1 })
    }

    func testLargerStoredImageServesSmallerFramesAcrossOfflineRelaunch() async throws {
        let fixture = makeFixture(width: 2048)
        let root = temporaryDirectory()
        let store = makeStore(fixture, root: root)
        let original = await store.image(fixture.url, pixelSize: 1024)
        XCTAssertEqual(original?.cgImage?.width, 1024)
        fixture.failure = URLError(.notConnectedToInternet)
        let relaunched = makeStore(fixture, root: root)
        let row = await relaunched.image(fixture.url, pixelSize: 160)
        XCTAssertEqual(row?.cgImage?.width, 160)
        XCTAssertEqual(fixture.requests.count, 1)
    }

    func testSmallCachedVariantStaysVisibleWhileOneLargerUpgradeIsPending() async throws {
        let fixture = makeFixture(width: 160)
        let url = proxyURL(for: fixture)
        let root = temporaryDirectory()
        let store = makeStore(fixture, root: root)
        let initial = await store.image(url, pixelSize: 160)
        XCTAssertEqual(initial?.cgImage?.width, 160)
        fixture.data = png(width: 1024)
        fixture.holdResponses = true
        var preview: UIImage?
        let loading = Task {
            preview = await store.image(url, pixelSize: 1024)
        }
        try await wait { preview != nil }
        XCTAssertEqual(preview?.cgImage?.width, 160)
        try await wait { fixture.requests.count == 2 }
        let repeated = await store.image(url, pixelSize: 1024)
        XCTAssertEqual(repeated?.cgImage?.width, 160)
        let request = try XCTUnwrap(fixture.requests.last?.url)
        let query = URLComponents(url: request, resolvingAgainstBaseURL: false)?.queryItems
        XCTAssertEqual(query?.first { $0.name == "w" }?.value, "1024")
        XCTAssertEqual(fixture.requests.count, 2)
        fixture.releaseResponses()
        await loading.value
        try await wait { store.cached(url, pixelSize: 1024)?.cgImage?.width == 1024 }
        XCTAssertEqual(fixture.requests.count, 2)
        fixture.failure = URLError(.notConnectedToInternet)
        let relaunched = makeStore(fixture, root: root)
        let player = await relaunched.image(url, pixelSize: 1024)
        XCTAssertEqual(player?.cgImage?.width, 1024)
        XCTAssertEqual(fixture.requests.count, 2)
    }

    func testSmallDiskVariantRemainsAvailableWhenLargerUpgradeFailsOffline() async throws {
        let fixture = makeFixture(width: 160)
        let url = proxyURL(for: fixture)
        let root = temporaryDirectory()
        let store = makeStore(fixture, root: root)
        let initial = await store.image(url, pixelSize: 160)
        XCTAssertEqual(initial?.cgImage?.width, 160)
        fixture.failure = URLError(.notConnectedToInternet)
        let offline = makeStore(fixture, root: root)
        let preview = await offline.image(url, pixelSize: 1024)
        XCTAssertEqual(preview?.cgImage?.width, 160)
        try await wait { offline.revision >= 2 }
        XCTAssertEqual(offline.cached(url, pixelSize: 1024)?.cgImage?.width, 160)
        XCTAssertEqual(fixture.requests.count, 2)
        let relaunched = makeStore(fixture, root: root)
        let row = await relaunched.image(url, pixelSize: 160)
        XCTAssertEqual(row?.cgImage?.width, 160)
        XCTAssertEqual(fixture.requests.count, 2)
    }

    func testDiscoverDiskImageSurvivesRelaunchWithoutRefetching() async throws {
        let fixture = makeFixture(width: 384)
        let root = temporaryDirectory()
        let store = makeStore(fixture, root: root)
        let initial = await store.image(fixture.url, pixelSize: 384, policy: .disk)
        XCTAssertNotNil(initial)
        fixture.failure = URLError(.notConnectedToInternet)
        let relaunched = makeStore(fixture, root: root)
        let cached = await relaunched.image(fixture.url, pixelSize: 384, policy: .disk)
        XCTAssertNotNil(cached)
        XCTAssertEqual(fixture.requests.count, 1)
    }

    func testSearchImageIsEphemeralUntilRetained() async throws {
        let fixture = makeFixture(width: 1024)
        let root = temporaryDirectory()
        let store = makeStore(fixture, root: root)
        let initial = await store.image(fixture.url, pixelSize: 160, policy: .memory)
        XCTAssertNotNil(initial)
        fixture.failure = URLError(.notConnectedToInternet)
        let relaunched = makeStore(fixture, root: root)
        let absent = await relaunched.image(fixture.url, pixelSize: 160, policy: .memory)
        XCTAssertNil(absent)
        fixture.failure = nil
        await store.retain([fixture.url], accountID: "listener")
        fixture.failure = URLError(.notConnectedToInternet)
        let retained = makeStore(fixture, root: root)
        let available = await retained.image(fixture.url, pixelSize: 1024)
        XCTAssertEqual(available?.cgImage?.width, 1024)
    }

    func testRetentionPrefetchesAndSurvivesZeroBrowsingBudget() async throws {
        let fixture = makeFixture(width: 1024)
        let root = temporaryDirectory()
        let store = makeStore(fixture, root: root, diskBudget: 0)
        await store.retain([fixture.url], accountID: "listener")
        XCTAssertEqual(fixture.requests.count, 1)
        fixture.failure = URLError(.notConnectedToInternet)
        let relaunched = makeStore(fixture, root: root, diskBudget: 0)
        let image = await relaunched.image(fixture.url, pixelSize: 1024)
        XCTAssertNotNil(image)
        XCTAssertEqual(fixture.requests.count, 1)
        await relaunched.retain([], accountID: "listener")
        let unretained = makeStore(fixture, root: root, diskBudget: 0)
        let removed = await unretained.image(fixture.url, pixelSize: 1024)
        XCTAssertNil(removed)
    }

    func testBrowsingPromotesSearchArtworkAlreadyDecodedAtSameSize() async throws {
        let fixture = makeFixture(width: 384)
        let root = temporaryDirectory()
        let store = makeStore(fixture, root: root)
        let search = await store.image(fixture.url, pixelSize: 160, policy: .memory)
        XCTAssertNotNil(search)
        let discover = await store.image(fixture.url, pixelSize: 160, policy: .disk)
        XCTAssertNotNil(discover)
        fixture.failure = URLError(.notConnectedToInternet)
        let relaunched = makeStore(fixture, root: root)
        let offline = await relaunched.image(fixture.url, pixelSize: 160)
        XCTAssertNotNil(offline)
        XCTAssertEqual(fixture.requests.count, 1)
    }

    func testStaleSmallFrameRefreshKeepsLargeOfflineVariant() async throws {
        let fixture = makeFixture(width: 1024)
        fixture.headers = ["ETag": "\"large\"", "Cache-Control": "max-age=3600"]
        var components = URLComponents(string: "https://assets.podcst.app/")!
        components.queryItems = [URLQueryItem(name: "p", value: fixture.url.absoluteString)]
        let url = try XCTUnwrap(components.url)
        let root = temporaryDirectory()
        let store = makeStore(fixture, root: root)
        let initial = await store.image(url, pixelSize: 1024)
        XCTAssertEqual(initial?.cgImage?.width, 1024)
        let later = makeStore(fixture, root: root, now: Date(timeIntervalSince1970: 100_000_000))
        let row = await later.image(url, pixelSize: 160)
        XCTAssertEqual(row?.cgImage?.width, 160)
        try await wait { fixture.requests.count >= 2 }
        let refreshed = try XCTUnwrap(fixture.requests.last?.url)
        let query = URLComponents(url: refreshed, resolvingAgainstBaseURL: false)?.queryItems
        XCTAssertEqual(query?.first { $0.name == "w" }?.value, "1024")
        try await wait { later.revision >= 2 }
        fixture.failure = URLError(.notConnectedToInternet)
        let relaunched = makeStore(fixture, root: root)
        let player = await relaunched.image(url, pixelSize: 1024)
        XCTAssertEqual(player?.cgImage?.width, 1024)
    }

    func testMissingOrCorruptBodyDoesNotSendValidatorWithoutImage() async throws {
        for corrupt in [false, true] {
            let fixture = makeFixture(width: 384)
            fixture.headers = ["ETag": "\"cover\""]
            let root = temporaryDirectory()
            let store = makeStore(fixture, root: root)
            let initial = await store.image(fixture.url, pixelSize: 384)
            XCTAssertNotNil(initial)
            let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)?.allObjects as? [URL] ?? []
            let imageFile = try XCTUnwrap(files.first { $0.pathExtension == "image" })
            if corrupt { try Data("broken".utf8).write(to: imageFile) }
            else { try FileManager.default.removeItem(at: imageFile) }
            let relaunched = makeStore(fixture, root: root)
            let repaired = await relaunched.image(fixture.url, pixelSize: 384)
            XCTAssertNotNil(repaired)
            XCTAssertNil(fixture.requests.last?.value(forHTTPHeaderField: "If-None-Match"))
        }
    }

    func testStaleImageReturnsWhileValidatorRefreshIsPending() async throws {
        let fixture = makeFixture(width: 384)
        fixture.headers = ["ETag": "\"cover-1\"", "Cache-Control": "max-age=3600"]
        let root = temporaryDirectory()
        let store = makeStore(fixture, root: root)
        let original = await store.image(fixture.url, pixelSize: 384)
        XCTAssertNotNil(original)
        fixture.status = 304
        fixture.holdResponses = true
        let later = makeStore(fixture, root: root, now: Date(timeIntervalSince1970: 100_000_000))
        let stale = await later.image(fixture.url, pixelSize: 384)
        XCTAssertNotNil(stale)
        try await wait { fixture.requests.count == 2 }
        XCTAssertEqual(fixture.requests.last?.value(forHTTPHeaderField: "If-None-Match"), "\"cover-1\"")
        fixture.releaseResponses()
        let stillAvailable = await later.image(fixture.url, pixelSize: 384)
        XCTAssertNotNil(stillAvailable)
    }

    func testFailedRefreshPreservesOfflineArtwork() async throws {
        let fixture = makeFixture(width: 384)
        let root = temporaryDirectory()
        let store = makeStore(fixture, root: root)
        await store.retain([fixture.url], accountID: "listener")
        fixture.failure = URLError(.notConnectedToInternet)
        let later = makeStore(fixture, root: root, now: Date(timeIntervalSince1970: 100_000_000))
        let stale = await later.image(fixture.url, pixelSize: 384)
        XCTAssertNotNil(stale)
        try await wait { fixture.requests.count >= 2 }
        let relaunched = makeStore(fixture, root: root)
        let preserved = await relaunched.image(fixture.url, pixelSize: 384)
        XCTAssertNotNil(preserved)
    }

    func testFastRevalidationIssuesOneConditionalRequest() async throws {
        let fixture = makeFixture(width: 384)
        fixture.headers = ["ETag": "\"cover-1\"", "Cache-Control": "max-age=3600"]
        let root = temporaryDirectory()
        let store = makeStore(fixture, root: root)
        let initial = await store.image(fixture.url, pixelSize: 384)
        XCTAssertNotNil(initial)
        fixture.status = 304
        let later = makeStore(fixture, root: root, now: Date(timeIntervalSince1970: 100_000_000))
        let stale = await later.image(fixture.url, pixelSize: 384)
        XCTAssertNotNil(stale)
        try await wait { later.revision >= 2 }
        XCTAssertEqual(fixture.requests.count, 2)
    }

    func testAccountSwitchRejectsOldRetentionAndRemovesPrivateArtwork() async throws {
        let fixture = makeFixture(width: 1024)
        let root = temporaryDirectory()
        let store = makeStore(fixture, root: root)
        await store.retain([fixture.url], accountID: "listener")
        await store.switchAccount(to: "other-listener")
        await store.retain([fixture.url], accountID: "listener")
        XCTAssertEqual(fixture.requests.count, 1)
        fixture.failure = URLError(.notConnectedToInternet)
        let otherAccount = await store.image(fixture.url, pixelSize: 1024)
        XCTAssertNil(otherAccount)
        await store.switchAccount(to: "listener")
        let oldAccount = await store.image(fixture.url, pixelSize: 1024)
        XCTAssertNil(oldAccount)
    }

    func testAccountSwitchCancelsOldTransferWithoutRecreatingPurgedStorage() async throws {
        let fixture = makeFixture(width: 1024)
        fixture.holdResponses = true
        let store = makeStore(fixture)
        let pending = Task { await store.image(fixture.url, pixelSize: 1024) }
        try await wait { fixture.requests.count == 1 }
        await store.switchAccount(to: "other-listener")
        fixture.releaseResponses()
        let cancelled = await pending.value
        XCTAssertNil(cancelled)
        fixture.failure = URLError(.notConnectedToInternet)
        await store.switchAccount(to: "listener")
        let old = await store.image(fixture.url, pixelSize: 1024)
        XCTAssertNil(old)
    }

    func testPrivateURLsRemainUnchangedAndShareExistingProxyIdentity() async throws {
        let fixture = makeFixture(width: 384)
        let direct = fixture.url.appending(queryItems: [URLQueryItem(name: "token", value: "private-token")])
        let store = makeStore(fixture)
        let image = await store.image(direct, pixelSize: 160)
        XCTAssertNotNil(image)
        XCTAssertEqual(fixture.requests.first?.url, direct)
        var components = URLComponents(string: "https://assets.podcst.app/")!
        components.queryItems = [URLQueryItem(name: "p", value: direct.absoluteString)]
        let reused = await store.image(components.url, pixelSize: 160)
        XCTAssertNotNil(reused)
        XCTAssertEqual(fixture.requests.count, 1)
    }

    func testExistingAssetProxyRequestsFrameSizedVariant() async throws {
        let fixture = makeFixture(width: 1024)
        var components = URLComponents(string: "https://assets.podcst.app/")!
        components.queryItems = [URLQueryItem(name: "p", value: fixture.url.absoluteString)]
        let store = makeStore(fixture)
        let image = await store.image(components.url, pixelSize: 160)
        XCTAssertEqual(image?.cgImage?.width, 160)
        let requested = try XCTUnwrap(fixture.requests.first?.url)
        let query = try XCTUnwrap(URLComponents(url: requested, resolvingAgainstBaseURL: false)?.queryItems)
        XCTAssertEqual(query.first { $0.name == "w" }?.value, "160")
        XCTAssertEqual(query.first { $0.name == "p" }?.value, fixture.url.absoluteString)
    }

    func testResizingPreservesEncodedSignedSourceQuery() throws {
        let locator = "https://assets.podcst.app/?p=https%3A%2F%2Fcdn.example.test%2Fcover%3Fsignature%3Da%2Bb%252F%26token%3Dz&w=384"
        let source = try XCTUnwrap(URL(string: locator))
        let resized = ArtworkSource.requestURL(source, pixelSize: 160)
        XCTAssertEqual(resized.absoluteString, locator.replacingOccurrences(of: "&w=384", with: "&w=160"))
    }

    func testLockScreenRequestsUseDecodedArtworkOnBackgroundQueue() async throws {
        let image = try XCTUnwrap(UIImage(data: png(width: 1024)))
        let result = await Task.detached {
            let artwork = makeNowPlayingArtwork(image: image)
            return (artwork.image(at: CGSize(width: 128, height: 128))?.size,
                    artwork.image(at: CGSize(width: 2048, height: 2048))?.size)
        }.value
        XCTAssertEqual(result.0, CGSize(width: 128, height: 128))
        XCTAssertEqual(result.1, CGSize(width: 1024, height: 1024))
    }

    private func makeStore(_ fixture: ArtworkFixture, root: URL? = nil, diskBudget: Int = 64 * 1024 * 1024, now: Date = Date(timeIntervalSince1970: 100)) -> ArtworkStore {
        ArtworkStore(accountID: "listener", rootURL: root ?? temporaryDirectory(), session: fixture.session, now: { now }, diskBudget: diskBudget)
    }

    private func makeFixture(width: Int, height: Int? = nil) -> ArtworkFixture {
        let fixture = ArtworkFixture(data: png(width: width, height: height))
        ArtworkTestProtocol.register(fixture)
        addTeardownBlock { ArtworkTestProtocol.unregister(fixture) }
        return fixture
    }

    private func proxyURL(for fixture: ArtworkFixture) -> URL {
        var components = URLComponents(string: "https://assets.podcst.app/")!
        components.queryItems = [URLQueryItem(name: "p", value: fixture.url.absoluteString)]
        return components.url!
    }

    private func png(width: Int, height: Int? = nil) -> Data {
        let height = height ?? width
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format).pngData { context in
            UIColor.systemOrange.setFill()
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
    }

    private func temporaryDirectory() -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    private func wait(_ predicate: () -> Bool) async throws {
        for _ in 0..<200 {
            if predicate() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Expected artwork request did not arrive")
    }
}

private final class ArtworkFixture: @unchecked Sendable {
    let url = URL(string: "https://\(UUID().uuidString.lowercased()).example.test/cover.png")!
    private let lock = NSLock()
    private var body: Data
    private var recorded: [URLRequest] = []
    private var pending: [ArtworkTestProtocol] = []
    private var held = false
    private var error: URLError?
    private var code = 200
    private var fields: [String: String] = [:]

    init(data: Data) { body = data }

    var requests: [URLRequest] { lock.withLock { recorded } }
    var data: Data {
        get { lock.withLock { body } }
        set { lock.withLock { body = newValue } }
    }
    var holdResponses: Bool {
        get { lock.withLock { held } }
        set { lock.withLock { held = newValue } }
    }
    var failure: URLError? {
        get { lock.withLock { error } }
        set { lock.withLock { error = newValue } }
    }
    var status: Int {
        get { lock.withLock { code } }
        set { lock.withLock { code = newValue } }
    }
    var headers: [String: String] {
        get { lock.withLock { fields } }
        set { lock.withLock { fields = newValue } }
    }
    var session: URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ArtworkTestProtocol.self]
        configuration.urlCache = nil
        return URLSession(configuration: configuration)
    }

    func receive(_ task: ArtworkTestProtocol) {
        let held = lock.withLock {
            recorded.append(task.request)
            if self.held { pending.append(task) }
            return self.held
        }
        if !held { respond(task) }
    }

    func releaseResponses() {
        let tasks = lock.withLock {
            held = false
            defer { pending.removeAll() }
            return pending
        }
        tasks.forEach(respond)
    }

    private func respond(_ task: ArtworkTestProtocol) {
        let response = lock.withLock { (error, code, fields) }
        task.respond(data: data, error: response.0, status: response.1, headers: response.2)
    }
}

private final class ArtworkTestProtocol: URLProtocol, @unchecked Sendable {
    private static let registry = ArtworkFixtureRegistry()
    private let lock = NSLock()
    private var stopped = false

    static func register(_ fixture: ArtworkFixture) { registry.insert(fixture) }
    static func unregister(_ fixture: ArtworkFixture) { registry.remove(fixture) }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let source = request.url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }?
            .queryItems?.first { $0.name == "p" }?.value.flatMap(URL.init(string:))
        guard let host = source?.host ?? request.url?.host, let fixture = Self.registry.fixture(host) else {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotFindHost))
            return
        }
        fixture.receive(self)
    }

    override func stopLoading() { lock.withLock { stopped = true } }

    func respond(data: Data, error: URLError?, status: Int, headers: [String: String]) {
        guard !lock.withLock({ stopped }) else { return }
        if let error {
            client?.urlProtocol(self, didFailWithError: error)
        } else if let url = request.url, let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: headers.merging(["Content-Type": "image/png"]) { existing, _ in existing }) {
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            if status != 304 { client?.urlProtocol(self, didLoad: data) }
            client?.urlProtocolDidFinishLoading(self)
        }
    }
}

private final class ArtworkFixtureRegistry: @unchecked Sendable {
    private let lock = NSLock()
    private var fixtures: [String: ArtworkFixture] = [:]
    func insert(_ fixture: ArtworkFixture) { lock.withLock { fixtures[fixture.url.host!] = fixture } }
    func remove(_ fixture: ArtworkFixture) { lock.withLock { fixtures[fixture.url.host!] = nil } }
    func fixture(_ host: String) -> ArtworkFixture? { lock.withLock { fixtures[host] } }
}
