import SwiftUI
import Network

enum AppTab: Hashable {
    case discover
    case library
    case queue
    case search
}

enum Route: Hashable {
    case podcast(Podcast)
    case episode(Episode)
    case releases
    case list(EpisodeList)
}

@MainActor
@Observable
final class Router {
    struct StoppedPlayback: Equatable {
        let id = UUID()
        let wasPlaying: Bool
    }

    var tab: AppTab = .discover
    var showingPlayer = false
    var stoppedPlayback: StoppedPlayback?
    var toast: Toast?
    var listing: Episode?
    private var paths: [AppTab: [Route]] = [:]

    func path(_ tab: AppTab) -> Binding<[Route]> {
        Binding { self.paths[tab] ?? [] } set: { self.paths[tab] = $0 }
    }

    func reset() {
        showingPlayer = false
        paths.removeAll()
    }

    func open(_ route: Route) {
        showingPlayer = false
        paths[tab, default: []].append(route)
    }

    func stop(_ playback: PlaybackController) {
        guard playback.isActive else { return }
        showingPlayer = false
        stoppedPlayback = StoppedPlayback(wasPlaying: playback.isPlaybackRequested)
        playback.stop()
    }

    func undoStop(_ playback: PlaybackController) {
        guard let stoppedPlayback else { return }
        self.stoppedPlayback = nil
        if stoppedPlayback.wasPlaying { playback.resume() } else { playback.reopen() }
    }
}

struct RootView: View {
    @Environment(LibraryStore.self) private var library
    @Environment(SessionStore.self) private var session
    @Environment(AccountStore.self) private var account
    @Environment(PlaybackController.self) private var playback
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(Appearance.key) private var appearance = Appearance.system
    @AppStorage("onboarded") private var onboarded = false
    @State private var router = Router()
    @State private var initialTabConfigured = false
    @State private var queueRetryError: String?

