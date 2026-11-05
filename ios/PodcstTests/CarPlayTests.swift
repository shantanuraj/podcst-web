import CarPlay
import XCTest
@testable import Podcst

@MainActor
final class CarPlayTests: XCTestCase {
    override func tearDown() {
        ContractURLProtocol.reset()
        super.tearDown()
    }

    func testQueueUsesPlaybackOrderAndSelectingCurrentPreservesPosition() async throws {
        let (app, car, _) = try fixture()
        await ready(app)
        let first = episode(1), current = episode(2), next = episode(3)
        app.playback.enqueue(first)
        app.playback.enqueue(current)
        app.playback.enqueue(next)
        app.playback.restore(current, at: 42)

        XCTAssertEqual(car.episodes(for: .queue), [current, next, first])
        XCTAssertTrue(car.play(current, scope: app.api.activityToken))
        XCTAssertEqual(app.playback.currentTime, 42)
        XCTAssertEqual(app.playback.upNext, [next, first])
    }

    func testSelectionResumesSavedProgressAndReplaysCompletedEpisodesFromStart() async throws {
        let (app, car, _) = try fixture()
        await ready(app)
        let unfinished = episode(1), completed = episode(2)
        try app.library.durable.setProgress(id: 1, position: 81, event: .checkpoint)
        try app.library.durable.setProgress(id: 2, position: 300, event: .played)

        XCTAssertTrue(car.play(unfinished, scope: app.api.activityToken))
        XCTAssertEqual(app.playback.currentTime, 81)
        XCTAssertTrue(car.play(completed, scope: app.api.activityToken))
        XCTAssertEqual(app.playback.currentTime, 0)
    }

    func testContinueAndNewDeduplicatesCurrentAndExcludesCompletedEpisodes() async throws {
        let current = episode(1), completed = episode(2)
        let podcast = Podcast(id: 1, feed: current.feed, title: "Show", episodes: [current, completed])
        let (app, car, _) = try fixture(podcasts: [podcast])
        await ready(app)
        try app.library.durable.setProgress(id: 2, position: 300, event: .played)
        app.playback.restore(current, at: 42)

        XCTAssertEqual(car.episodes(for: .listening), [current])
        app.playback.markPlayed()
        XCTAssertTrue(car.episodes(for: .queue).isEmpty)
        XCTAssertTrue(car.episodes(for: .listening).isEmpty)
        XCTAssertFalse(app.playback.isPlaybackRequested)
    }

    func testCarPlayDoesNotExposeOrPlayContentDuringRestorationOrWithRetiredScope() async throws {
        let (app, car, _) = try fixture()
        let current = episode(1)
        app.playback.restore(current, at: 42)
        XCTAssertTrue(car.episodes(for: .queue).isEmpty)
        XCTAssertFalse(car.play(current, scope: app.api.activityToken))
        await ready(app)
        let previous = app.api.activityToken
        app.api.beginAuthentication()

        XCTAssertFalse(car.play(episode(2), scope: previous))
        XCTAssertEqual(app.playback.currentEpisode, current)
        XCTAssertEqual(app.playback.currentTime, 42)
        XCTAssertFalse(app.playback.isPlaybackRequested)
    }

    func testDownloadsOnlyIncludeCompleteFilesAndRemainAvailableOffline() async throws {
        let complete = episode(1), paused = episode(2), failed = episode(3)
        let (app, car, _) = try fixture(downloads: [(complete, true, .paused), (paused, false, .paused), (failed, false, .failed(.invalidResponse))])
        await ready(app)

        XCTAssertEqual(app.media.downloadedEpisodes.count, 3)
        XCTAssertEqual(car.episodes(for: .downloads), [complete])
        XCTAssertTrue(car.play(complete, scope: app.api.activityToken))
        XCTAssertEqual(ContractURLProtocol.requests().map { $0.url?.path }, ["/api/auth/session"])
    }

