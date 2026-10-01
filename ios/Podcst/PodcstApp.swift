import SwiftUI

@main
struct PodcstApp: App {
    private let isTesting: Bool
    @State private var api: APIClient
    @State private var session: SessionStore
    @State private var library: LibraryStore
    @State private var playback: PlaybackController
    @State private var media: MediaStore

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
        let routing = RoutingAudioTransport(media: media)
        let playback = PlaybackController(transport: routing, accountID: session.user?.id, preferences: .persistent(), integratesWithSystem: !testing)
        _playback = State(initialValue: playback)
        session.prepareAccountChange = { [weak library, weak playback] accountID in
            playback?.beginAccountChange()
            await library?.resetProgressSync()
            await routing.releaseMedia()
            do { try await media.switchAccount(to: accountID) }
            catch { if media.accountID != accountID { throw error } }
            playback?.switchAccount(to: accountID)
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
                    .task {
                        await session.restore()
                    }
            }
        }
    }
}
