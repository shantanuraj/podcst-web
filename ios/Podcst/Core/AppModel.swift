import Foundation
import Network
import UIKit

@MainActor
final class AppModel {
    enum Surface { case phone, carPlay }

    static let isTesting = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    static let shared = AppModel(integratesWithSystem: !isTesting, monitorsConnectivity: !isTesting)

    let api: APIClient
    let session: SessionStore
    let library: LibraryStore
    let playback: PlaybackController
    let media: MediaStore
    let stars: StarStore
    let deletion: AccountDeletionStore
    let account: AccountStore

    private let network = NWPathMonitor()
    private var started = false
    private var startup: Task<Void, Never>?
    private var refreshing: (id: UUID, activity: UUID, task: Task<Void, Never>)?
    private var reconnecting: (id: UUID, task: Task<Void, Never>)?
    private var polling: Task<Void, Never>?
    private var activeSurfaces = Set<Surface>()

    init(api: APIClient = APIClient(), directory: URL? = nil, defaults: UserDefaults = .standard, transport: (any PlaybackTransport)? = nil, integratesWithSystem: Bool = true, monitorsConnectivity: Bool = true, downloadConfiguration: URLSessionConfiguration? = nil) {
        self.api = api
        let session = SessionStore(api: api, storageURL: directory?.appendingPathComponent("session.json"))
        self.session = session
        let deletion = AccountDeletionStore(api: api, session: session, url: directory?.appendingPathComponent("account-deletions.json"))
        self.deletion = deletion
        session.deletionBlocked = { [weak deletion] account in deletion?.blocked(account) ?? true }
        api.deletionBlocked = { [weak deletion] account in deletion?.blocked(account) ?? true }
        if integratesWithSystem { ArtworkStore.shared.configure(accountID: session.user?.id) }
        let library = LibraryStore(api: api, session: session, defaults: defaults, progressDirectory: directory?.appendingPathComponent("Progress", isDirectory: true))
        self.library = library
        let media = MediaStore(accountID: session.user?.id, rootURL: directory?.appendingPathComponent("Media", isDirectory: true), downloadConfiguration: downloadConfiguration)
        self.media = media
        let stars = StarStore(accountID: session.user?.id, directory: directory?.appendingPathComponent("EpisodeLists", isDirectory: true), api: api)
        self.stars = stars
        let routing = RoutingAudioTransport(media: media)
        let chapterLoader: (@MainActor (Episode) async -> ChapterMetadata?)?
        if transport == nil { chapterLoader = { @MainActor episode in await media.chapterMetadata(for: episode) } }
        else { chapterLoader = nil }
        let playback = PlaybackController(transport: transport ?? routing, persistenceURL: directory?.appendingPathComponent("playback.json") ?? PlaybackController.defaultStorageURL(), accountID: session.user?.id, preferences: directory.map { AudioPreferences(storageURL: $0.appendingPathComponent("audio-preferences.json")) } ?? .persistent(), integratesWithSystem: integratesWithSystem, chapterLoader: chapterLoader)
        self.playback = playback
        self.account = AccountStore(api: api, preferences: playback.audioPreferences)
        session.suspendAccountWork = { [weak self, weak stars, weak library] in
            self?.cancelAccountRefresh()
            stars?.suspend()
            library?.durable.suspend()
        }
        session.resumeAccountWork = { [weak self, weak stars, weak playback] accountID in
            playback?.cancelAccountChange()
            stars?.resume(accountID: accountID)
            guard let self, self.started else { return }
            Task { [weak self] in await self?.refresh() }
        }
        deletion.suspend = { accountID in
            guard session.user?.id == accountID else { return }
            playback.beginAccountChange()
            try playback.checkpointQueueForAccountChange(to: accountID)
            try library.checkpointAndSuspend()
            try stars.checkpointAndSuspend()
            api.beginAuthentication()
            await routing.releaseMedia()
            await playback.releaseChapterMetadata()
        }
        deletion.clean = { accountID, step in
            switch step {
            case .retire: try await deletion.suspend?(accountID)
            case .media:
                try await media.erase(account: accountID)
                try await ArtworkStore.shared.erase(account: accountID)
            case .data:
                try playback.terminalEraseQueue(accountID: accountID)
                try library.terminalErase(accountID: accountID)
                try stars.terminalErase(accountID: accountID)
            case .credentials: try await session.forgetDeletedAccount(accountID)
            case .complete: break
            }
        }
        session.prepareAccountChange = { [weak library, weak playback] accountID in
            stars.suspend()
            playback?.beginAccountChange()
            do {
                try playback?.checkpointQueueForAccountChange(to: accountID)
                try library?.checkpointAndSuspend()
                try stars.checkpointAndSuspend()
            } catch {
                playback?.cancelAccountChange()
                playback?.onProgress = { [weak library] update in library?.saveProgress(update) }
                throw error
            }
            await library?.resetProgressSync(accountID: accountID)
            await routing.releaseMedia()
            await playback?.releaseChapterMetadata()
            do { try await media.switchAccount(to: accountID) }
            catch { if media.accountID != accountID { throw error } }
            try playback?.switchAccount(to: accountID)
            try stars.switchAccount(to: accountID, activate: false)
            await ArtworkStore.shared.switchAccount(to: accountID)
            playback?.onProgress = { [weak library] update in library?.saveProgress(update) }
        }
        playback.onProgress = { [weak library] update in library?.saveProgress(update) }
        if monitorsConnectivity {
            network.pathUpdateHandler = { [weak self] path in
                guard path.status == .satisfied else { return }
                Task { @MainActor [weak self] in await self?.reconnect() }
            }
            network.start(queue: DispatchQueue(label: "app.podcst.connectivity"))
        }
    }

