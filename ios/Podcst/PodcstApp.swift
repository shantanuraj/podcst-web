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
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(library)
                .environment(playback)
                .environment(api)
                .environment(\.podcstTheme, PodcstTheme())
                .task {
                    await session.restore()
                    await library.load()
                    await playback.restore()
                }
        }
    }
}
