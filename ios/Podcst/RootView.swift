import SwiftUI

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
    case downloads
}

@MainActor
@Observable
final class Router {
    var tab: AppTab = .discover
    var showingPlayer = false
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
}

struct RootView: View {
    @Environment(LibraryStore.self) private var library
    @Environment(SessionStore.self) private var session
    @Environment(PlaybackController.self) private var playback
    @AppStorage(Appearance.key) private var appearance = Appearance.system
    @AppStorage("onboarded") private var onboarded = false
    @State private var router = Router()
    @State private var initialTabConfigured = false

    var body: some View {
        @Bindable var router = router
        Group {
            if initialTabConfigured {
                tabs
            } else {
                StartupView()
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
            await playback.restore()
            if playback.currentEpisode == nil, let progress = library.progress {
                playback.restore(progress.episode, at: progress.position)
            }
        }
        .downloadAlerts()
        .font(.sans(.body))
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
                        case .downloads: DownloadsView()
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

    func body(content: Content) -> some View {
        content.safeAreaInset(edge: .bottom, spacing: 0) {
            if playback.currentEpisode != nil {
                NowPlayingBar()
                    .padding(.horizontal, 12)
                    .padding(.bottom, 10)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: playback.currentEpisode == nil)
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
    @State private var dragOffset: CGFloat = 0

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
            Button {
                router.showingPlayer = true
            } label: {
                HStack(spacing: 12) {
                    ArtworkView(url: playback.currentEpisode?.artworkURL, fallbackURL: playback.currentEpisode.flatMap { URL(string: $0.cover) }, size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(playback.currentEpisode?.title ?? "")
                            .font(.sans(.subheadline).weight(.medium))
                            .lineLimit(1)
                        subtitle
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .offset(x: dragOffset)
                .opacity(1 - min(0.55, abs(dragOffset) / 240))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(playback.currentEpisode?.title ?? ""), \(playback.currentEpisode?.podcastTitle ?? "Podcst")")
            .accessibilityHint("Open Now Playing")
            .accessibilityAction(named: "Next episode") { playback.next() }
            .accessibilityAction(named: "Previous episode") { playback.previous() }
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
        .simultaneousGesture(
            DragGesture(minimumDistance: 24)
                .onChanged { value in
                    guard abs(value.translation.width) > abs(value.translation.height), playback.queue.count > 1 else { return }
                    dragOffset = value.translation.width
                }
                .onEnded { _ in
                    if dragOffset < -70 { playback.next() } else if dragOffset > 70 { playback.previous() }
                    withAnimation(.snappy) { dragOffset = 0 }
                }
        )
        .accessibilityElement(children: .contain)
    }
}
