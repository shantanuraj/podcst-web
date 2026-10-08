import Foundation
import XCTest
@testable import Podcst

@MainActor
final class ContractFixtureTests: XCTestCase {
    func testAPIContractFixturesAreConsumed() async throws {
        let root = contractRoot().appendingPathComponent("fixtures/api")
        let index = try JSONDecoder().decode([String: APIFixture].self, from: Data(contentsOf: root.appendingPathComponent("index.json")))
        let files = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" && $0.lastPathComponent != "index.json" }
            .map(\URL.lastPathComponent)
        XCTAssertEqual(Set(files), Set(index.keys))

        for name in index.keys.sorted() {
            let fixture = index[name]!
            let data = try Data(contentsOf: root.appendingPathComponent(name))
            if try await consumeStandalone(data: data, name: name, fixture: fixture) { continue }

            let credentials = ContractCredentials(value: "fixture-session")
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [ContractURLProtocol.self]
            let api = APIClient(
                baseURL: URL(string: "https://fixture-\(UUID().uuidString).example.test")!,
                session: URLSession(configuration: configuration),
                keychain: credentials
            )
            var responses = [ContractResponse(status: fixture.status, data: data)]
            if name == "auth-email-login.verified.json" {
                responses.append(ContractResponse(status: 200, data: try Data(contentsOf: root.appendingPathComponent("auth-session.user.json"))))
            } else if name == "feed-resolve.resolved.json" {
                responses.append(ContractResponse(status: 200, data: try Data(contentsOf: root.appendingPathComponent("feed.id.json"))))
            }
            ContractURLProtocol.install(responses)
            defer {
                ContractURLProtocol.reset()
                api.clearSession()
            }

            let failure: Error?
            do {
                try await consume(fixture: fixture, name: name, api: api)
                failure = nil
            } catch {
                failure = error
            }

            if (200..<300).contains(fixture.status) {
                XCTAssertNil(failure, "\(name): \(String(describing: failure))")
            } else {
                let apiError = try XCTUnwrap(failure as? APIError, name)
                XCTAssertEqual(apiError.statusCode, fixture.status, name)
                let expected = try JSONDecoder().decode(ErrorFixture.self, from: data).message
                XCTAssertEqual(apiError.message, expected, name)
            }

            let request = try XCTUnwrap(ContractURLProtocol.requests().first, name)
            let parts = fixture.endpoint.split(separator: " ", maxSplits: 1).map(String.init)
            XCTAssertEqual(request.httpMethod, parts[0], name)
            XCTAssertEqual(request.url?.path, parts[1], name)
        }
    }

