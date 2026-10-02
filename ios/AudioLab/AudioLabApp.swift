import SwiftUI

@main
struct AudioLabApp: App {
    @UIApplicationDelegateAdaptor(MediaDownloadAppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var api = APIClient()
    @State private var media: MediaStore
    @State private var transport: RoutingAudioTransport
    @State private var playback: PlaybackController

    init() {
        PodcstAppearance.configure()
        let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PodcstAudioLab", isDirectory: true)
        let media = MediaStore(rootURL: directory.appendingPathComponent("Media", isDirectory: true))
        _media = State(initialValue: media)
        let reference = ProcessInfo.processInfo.arguments.contains("-AudioLabReference")
        let transport = RoutingAudioTransport(media: media, preferSystemPlayback: reference)
        _transport = State(initialValue: transport)
        let playback = PlaybackController(
            transport: transport,
            persistenceURL: directory.appendingPathComponent("playback.json"),
            preferences: AudioPreferences(),
            integratesWithSystem: true
        )
        playback.clear()
        _playback = State(initialValue: playback)
        appDelegate.media = media
    }

    var body: some Scene {
        WindowGroup {
            LocalAudioHarnessView(transport: transport)
                .environment(playback)
                .environment(api)
                .environment(media)
                .task(id: scenePhase) {
                    if scenePhase == .active { await media.reconcileDownloads() }
                }
        }
    }
}
