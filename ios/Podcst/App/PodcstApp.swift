import SwiftUI
import SwiftData

@main
struct PodcstApp: App {
    let container: ModelContainer
    @State private var appState: AppState
    @State private var router = Router()

    init() {
        let schema = Schema([
            CachedPodcast.self,
            CachedEpisode.self,
            DownloadedEpisode.self,
            LocalPlaybackProgress.self,
            LocalSubscription.self
        ])

        let config = ModelConfiguration(isStoredInMemoryOnly: false)
        let container = try! ModelContainer(for: schema, configurations: [config])
        self.container = container

        let apiClient = APIClient(baseURL: Configuration.apiBaseURL)
        let audioService = AudioService()
        _appState = State(initialValue: AppState(
            apiClient: apiClient,
            audioService: audioService,
            modelContext: container.mainContext
        ))
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(appState)
                .environment(appState.playerState)
                .environment(router)
                .modelContainer(container)
                .task {
                    await appState.checkSession()
                }
        }
    }
}

struct ContentView: View {
    @Environment(Router.self) private var router
    @Environment(PlayerState.self) private var playerState

    var body: some View {
        @Bindable var router = router

        ZStack(alignment: .bottom) {
            TabView {
                Tab("Discover", systemImage: "square.grid.2x2") {
                    NavigationStack(path: $router.path) {
                        DiscoverView()
                            .navigationDestination(for: Destination.self) { destination in
                                destinationView(for: destination)
                            }
                    }
                }

                Tab("Library", systemImage: "books.vertical") {
                    NavigationStack {
                        LibraryView()
                            .navigationDestination(for: Destination.self) { destination in
                                destinationView(for: destination)
                            }
                    }
                }

                Tab("Settings", systemImage: "gearshape") {
                    NavigationStack {
                        SettingsView()
                            .navigationDestination(for: Destination.self) { destination in
                                destinationView(for: destination)
                            }
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if playerState.currentEpisode != nil {
                    MiniPlayerView()
                }
            }
        }
    }

    @ViewBuilder
    private func destinationView(for destination: Destination) -> some View {
        switch destination {
        case .podcast(let id):
            PodcastDetailView(podcastId: id)
        case .episode(let podcastId, let episodeId):
            EpisodeDetailView(podcastId: podcastId, episodeId: episodeId)
        case .search:
            SearchView()
        case .library:
            LibraryView()
        case .downloads:
            DownloadsView()
        case .settings:
            SettingsView()
        case .auth:
            AuthView()
        }
    }
}