    func testStrictCatalogueWireAndNumericStarBridgeAreSeparate() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ContractURLProtocol.self]
        let api = APIClient(baseURL: URL(string: "https://wire.example.invalid")!, session: URLSession(configuration: configuration), keychain: ContractCredentials(value: "synthetic"))
        defer { ContractURLProtocol.reset() }
        let podcast = #"{"id":"9223372036854775807","feed":"fixture","title":"Fixture","author":"","cover":"","description":"","explicit":false,"keywords":[],"episodeCount":0}"#
        ContractURLProtocol.install([ContractResponse(status: 200, data: Data(podcast.utf8))])
        let decoded = try await api.podcastInfo(id: Int.max)
        XCTAssertEqual(decoded.id, Int.max)
        ContractURLProtocol.install([ContractResponse(status: 200, data: Data(podcast.replacingOccurrences(of: #""9223372036854775807""#, with: "9223372036854775807").utf8))])
        do { _ = try await api.podcastInfo(id: Int.max); XCTFail("Numeric wire identity must be rejected") } catch {}

        let scope = StateScope(accountId: "fixture-account", generation: "17adbd84-d0e4-4e2d-ad9f-b084efee3211")
        let client = "a7a2e014-b64f-4487-9c92-71cd59fc0cf7"
        let response = #"{"protocol":1,"accountId":"fixture-account","generation":"17adbd84-d0e4-4e2d-ad9f-b084efee3211","clientId":"a7a2e014-b64f-4487-9c92-71cd59fc0cf7","sequence":"1","listId":"starred","revision":"1","results":[{"episodeId":"9007199254740993","status":"applied"}]}"#
        ContractURLProtocol.install([ContractResponse(status: 200, data: Data(response.utf8))])
        let ack = try await api.changeList(id: "starred", batch: ListBatch(scope: scope, clientId: client, sequence: "1", changes: [ListChange(op: .add, episodeId: 9_007_199_254_740_993)]))
        XCTAssertEqual(ack.results.first?.episodeId, 9_007_199_254_740_993)
        let request = try XCTUnwrap(ContractURLProtocol.requests().last)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: requestData(request)) as? [String: Any])
        XCTAssertEqual((body["changes"] as? [[String: Any]])?.first?["episodeId"] as? String, "9007199254740993")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Podcst-Client"), "native")

        ContractURLProtocol.install([ContractResponse(status: 200, data: Data(response.replacingOccurrences(of: "9007199254740993", with: "42").utf8))])
        let legacy = ListBatch(clientId: client, sequence: "1", changes: [ListChange(op: .add, episodeId: 42)])
        _ = try await api.migrateList(id: "starred", batch: legacy, scope: scope)
        let migration = try XCTUnwrap(ContractURLProtocol.requests().last)
        XCTAssertEqual(migration.url?.path, "/api/lists/starred/migration")
        let wrapper = try XCTUnwrap(JSONSerialization.jsonObject(with: requestData(migration)) as? [String: Any])
        let embedded = try XCTUnwrap(wrapper["batch"] as? NSDictionary)
        XCTAssertEqual(embedded, try JSONSerialization.jsonObject(with: JSONEncoder().encode(legacy)) as? NSDictionary)
        XCTAssertTrue(((wrapper["batch"] as? [String: Any])?["changes"] as? [[String: Any]])?.first?["episodeId"] is NSNumber)
    }

    private func requestData(_ request: URLRequest) throws -> Data {
        if let data = request.httpBody { return data }
        let stream = try XCTUnwrap(request.httpBodyStream)
        stream.open(); defer { stream.close() }
        var data = Data(); var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; data.append(buffer, count: count) }
        return data
    }

    func testStateWireFixturesRoundTripExactly() throws {
        let data = try contractData("state/fixtures.json")
        let fixtures = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        func roundTrip<T: Codable>(_ key: String, _ type: T.Type) throws -> T {
            let original = try XCTUnwrap(fixtures[key])
            let value = try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: original))
            let encoded = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? NSDictionary)
            XCTAssertEqual(encoded, original as? NSDictionary, key)
            return value
        }
        let progress = try roundTrip("progressBatch", StateBatch<StateProgressChange>.self)
        XCTAssertEqual(progress.changes.first?.episodeId.value, "9007199254740993")
        XCTAssertEqual(progress.changes.last?.episodeId.value, "9223372036854775807")
        _ = try roundTrip("followBatch", StateBatch<StateFollowChange>.self)
        let acknowledgement = try roundTrip("progressAcknowledgement", StateAcknowledgement<StateProgressResult>.self)
        XCTAssertEqual(acknowledgement.sequence.value, "9007199254740993")
        XCTAssertEqual(acknowledgement.revision.value, "9007199254740994")
        _ = try roundTrip("followAcknowledgement", StateAcknowledgement<StateFollowResult>.self)
        let snapshot = try roundTrip("progressSnapshot", StateSnapshot<StateProgressItem>.self)
        XCTAssertNil(snapshot.items.last?.progress)
        _ = try roundTrip("followSnapshot", StateSnapshot<StateFollowItem>.self)
        _ = try roundTrip("error", StateErrorBody.self)
        for scalar in try XCTUnwrap(fixtures["scalars"] as? [[String: Any]]) {
            let value = try JSONSerialization.data(withJSONObject: scalar["value"]!, options: .fragmentsAllowed)
            XCTAssertEqual((try? JSONDecoder().decode(StateID.self, from: value)) != nil, scalar["id"] as? Bool)
            XCTAssertEqual((try? JSONDecoder().decode(StateRevision.self, from: value)) != nil, scalar["revision"] as? Bool)
        }
        let missing = Data(#"{"episodeId":"1"}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(StateProgressItem.self, from: missing))
    }

    func testStateCompletionVectorsMatch() throws {
        struct Vector: Decodable {
            var name: String
            var event: StateProgressEvent
            var positionSeconds: Int
            var previousCompleted: Bool
            var expectedCompleted: Bool
            var expectedPositionSeconds: Int
        }
        struct Vectors: Decodable { var completion: [Vector] }
        let vectors = try JSONDecoder().decode(Vectors.self, from: contractData("state/fixtures.json"))
        for vector in vectors.completion {
            let intent = try vector.event.intent(positionSeconds: vector.positionSeconds, previousCompleted: vector.previousCompleted)
            XCTAssertEqual(intent.positionSeconds, vector.expectedPositionSeconds, vector.name)
            XCTAssertEqual(intent.completed, vector.expectedCompleted, vector.name)
        }
        XCTAssertThrowsError(try StateProgressEvent.checkpoint.intent(positionSeconds: -1, previousCompleted: false))
        XCTAssertThrowsError(try StateProgressEvent.checkpoint.intent(positionSeconds: Int(Int32.max) + 1, previousCompleted: false))
    }

    func testPreferenceVectorsMatch() throws {
        let vectors = try JSONDecoder().decode(PreferenceVectors.self, from: contractData("playback/preferences.json"))
        for vector in vectors.cases {
            let preferences = AudioPreferences()
            for step in vector.steps {
                switch step.op {
                case "set":
                    preferences.set(step.options!.value, for: step.feed)
                case "setRate":
                    guard let speed = step.speed, PlaybackController.supportedRates.contains(where: { abs($0 - speed) < 0.0001 }) else { continue }
                    var options = preferences.options(for: step.currentFeed)
                    options.speed = speed
                    let feed = step.currentFeed.flatMap { preferences.hasOverride(for: $0) ? $0 : nil }
                    preferences.set(options, for: feed)
                case "useDefaults":
                    preferences.useDefaults(for: step.feed!)
                case "restore":
                    preferences.set(step.defaults!.value)
                    for (feed, options) in step.overrides! { preferences.set(options.value, for: feed) }
                default:
                    XCTFail("Unknown preference operation \(step.op)")
                }
            }

            XCTAssertEqual(preferences.defaults, vector.expected.defaults.value, vector.name)
            XCTAssertEqual(preferences.overrides.count, vector.expected.overrides.count, vector.name)
            for (feed, options) in vector.expected.overrides {
                XCTAssertTrue(preferences.hasOverride(for: feed), "\(vector.name) \(feed)")
                XCTAssertEqual(preferences.options(for: feed), options.value, "\(vector.name) \(feed)")
            }
            for (feed, options) in vector.expected.effective {
                XCTAssertEqual(preferences.options(for: feed), options.value, "\(vector.name) \(feed)")
            }
        }
    }

    func testShowNotesVectorsMatch() throws {
        let vectors = try JSONDecoder().decode(ShowNotesVectors.self, from: contractData("playback/shownotes.json"))
        for vector in vectors.chapters {
            let expected = vector.expected.map { Chapter(title: $0.title, start: $0.start) }
            XCTAssertEqual(ShowNotesParser.chapters(vector.html), expected, vector.html)
        }
        for vector in vectors.timestamps {
            XCTAssertEqual(ShowNotesParser.timestamps(vector.text), vector.expected, vector.text)
        }
        for vector in vectors.seconds {
            XCTAssertEqual(ShowNotesParser.seconds(from: vector.timestamp), vector.expected, vector.timestamp)
        }
    }

    func testReleaseVectorsMatch() throws {
        let vectors = try JSONDecoder().decode(ReleaseVectors.self, from: contractData("playback/releases.json"))
        for vector in vectors.sections {
            let episodes = vector.episodes.map { releaseEpisode(id: $0.id, published: $0.published) }
            let sections = ReleaseSection.grouping(episodes)
            let expectedDates = vector.expected.map { $0.day.map { date($0 + "T00:00:00Z") } }
            XCTAssertEqual(sections.map(\.episodes).map { $0.map(\.guid) }, vector.expected.map(\.episodes), vector.name)
            XCTAssertEqual(sections.map(\.date), expectedDates, vector.name)
            XCTAssertEqual(sections.map { $0.title(relativeTo: date(vector.now), locale: Locale(identifier: vector.locale)) }, vector.expected.map(\.title), vector.name)
            XCTAssertEqual(sections.map { $0.isRecent(relativeTo: date(vector.now)) }, vector.expected.map(\.recent), vector.name)
        }

        for vector in vectors.newReleases {
            let suiteName = "contract-\(UUID().uuidString)"
            let defaults = UserDefaults(suiteName: suiteName)!
            let api = APIClient(keychain: ContractCredentials(value: nil))
            let session = SessionStore(api: api, storageURL: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
            let podcasts = vector.podcasts.map { podcast in
                Podcast(
                    feed: podcast.feed,
                    title: podcast.feed,
                    episodes: podcast.episodes.map { releaseEpisode(id: $0.id, published: $0.published) }
                )
            }
            defaults.set(try JSONEncoder().encode(podcasts), forKey: "guest.library.podcasts")
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: directory) }
            let library = LibraryStore(api: api, session: session, defaults: defaults, progressDirectory: directory)
            XCTAssertEqual(library.newReleases.map(\.guid), vector.expected, vector.name)
            defaults.removePersistentDomain(forName: suiteName)
        }
    }

    private func consumeStandalone(data: Data, name: String, fixture: APIFixture) async throws -> Bool {
        guard fixture.type == "RefreshStatus" || fixture.type == "ResolvedPodcast" || fixture.endpoint.contains("/api/auth/login") || fixture.endpoint.contains("/api/auth/register") || (fixture.endpoint == "POST /api/auth/verify" && fixture.type == "Verified") else { return false }
        switch fixture.type {
        case "ErrorMessage": _ = try JSONDecoder().decode(ErrorFixture.self, from: data)
        case "RefreshStatus": _ = try JSONDecoder().decode(RefreshStatusFixture.self, from: data)
        case "ResolvedPodcast": _ = try JSONDecoder().decode(ResolvedPodcastFixture.self, from: data)
        case "PasskeyLoginStart": _ = try JSONDecoder().decode(PasskeyLoginStartFixture.self, from: data)
        case "PasskeyLoginResult": _ = try JSONDecoder().decode(PasskeyLoginResultFixture.self, from: data)
        case "PasskeyRegistrationStart": _ = try JSONDecoder().decode(PasskeyRegistrationStartFixture.self, from: data)
        case "PasskeyRegistrationResult": _ = try JSONDecoder().decode(PasskeyRegistrationResultFixture.self, from: data)
        case "Verified": _ = try JSONDecoder().decode(VerifiedFixture.self, from: data)
        case "Success": _ = try JSONDecoder().decode(SuccessFixture.self, from: data)
        default: XCTFail("Unknown standalone fixture type \(fixture.type) for \(name)")
        }
        return true
    }

    private func consume(fixture: APIFixture, name: String, api: APIClient) async throws {
        let scope = StateScope(accountId: "fixture-account-a", generation: "17adbd84-d0e4-4e2d-ad9f-b084efee3211")
        let client = "a7a2e014-b64f-4487-9c92-71cd59fc0cf7"
        switch fixture.endpoint {
        case "GET /api/top": _ = try await api.top(locale: "fixture-\(UUID().uuidString)")
        case "POST /api/search": _ = try await api.search(term: "fixture", locale: "us")
        case "GET /api/feed": _ = try await api.podcast(id: 910001)
        case "POST /api/feed": _ = try await api.podcast(feed: "https://fixture.example/feed.xml")
        case "GET /api/feed/info": _ = try await api.podcastInfo(id: 910001)
        case "GET /api/feed/episodes": _ = try await api.episodes(podcastID: 910001)
        case "POST /api/feed/resolve":
            _ = try await api.detail(of: Podcast(itunesId: 910001, itunesLocale: "us", feed: "https://fixture.example/feed.xml", title: "Fixture"))
        case "POST /api/feed/refresh": _ = try await api.refresh(podcastID: 910001)
        case "GET /api/auth/session": _ = try await api.sessionUser()
        case "POST /api/auth/verify": try await api.sendCode(email: "fixture@example.test")
        case "POST /api/auth/email-login": _ = try await api.signIn(email: "fixture@example.test", code: "123456")
        case "POST /api/auth/logout": await api.signOut()
        case "GET /api/subscriptions": _ = try await api.subscriptions()
        case "POST /api/subscriptions":
            _ = try await api.changeFollows(StateBatch(protocol: 1, accountId: scope.accountId, generation: scope.generation, clientId: client, sequence: StateID("1"), changes: [StateFollowChange(podcastId: StateID("910001"), followed: true)]))
        case "POST /api/subscriptions/resolve": _ = try await api.resolveFollows(["https://fixture.example/feed.xml"], scope: scope)
        case "GET /api/progress": _ = try await api.currentProgress()
        case "PUT /api/progress": _ = try await api.changeProgress(StateBatch(protocol: 1, accountId: scope.accountId, generation: scope.generation, clientId: client, sequence: StateID("1"), changes: [StateProgressChange(episodeId: StateID("910001"), positionSeconds: 12, completed: false)]))
        case "GET /api/lists":
            let lists = try await api.lists()
            XCTAssertEqual(lists.lists.first?.revision, "9007199254740993")
        case "GET /api/lists/:id/items":
            if fixture.type == "ListSnapshot" {
                let snapshot = try await api.listMembership(id: ":id")
                XCTAssertEqual(snapshot.revision, "9007199254740993")
                XCTAssertEqual(snapshot.items.map(\.availability), [.available, .contentMissing, .unavailable])
            } else {
                let page = try await api.listEpisodes(id: ":id")
                XCTAssertEqual(page.items.first?.episode?.id, 910001)
                XCTAssertNil(page.items.last?.episode)
                XCTAssertNil(page.nextCursor)
            }
        case "POST /api/lists/:id/changes":
            let result = try await api.changeList(id: ":id", batch: ListBatch(scope: scope, clientId: "a7a2e014-b64f-4487-9c92-71cd59fc0cf7", sequence: "9007199254740993", changes: [ListChange(op: .add, episodeId: 910001), ListChange(op: .remove, episodeId: 910002), ListChange(op: .add, episodeId: 910003)]))
            XCTAssertEqual(result.sequence, "9007199254740993")
            XCTAssertEqual(result.results.map(\.status), [.applied, .unchanged, .notFound])
        case "GET /api/account": _ = try await api.account()
        case "PUT /api/account/preferences": _ = try await api.savePreferences(AudioOptions(speed: 1.5, effects: AudioEffects(volumeBoost: true)))
        case "DELETE /api/account/passkeys/:id": try await api.removePasskey(id: ":id")
        default: XCTFail("Unmapped endpoint \(fixture.endpoint) in \(name)")
        }
    }

    private func contractRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("contracts")
    }

    private func contractData(_ path: String) throws -> Data {
        try Data(contentsOf: contractRoot().appendingPathComponent(path))
    }

    private func date(_ value: String) -> Date {
        ISO8601DateFormatter().date(from: value)!
    }

    private func releaseEpisode(id: String, published: String?) -> Episode {
        Episode(guid: id, feed: "https://example.com/feed.xml", title: id, published: published.map(date), file: EpisodeFile(url: "https://example.com/\(id).mp3"))
    }
}