    func start() async {
        if let startup { await startup.value; return }
        guard !started else { return }
        let task = Task { [self] in
            await session.restore()
            if let id = session.user?.id, deletion.blocked(id) { try? await deletion.suspend?(id) }
            await deletion.resume()
            started = true
            await reload()
        }
        startup = task
        await task.value
        startup = nil
    }

    func refresh() async {
        guard started else { await start(); return }
        await reload()
    }

    func setActive(_ active: Bool, for surface: Surface) {
        if active { activeSurfaces.insert(surface) }
        else { activeSurfaces.remove(surface) }
        guard !activeSurfaces.isEmpty else {
            polling?.cancel()
            polling = nil
            return
        }
        guard polling == nil else { return }
        polling = Task { [weak self] in
            await self?.refresh()
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
                guard let self else { return }
                if self.session.accountWorkAllowed { await self.stars.poll() }
            }
        }
    }

    private func reload() async {
        guard !Task.isCancelled, !session.isLoading else { return }
        let activity = api.activityToken
        if let refreshing, refreshing.activity == activity { await refreshing.task.value; return }
        let id = UUID()
        let accountID = session.user?.id
        let playbackRevision = playback.progressActivityToken
        let task = Task { [self] in
            let current = { !Task.isCancelled && self.session.accountWorkAllowed && self.api.activityToken == activity && self.session.user?.id == accountID }
            await deletion.resume()
            guard !Task.isCancelled, !session.isLoading else { return }
            if !session.accountWorkAllowed { await library.load(); return }
            guard current() else { return }
            await media.reconcileDownloads()
            guard current() else { return }
            await library.load()
            guard current() else { return }
            await account.load(accountID: accountID)
            guard current() else { return }
            if playback.progressActivityToken == playbackRevision {
                await playback.restoreProgress { await library.restoreProgress() }
            }
            guard current() else { return }
            await library.loadProgress(for: library.listeningEpisodes(including: playback.currentEpisode))
            guard current() else { return }
            await stars.refresh()
        }
        refreshing = (id, activity, task)
        await task.value
        if refreshing?.id == id { refreshing = nil }
    }

    private func reconnect() async {
        guard started, session.accountWorkAllowed else { return }
        if let reconnecting { await reconnecting.task.value; return }
        let id = UUID()
        let activity = api.activityToken
        let task = Task { [self] in
            await library.flushProgress()
            guard !Task.isCancelled, session.accountWorkAllowed, api.activityToken == activity else { return }
            await stars.refresh()
        }
        reconnecting = (id, task)
        await task.value
        if reconnecting?.id == id { reconnecting = nil }
    }

    private func cancelAccountRefresh() {
        refreshing?.task.cancel()
        refreshing = nil
        reconnecting?.task.cancel()
        reconnecting = nil
    }

    deinit {
        network.cancel()
        startup?.cancel()
        refreshing?.task.cancel()
        reconnecting?.task.cancel()
        polling?.cancel()
    }
}

@MainActor
final class PodcstAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        if !AppModel.isTesting { Task { await AppModel.shared.start() } }
        return true
    }

    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        AppModel.shared.media.handleBackgroundEvents(identifier: identifier, completionHandler: completionHandler)
    }
}
