import SwiftUI

@main
struct PodcstApp: App {
    @State private var api: APIClient
    @State private var session: SessionStore
    @State private var library: LibraryStore
    @State private var playback: PlaybackController
    @State private var media: MediaStore
    #if DEBUG
    @State private var localAudio: LocalAudioTransport?
    #endif

    init() {
        let api = APIClient()
        _api = State(initialValue: api)
        let session = SessionStore(api: api)
        _session = State(initialValue: session)
        let library = LibraryStore(api: api, session: session)
        _library = State(initialValue: library)
        let media = MediaStore(accountID: session.user?.id)
        _media = State(initialValue: media)
        let routing = RoutingAudioTransport(media: media)
        let playback: PlaybackController
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-LocalAudioHarness") {
            let local = LocalAudioTransport()
            let reference = ProcessInfo.processInfo.arguments.contains("-AudioLabReference")
            let transport: any PlaybackTransport = reference ? AVPlayerTransport() : local
            _localAudio = State(initialValue: local)
            playback = PlaybackController(
                transport: transport,
                persistenceURL: FileManager.default.temporaryDirectory.appendingPathComponent("audio-lab-\(UUID().uuidString).json"),
                integratesWithSystem: true
            )
        } else {
            _localAudio = State(initialValue: nil)
            playback = PlaybackController(transport: routing, accountID: session.user?.id, preferences: .persistent(), integratesWithSystem: true)
        }
        #else
        playback = PlaybackController(transport: routing, accountID: session.user?.id, preferences: .persistent(), integratesWithSystem: true)
        #endif
        _playback = State(initialValue: playback)
        session.prepareAccountChange = { [weak library, weak playback] accountID in
            playback?.beginAccountChange()
            await library?.resetProgressSync()
            await routing.releaseMedia()
            do { try await media.switchAccount(to: accountID) }
            catch { if media.accountID != accountID { throw error } }
            playback?.switchAccount(to: accountID)
            playback?.onProgress = { [weak library] update in library?.saveProgress(update) }
        }
        playback.onProgress = { [weak library] update in library?.saveProgress(update) }
        PodcstAppearance.configure()
    }

    var body: some Scene {
        WindowGroup {
            #if DEBUG
            if let localAudio {
                LocalAudioHarnessView(transport: localAudio)
                    .environment(playback)
            } else {
                application
            }
            #else
            application
            #endif
        }
    }

    private var application: some View {
        RootView()
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