    var body: some View {
        @Bindable var router = router
        Group {
            if initialTabConfigured {
                tabs
            } else {
                StartupView()
            }
        }
        .safeAreaInset(edge: .top) {
            if let error = playback.queueStorageError {
                VStack(alignment: .leading, spacing: 6) {
                    Text(error).font(.footnote).foregroundStyle(.red)
                    if playback.canRetryQueueStorage {
                        Button("Retry queue storage") {
                            do { try playback.retryQueueStorage() }
                            catch { queueRetryError = error.localizedDescription }
                        }.font(.footnote)
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(PodcstPalette.paper)
            }
        }
        .tint(PodcstPalette.accent)
        .background(PodcstPalette.paper)
        .environment(router)
        .sheet(isPresented: $router.showingPlayer) {
            NowPlayingView()
                .environment(router)
                .presentationDragIndicator(.visible)
        }
        .sheet(item: $router.listing) { episode in
            AddToListSheet(episode: episode)
        }
        .fullScreenCover(isPresented: onboarding) {
            OnboardingView { onboarded = true }
        }
        .preferredColorScheme(appearance.colorScheme)
        .task { configureInitialTab() }
        .onChange(of: library.hasLoaded) { _, _ in configureInitialTab() }
        .onChange(of: session.user?.id) { _, userID in
            router.reset()
            if userID != nil { onboarded = true }
        }
        .task(id: session.isLoading) {
            guard !session.isLoading else { return }
            await library.load()
            guard !Task.isCancelled else { return }
            await account.load(accountID: session.user?.id)
        }
        .task(id: scenePhase == .active && !session.isLoading) {
            guard scenePhase == .active, !session.isLoading else { return }
            await playback.restoreProgress { await library.restoreProgress() }
        }
        .task(id: router.stoppedPlayback?.id) {
            guard router.stoppedPlayback != nil, (try? await Task.sleep(for: .seconds(5))) != nil else { return }
            router.stoppedPlayback = nil
        }
        .task(id: router.toast?.id) {
            guard let toast = router.toast,
                  (try? await Task.sleep(for: .seconds(toast.actions.isEmpty ? 2.5 : 5))) != nil,
                  router.toast == toast else { return }
            router.toast = nil
        }
        .onChange(of: playback.isActive) { _, active in
            if active { router.stoppedPlayback = nil }
        }
        .task(id: session.user?.id) {
            guard session.user != nil else { return }
            await retryProgressWhenConnected()
        }
        .alert("Queue storage remains blocked", isPresented: Binding(get: { queueRetryError != nil }, set: { if !$0 { queueRetryError = nil } })) {
            Button("OK", role: .cancel) { queueRetryError = nil }
        } message: {
            Text(playback.queueStorageError ?? queueRetryError ?? "Queue recovery failed")
        }
        .downloadAlerts()
        .font(.sans(.body))
    }

    private func retryProgressWhenConnected() async {
        let monitor = NWPathMonitor()
        let changes = AsyncStream<Void>(bufferingPolicy: .bufferingNewest(1)) { continuation in
            monitor.pathUpdateHandler = { path in
                if path.status == .satisfied { continuation.yield(()) }
            }
            continuation.onTermination = { _ in monitor.cancel() }
            monitor.start(queue: DispatchQueue(label: "app.podcst.progress-connectivity"))
        }
        defer { monitor.cancel() }
        for await _ in changes {
            await library.flushProgress()
        }
    }

    private var onboarding: Binding<Bool> {
        Binding {
            initialTabConfigured && !onboarded && session.user == nil && library.podcasts.isEmpty
        } set: { presented in
            if !presented { onboarded = true }
        }
    }

    private var tabs: some View {
        @Bindable var router = router
        return TabView(selection: $router.tab) {
            Tab("Discover", systemImage: "safari", value: .discover) {
                TabStack(tab: .discover) { DiscoverView() }
            }
            Tab("Library", systemImage: "square.grid.2x2", value: .library) {
                TabStack(tab: .library) { LibraryView() }
            }
            Tab("Queue", systemImage: "text.line.first.and.arrowtriangle.forward", value: .queue) {
                TabStack(tab: .queue) { QueueView() }
            }
            Tab("Search", systemImage: "magnifyingglass", value: .search, role: .search) {
                TabStack(tab: .search) { SearchView() }
            }
        }
    }

    private func configureInitialTab() {
        guard !initialTabConfigured, library.hasLoaded else { return }
        initialTabConfigured = true
        if library.podcasts.contains(where: { !$0.episodes.isEmpty }) {
            router.tab = .library
        }
    }
}

private struct TabStack<Content: View>: View {
    @Environment(Router.self) private var router
    let tab: AppTab
    @ViewBuilder let content: Content

    var body: some View {
        NavigationStack(path: router.path(tab)) {
            content
                .modifier(PlayerInset())
                .navigationDestination(for: Route.self) { route in
                    Group {
                        switch route {
                        case .podcast(let podcast): PodcastDetailView(podcast: podcast)
                        case .episode(let episode): EpisodeDetailView(episode: episode)
                        case .releases: ReleasesView()
                        case .list(let list): EpisodeListView(list: list)
                        }
                    }
                    .modifier(PlayerInset())
                }
        }
    }
}

private struct StartupView: View {
    var body: some View {
        VStack(spacing: 16) {
            Text("Podcst")
                .font(.custom(Typeface.serifItalic.name, fixedSize: 48))
                .foregroundStyle(PodcstPalette.ink)
            ProgressView()
                .tint(PodcstPalette.accent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PodcstPalette.paper)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Loading your library")
    }
}

private struct PlayerInset: ViewModifier {
    @Environment(PlaybackController.self) private var playback
    @Environment(Router.self) private var router

    func body(content: Content) -> some View {
        content.safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 8) {
                if let toast = router.toast {
                    ToastView(toast: toast) { router.toast = nil }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                Group {
                    if playback.isActive {
                        NowPlayingBar()
                    } else if router.stoppedPlayback != nil {
                        StoppedPlaybackToast()
                    }
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 10)
        }
        .animation(.snappy, value: playback.isActive)
        .animation(.snappy, value: router.stoppedPlayback)
        .animation(.snappy, value: router.toast)
    }
}

private struct StoppedPlaybackToast: View {
    @Environment(PlaybackController.self) private var playback
    @Environment(Router.self) private var router

    private var detail: String {
        let saved = "Saved at \(Duration.clock(playback.currentTime))"
        let left = playback.upNext.count
        return left > 0 ? "\(saved) · \(left) left in queue" : saved
    }

    var body: some View {
        ToastView(toast: Toast(title: "Playback stopped", detail: detail, actions: [
            Toast.Action(title: "Undo") { router.undoStop(playback) }
        ]))
    }
}

struct AccountButton: View {
    @State private var showingSettings = false

    var body: some View {
        Button {
            showingSettings = true
        } label: {
            Image(systemName: "person")
                .font(.sans(.subheadline).weight(.semibold))
                .foregroundStyle(PodcstPalette.secondary)
                .frame(width: 36, height: 36)
                .background(PodcstPalette.surface, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Account and settings")
        .sheet(isPresented: $showingSettings) {
            SettingsView()
        }
    }
}

struct NowPlayingBar: View {
    @Environment(PlaybackController.self) private var playback
    @Environment(Router.self) private var router
    @State private var drag: CGSize = .zero

    private var stopsOnRelease: Bool { drag.height > 56 }

    private var subtitle: some View {
        Group {
            if playback.state == .loading {
                Text("Loading…").foregroundStyle(PodcstPalette.secondary)
            } else if let output = playback.outputName {
                Label(output, systemImage: "airplayaudio").foregroundStyle(PodcstPalette.accent)
            } else {
                Text(playback.currentEpisode?.podcastTitle ?? "Podcst").foregroundStyle(PodcstPalette.secondary)
            }
        }
        .font(.sans(.caption))
        .labelStyle(.titleAndIcon)
        .lineLimit(1)
    }

    var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 12) {
                ArtworkView(url: playback.currentEpisode?.artworkURL, fallbackURL: playback.currentEpisode.flatMap { URL(string: $0.cover) }, size: 44, chapterArtwork: playback.currentChapterArtwork)
                VStack(alignment: .leading, spacing: 2) {
                    Text(playback.currentEpisode?.title ?? "")
                        .font(.sans(.subheadline).weight(.medium))
                        .lineLimit(1)
                    subtitle
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .offset(x: drag.width)
            .opacity(1 - min(0.55, abs(drag.width) / 240))
            .onTapGesture { router.showingPlayer = true }
            .contextMenu {
                if let episode = playback.currentEpisode { EpisodeMenuActions(episode: episode) }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { router.showingPlayer = true }
            .accessibilityLabel("\(playback.currentEpisode?.title ?? ""), \(playback.currentEpisode?.podcastTitle ?? "Podcst")")
            .accessibilityHint("Open Now Playing")
            .accessibilityAction(named: "Next episode") { playback.next() }
            .accessibilityAction(named: "Previous episode") { playback.previous() }
            .accessibilityAction(named: "Stop playback") { router.stop(playback) }
            if playback.isPlaying {
                Equalizer(active: true)
            }
            Button {
                playback.toggle()
            } label: {
                Image(systemName: playback.isPlaybackRequested ? "pause.fill" : "play.fill")
                    .font(.system(size: 22))
                    .frame(minWidth: 44, minHeight: 44)
                    .opacity(playback.state == .loading ? 0.4 : 1)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(playback.isPlaybackRequested ? "Pause" : "Play")
        }
        .padding(.leading, 9)
        .padding(.trailing, 8)
        .frame(height: 62)
        .background {
            ZStack {
                Rectangle().fill(.ultraThinMaterial)
                PodcstPalette.floating.opacity(0.92)
            }
        }
        .overlay(alignment: .bottom) {
            ProgressLine(fraction: playback.progress, loading: playback.state == .loading)
        }
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(PodcstPalette.floatingRule)
        }
        .shadow(color: PodcstPalette.floatingShadow, radius: 12, y: 8)
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .scaleEffect(stopsOnRelease ? 0.96 : 1)
        .opacity(stopsOnRelease ? 0.7 : 1)
        .overlay(alignment: .top) {
            if stopsOnRelease {
                Label("Release to stop", systemImage: "stop.fill")
                    .font(.sans(.footnote).weight(.semibold))
                    .labelStyle(.titleAndIcon)
                    .padding(.horizontal, 14)
                    .frame(height: 34)
                    .callout(in: Capsule())
                    .offset(y: -48)
                    .transition(.scale(scale: 0.8).combined(with: .opacity))
            }
        }
        .offset(y: drag.height / 2)
        .animation(.snappy(duration: 0.2), value: stopsOnRelease)
        .sensoryFeedback(.impact, trigger: stopsOnRelease) { _, stops in stops }
        .simultaneousGesture(
            DragGesture(minimumDistance: 24)
                .onChanged { value in
                    let translation = value.translation
                    if abs(translation.height) > abs(translation.width) {
                        drag = CGSize(width: 0, height: max(0, translation.height))
                    } else if playback.queue.count > 1 {
                        drag = CGSize(width: translation.width, height: 0)
                    }
                }
                .onEnded { _ in
                    if stopsOnRelease {
                        router.stop(playback)
                    } else if drag.width < -70 {
                        playback.next()
                    } else if drag.width > 70 {
                        playback.previous()
                    }
                    withAnimation(.snappy) { drag = .zero }
                }
        )
        .accessibilityElement(children: .contain)
    }
}
