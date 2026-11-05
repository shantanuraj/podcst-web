import SwiftUI

@main
struct PodcstApp: App {
    @UIApplicationDelegateAdaptor(PodcstAppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    private let model = AppModel.shared

    init() {
        PodcstAppearance.configure()
    }

    var body: some Scene {
        WindowGroup {
            if !AppModel.isTesting {
                RootView()
                    .id(model.session.user?.id)
                    .modifier(ArtworkRetention())
                    .environment(model.session)
                    .environment(model.library)
                    .environment(model.playback)
                    .environment(model.api)
                    .environment(model.media)
                    .environment(model.stars)
                    .environment(model.account)
                    .environment(model.deletion)
                    .task(id: scenePhase) {
                        model.setActive(scenePhase == .active, for: .phone)
                        await model.start()
                    }
            }
        }
    }
}