    func testSceneManifestRegistersAudioConnectionAndDisconnectionCallbacks() throws {
        let manifest = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "UIApplicationSceneManifest") as? [String: Any])
        let configurations = try XCTUnwrap(manifest["UISceneConfigurations"] as? [String: Any])
        let scenes = try XCTUnwrap(configurations["CPTemplateApplicationSceneSessionRoleApplication"] as? [[String: String]])
        XCTAssertEqual(scenes.first?["UISceneClassName"], "CPTemplateApplicationScene")
        XCTAssertEqual(scenes.first?["UISceneDelegateClassName"], "Podcst.CarPlaySceneDelegate")
        let delegate = CarPlaySceneDelegate()
        XCTAssertTrue(delegate.responds(to: #selector(CPTemplateApplicationSceneDelegate.templateApplicationScene(_:didConnect:))))
        XCTAssertTrue(delegate.responds(to: #selector(CPTemplateApplicationSceneDelegate.templateApplicationScene(_:didDisconnectInterfaceController:))))
    }

    private func ready(_ app: AppModel) async {
        ContractURLProtocol.install([ContractResponse(status: 200, data: Data(#"{"user":null}"#.utf8))])
        await app.session.restore()
    }

    private func fixture(podcasts: [Podcast] = [], downloads: [(Episode, Bool, MediaDownloadRecord.Intent)] = []) throws -> (AppModel, CarPlayController, CarPlayTransport) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        for (episode, complete, intent) in downloads {
            let folder = directory.appendingPathComponent("Media/downloads/\(MediaKey.scope(nil))/\(MediaKey(accountID: nil, episode: episode).rawValue)", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try JSONEncoder().encode(MediaDownloadRecord(episode: episode, intent: intent)).write(to: folder.appendingPathComponent("transfer.json"))
            if complete {
                let temporary = folder.appendingPathComponent("download")
                try Data(repeating: 0, count: 100).write(to: temporary)
                let response = HTTPURLResponse(url: episode.audioURL!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Length": "100", "Content-Type": "audio/mpeg"])
                _ = try DownloadedMediaFile.install(from: temporary, response: response, in: folder.appendingPathComponent("complete", isDirectory: true))
            }
        }
        let suite = "carplay-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defaults.set(try JSONEncoder().encode(podcasts), forKey: "guest.library.podcasts")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ContractURLProtocol.self]
        let api = APIClient(baseURL: URL(string: "https://carplay-\(UUID()).example.test")!, session: URLSession(configuration: configuration), keychain: ContractCredentials(value: nil))
        let transport = CarPlayTransport()
        let app = AppModel(api: api, directory: directory, defaults: defaults, transport: transport, integratesWithSystem: false, monitorsConnectivity: false, downloadConfiguration: configuration)
        let car = CarPlayController(app: app)
        addTeardownBlock {
            await MainActor.run { app.playback.shutdown() }
            UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
        }
        return (app, car, transport)
    }

    private func episode(_ id: Int) -> Episode {
        Episode(id: id, podcastId: 1, guid: "\(id)", feed: "https://example.test/feed", podcastTitle: "Show", title: "Episode \(id)", duration: 300, file: EpisodeFile(url: "https://example.test/\(id).mp3"))
    }
}

@MainActor
private final class CarPlayTransport: PlaybackTransport {
    var onUpdate: (@MainActor (PlaybackTransportUpdate) -> Void)?
    var hasSource = false
    var position: TimeInterval = 0
    func load(source: PlaybackSource, at position: TimeInterval, generation: UUID) {
        self.position = position
        hasSource = true
    }
    func play(atRate rate: Double) {}
    func pause() {}
    func setRate(_ rate: Double) {}
    func setEffects(_ effects: AudioEffects) {}
    func seek(to position: TimeInterval, generation: UUID) { self.position = position }
    func stop() { hasSource = false }
    func shutdown() { stop() }
}
