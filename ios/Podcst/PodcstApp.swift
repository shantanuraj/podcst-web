import SwiftUI

@main
struct PodcstApp: App {
    @State private var api: APIClient
    @State private var session: SessionStore
    @State private var library: LibraryStore
    @State private var playback: PlaybackController
    @State private var media: MediaStore
    #if DEBUG
    @State private var audioLab: RoutingAudioTransport?
    #endif

    init() {
        let api = APIClient()
        _api = State(initialValue: api)
        let session = SessionStore(api: api)
        _session = State(initialValue: session)
        let library = LibraryStore(api: api, session: session)
        _library = State(initialValue: library)
        PodcstAppearance.configure()
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-LocalAudioHarness") {
            let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("PodcstAudioLab", isDirectory: true)
            let media = MediaStore(rootURL: directory.appendingPathComponent("Media", isDirectory: true))
            _media = State(initialValue: media)
            let reference = ProcessInfo.processInfo.arguments.contains("-AudioLabReference")
            let routing = RoutingAudioTransport(media: media, preferSystemPlayback: reference)
            _audioLab = State(initialValue: routing)
            let playback = PlaybackController(
                transport: routing,
                persistenceURL: directory.appendingPathComponent("playback.json"),
                preferences: AudioPreferences(),
                integratesWithSystem: true
            )
            playback.clear()
            _playback = State(initialValue: playback)
            return
        }
        _audioLab = State(initialValue: nil)
        #endif
        let media = MediaStore(accountID: session.user?.id)
        _media = State(initialValue: media)
        let routing = RoutingAudioTransport(media: media)
        let playback = PlaybackController(transport: routing, accountID: session.user?.id, preferences: .persistent(), integratesWithSystem: true)
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
    }

    var body: some Scene {
        WindowGroup {
            #if DEBUG
            if let audioLab {
                LocalAudioHarnessView(transport: audioLab)
                    .environment(playback)
                    .environment(api)
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
