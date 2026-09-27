import SwiftUI

@main
struct PodcstApp: App {
    @State private var api: APIClient
    @State private var session: SessionStore
    @State private var library: LibraryStore
    @State private var playback: PlaybackController

    init() {
        let api = APIClient()
        _api = State(initialValue: api)
        let session = SessionStore(api: api)
        _session = State(initialValue: session)
        _library = State(initialValue: LibraryStore(api: api, session: session))
        _playback = State(initialValue: PlaybackController())
        PodcstAppearance.configure()
    }

    var body: some Scene {
        WindowGroup {
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
}
