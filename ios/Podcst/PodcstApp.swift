import SwiftUI

@main
struct PodcstApp: App {
    @State private var api: APIClient
    @State private var session: SessionStore
    @State private var library: LibraryStore
    @State private var playback: PlaybackController
    #if DEBUG
    @State private var localAudio: LocalAudioTransport?
    #endif

    init() {
        let api = APIClient()
        _api = State(initialValue: api)
        let session = SessionStore(api: api)
        _session = State(initialValue: session)
        _library = State(initialValue: LibraryStore(api: api, session: session))
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-LocalAudioHarness") {
            let transport = LocalAudioTransport()
            _localAudio = State(initialValue: transport)
            _playback = State(initialValue: PlaybackController(
                transport: transport,
                persistenceURL: FileManager.default.temporaryDirectory.appendingPathComponent("audio-lab-\(UUID().uuidString).json"),
                integratesWithSystem: true
            ))
        } else {
            _localAudio = State(initialValue: nil)
            _playback = State(initialValue: PlaybackController())
        }
        #else
        _playback = State(initialValue: PlaybackController())
        #endif
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
            .task {
                await session.restore()
                await library.load()
                await playback.restore()
                playback.onProgress = { update in
                    guard let id = update.episode.id else { return }
                    Task { @MainActor in
                        await library.saveProgress(
                            episodeID: id,
                            position: update.position,
                            completed: update.completed,
                        )
                    }
                }
                if let progress = library.progress {
                    playback.restore(progress.episode, at: progress.position)
                }
            }
    }
}