private struct APIFixture: Decodable {
    let endpoint: String
    let status: Int
    let type: String

    enum CodingKeys: String, CodingKey {
        case endpoint
        case status
        case type = "decodesAs"
    }
}

private struct ErrorFixture: Decodable { let message: String }
private struct RefreshStatusFixture: Decodable { let status: String }
private struct ResolvedPodcastFixture: Decodable { let id: StateID }
private struct SuccessFixture: Decodable { let success: Bool }
private struct VerifiedFixture: Decodable { let verified: Bool }
private struct PasskeyLoginResultFixture: Decodable { let verified: Bool; let userId: String? }
private struct PasskeyRegistrationResultFixture: Decodable { let verified: Bool }
private struct PasskeyLoginStartFixture: Decodable {
    let flowId: String
    let options: PasskeyLoginOptionsFixture
}
private struct PasskeyLoginOptionsFixture: Decodable {
    let rpId: String?
    let challenge: String
    let allowCredentials: [PasskeyDescriptorFixture]?
    let timeout: Int?
    let userVerification: String?
}
private struct PasskeyRegistrationStartFixture: Decodable { let flowId: String; let options: PasskeyRegistrationOptionsFixture }
private struct PasskeyRegistrationOptionsFixture: Decodable {
    let challenge: String
    let rp: RegistrationRelyingPartyFixture
    let user: RegistrationUserFixture
    let pubKeyCredParams: [RegistrationParameterFixture]
    let timeout: Int?
    let attestation: String?
    let excludeCredentials: [PasskeyDescriptorFixture]?
    let authenticatorSelection: AuthenticatorSelectionFixture?
    let extensions: RegistrationExtensionsFixture?
    let hints: [String]?
}
private struct PasskeyDescriptorFixture: Decodable { let id: String; let type: String? }
private struct RegistrationRelyingPartyFixture: Decodable { let name: String; let id: String? }
private struct RegistrationUserFixture: Decodable { let id: String; let name: String; let displayName: String }
private struct RegistrationParameterFixture: Decodable { let alg: Int; let type: String }
private struct AuthenticatorSelectionFixture: Decodable { let residentKey: String?; let userVerification: String?; let requireResidentKey: Bool? }
private struct RegistrationExtensionsFixture: Decodable { let credProps: Bool? }

