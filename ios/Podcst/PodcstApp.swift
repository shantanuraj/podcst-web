import SwiftUI

@main
struct PodcstApp: App {
    @UIApplicationDelegateAdaptor(MediaDownloadAppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    private let isTesting: Bool
    @State private var api: APIClient
    @State private var session: SessionStore
    @State private var library: LibraryStore
    @State private var playback: PlaybackController
    @State private var media: MediaStore
    @State private var stars: StarStore

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
        let stars = StarStore(accountID: session.user?.id)
        _stars = State(initialValue: stars)
        let routing = RoutingAudioTransport(media: media)
        let playback = PlaybackController(transport: routing, accountID: session.user?.id, preferences: .persistent(), integratesWithSystem: !testing, chapterLoader: { episode in await media.chapterMetadata(for: episode) })
        _playback = State(initialValue: playback)
        appDelegate.media = media
        session.prepareAccountChange = { [weak library, weak playback] accountID in
            playback?.beginAccountChange()
            await library?.resetProgressSync()
            await routing.releaseMedia()
            await playback?.releaseChapterMetadata()
            do { try await media.switchAccount(to: accountID) }
            catch { if media.accountID != accountID { throw error } }
            playback?.switchAccount(to: accountID)
            stars.switchAccount(to: accountID)
            await ArtworkStore.shared.switchAccount(to: accountID)
            playback?.onProgress = { [weak library] update in library?.saveProgress(update) }
        }
        playback.onProgress = { [weak library] update in library?.saveProgress(update) }
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
                    .task {
                        await session.restore()
                    }
                    .task(id: scenePhase) {
                        if scenePhase == .active { await media.reconcileDownloads() }
                    }
            }
        }
    }
}
