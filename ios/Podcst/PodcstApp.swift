import SwiftUI
import Network

@main
struct PodcstApp: App {
    @UIApplicationDelegateAdaptor(MediaDownloadAppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    private let isTesting: Bool
    private let network = NWPathMonitor()
    @State private var api: APIClient
    @State private var session: SessionStore
    @State private var library: LibraryStore
    @State private var playback: PlaybackController
    @State private var media: MediaStore
    @State private var stars: StarStore
    @State private var account: AccountStore

    init() {
        let testing = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
        isTesting = testing
        let api = APIClient()
        _api = State(initialValue: api)
        let session = SessionStore(api: api)
        _session = State(initialValue: session)
        ArtworkStore.shared.configure(accountID: session.user?.id)
        let library = LibraryStore(api: api, session: session)
        _library = State(initialValue: library)
        PodcstAppearance.configure()
        let media = MediaStore(accountID: session.user?.id)
        _media = State(initialValue: media)
        let stars = StarStore(accountID: session.user?.id, api: api)
        _stars = State(initialValue: stars)
        let routing = RoutingAudioTransport(media: media)
        let playback = PlaybackController(transport: routing, accountID: session.user?.id, preferences: .persistent(), integratesWithSystem: !testing, chapterLoader: { episode in await media.chapterMetadata(for: episode) })
        _playback = State(initialValue: playback)
        _account = State(initialValue: AccountStore(api: api, preferences: playback.audioPreferences))
        appDelegate.media = media
        session.suspendAccountWork = { [weak stars, weak library] in
            stars?.suspend()
            library?.durable.suspend()
        }
        session.resumeAccountWork = { [weak stars] accountID in stars?.resume(accountID: accountID) }
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
        if !testing {
            network.pathUpdateHandler = { [weak stars] path in
                if path.status == .satisfied { Task { @MainActor in await stars?.refresh() } }
            }
            network.start(queue: DispatchQueue(label: "app.podcst.star-connectivity"))
        }
    }

    var body: some Scene {
        WindowGroup {
            if !isTesting {
                RootView()
                    .id(session.user?.id)
                    .modifier(ArtworkRetention())
                    .environment(session)
                    .environment(library)
                    .environment(playback)
                    .environment(api)
                    .environment(media)
                    .environment(stars)
                    .environment(account)
                    .task {
                        await session.restore()
                    }
                    .task(id: scenePhase) {
                        if scenePhase == .active {
                            await media.reconcileDownloads()
                            await stars.refresh()
                            while !Task.isCancelled {
                                do { try await Task.sleep(for: .seconds(5)) } catch { break }
                                await stars.poll()
                            }
                        }
                    }
            }
        }
    }
}