private struct PreferenceVectors: Decodable { let cases: [PreferenceCase] }
private struct PreferenceCase: Decodable {
    let name: String
    let steps: [PreferenceStep]
    let expected: PreferenceExpected
}
private struct PreferenceStep: Decodable {
    let op: String
    let feed: String?
    let currentFeed: String?
    let speed: Double?
    let options: VectorOptions?
    let defaults: VectorOptions?
    let overrides: [String: VectorOptions]?
}
private struct PreferenceExpected: Decodable {
    let defaults: VectorOptions
    let overrides: [String: VectorOptions]
    let effective: [String: VectorOptions]
}
private struct VectorOptions: Codable {
    let speed: Double
    let volumeBoost: Bool
    let trimSilence: Bool

    var value: AudioOptions { AudioOptions(speed: speed, effects: AudioEffects(volumeBoost: volumeBoost, trimSilence: trimSilence)) }
}

private struct ShowNotesVectors: Decodable {
    let chapters: [ChapterVector]
    let timestamps: [TimestampVector]
    let seconds: [SecondsVector]
}
private struct ChapterVector: Decodable { let html: String; let expected: [ExpectedChapter] }
private struct ExpectedChapter: Decodable { let title: String; let start: Double }
private struct TimestampVector: Decodable { let text: String; let expected: [String] }
private struct SecondsVector: Decodable { let timestamp: String; let expected: Double? }

private struct ReleaseVectors: Decodable {
    let newReleases: [NewReleasesVector]
    let sections: [ReleaseSectionsVector]
}
private struct NewReleasesVector: Decodable {
    let name: String
    let podcasts: [ReleasePodcastVector]
    let expected: [String]
}
private struct ReleasePodcastVector: Decodable { let feed: String; let episodes: [ReleaseEpisodeVector] }
private struct ReleaseEpisodeVector: Decodable { let id: String; let published: String? }
private struct ReleaseSectionsVector: Decodable {
    let name: String
    let now: String
    let locale: String
    let episodes: [ReleaseEpisodeVector]
    let expected: [ReleaseSectionVector]
}
private struct ReleaseSectionVector: Decodable {
    let day: String?
    let title: String
    let recent: Bool
    let episodes: [String]
}

@MainActor
final class ContractCredentials: SessionCredentialStore {
    private var value: String?

    init(value: String?) { self.value = value }
    func read() -> String? { value }
    func write(_ value: String) { self.value = value }
    func delete() { value = nil }
}

struct ContractResponse: Sendable {
    let status: Int
    let data: Data
}

final class ContractURLProtocol: URLProtocol {
    private static let state = ContractURLProtocolState()

    static func install(_ responses: [ContractResponse]) {
        state.lock.lock()
        state.responses = responses
        state.requests = []
        state.lock.unlock()
    }

    static func reset() {
        state.lock.lock()
        state.responses = []
        state.requests = []
        state.lock.unlock()
    }

    static func requests() -> [URLRequest] {
        state.lock.lock()
        defer { state.lock.unlock() }
        return state.requests
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.state.lock.lock()
        let response = Self.state.responses.isEmpty ? nil : Self.state.responses.removeFirst()
        Self.state.requests.append(request)
        Self.state.lock.unlock()
        guard let response else {
            client?.urlProtocol(self, didFailWithError: URLError(.resourceUnavailable))
            return
        }
        let http = HTTPURLResponse(url: request.url!, statusCode: response.status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: http, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: response.data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class ContractURLProtocolState: @unchecked Sendable {
    let lock = NSLock()
    var responses: [ContractResponse] = []
    var requests: [URLRequest] = []
}
