import SwiftUI

struct LibraryView: View {
    @Environment(LibraryStore.self) private var library
    @Environment(SessionStore.self) private var session
    @State private var showingLogin = false
    @State private var showingNewReleases = false

    var body: some View {
        NavigationStack {
            Group {
                if library.isLoading && library.podcasts.isEmpty {
                    ProgressView().tint(PodcstPalette.accent)
                } else if library.podcasts.isEmpty {
                    EmptyLibraryView { showingLogin = true }
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 28) {
                            SectionHeader(title: "Your library")
                            PodcastGrid(podcasts: library.podcasts)
                            if !library.newReleases.isEmpty {
                                SectionHeader(title: "New releases")
                                LazyVStack(spacing: 0) {
                                    ForEach(library.newReleases, id: \.identity) { episode in
                                        EpisodeRow(episode: episode)
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 18)
                        .padding(.bottom, 24)
                    }
                }
            }
            .podcstPage()
            .navigationTitle("Library")
            .refreshable { await library.load(forceRefresh: true) }
            .task { await library.load() }
            .navigationDestination(for: Podcast.self) { podcast in
                PodcastDetailView(podcast: podcast)
            }
            .navigationDestination(for: Episode.self) { episode in
                EpisodeDetailView(episode: episode)
            }
            .sheet(isPresented: $showingLogin) { LoginView() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if session.user == nil {
                        Button("Sign in") { showingLogin = true }
                            .foregroundStyle(PodcstPalette.accent)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    AccountToolbarItem()
                }
            }
        }
    }
}

struct EmptyLibraryView: View {
    let signIn: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "books.vertical")
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(PodcstPalette.tertiary)
            Text("Your library is empty")
                .font(.system(.title2, design: .serif))
            Text("Subscribe to podcasts and keep your listening in one place across devices.")
                .font(.body)
                .foregroundStyle(PodcstPalette.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 300)
            Button("Sign in to sync") { signIn() }
                .buttonStyle(.borderedProminent)
                .tint(PodcstPalette.accent)
        }
        .padding(28)
    }
}

struct PodcastDetailView: View {
    @Environment(APIClient.self) private var api
    @Environment(LibraryStore.self) private var library
    @Environment(PlaybackController.self) private var playback
    let podcast: Podcast
    @State private var detail: Podcast?
    @State private var isLoading = false
    @State private var episodeSearch = ""

    private var content: Podcast { detail ?? podcast }
    private var episodes: [Episode] {
        content.episodes.filter {
            episodeSearch.isEmpty || $0.title.localizedCaseInsensitiveContains(episodeSearch)
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 22) {
                PodcastHero(podcast: content, isSubscribed: library.isSubscribed(content)) {
                    Task { await library.toggleSubscription(content) }
                }
                if !content.episodes.isEmpty {
                    HStack {
                        Text("Episodes").font(.system(.title2, design: .serif))
                        Spacer()
                        Button {
                            if let first = episodes.first { playback.play(first) }
                        } label: {
                            Label("Play latest", systemImage: "play.fill")
                                .font(.subheadline.weight(.medium))
                        }
                        .foregroundStyle(PodcstPalette.accent)
                    }
                    .padding(.horizontal, 20)
                    if content.episodes.count > 10 {
                        TextField("Filter episodes", text: $episodeSearch)
                            .textFieldStyle(.roundedBorder)
                            .padding(.horizontal, 20)
                    }
                    LazyVStack(spacing: 0) {
                        ForEach(episodes, id: \.identity) { episode in
                            EpisodeRow(episode: episode)
                        }
                    }
                    .padding(.horizontal, 20)
                } else if isLoading {
                    ProgressView().frame(maxWidth: .infinity).padding(30)
                } else {
                    Text("No episodes available.")
                        .foregroundStyle(PodcstPalette.secondary)
                        .padding(.horizontal, 20)
                }
            }
            .padding(.vertical, 18)
            .padding(.bottom, 24)
        }
        .podcstPage()
        .navigationTitle(content.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadDetails() }
    }

    private func loadDetails() async {
        if detail == nil {
            detail = api.cachedPodcast(id: podcast.id, feed: podcast.feed)
        }
        isLoading = detail == nil
        defer { isLoading = false }
        do {
            if let id = podcast.id {
                detail = try await api.podcast(id: id)
            } else {
                detail = try await api.podcast(feed: podcast.feed)
            }
        } catch {
            detail = podcast
        }
    }
}

struct PodcastHero: View {
    let podcast: Podcast
    let isSubscribed: Bool
    let toggle: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 16) {
                ArtworkView(url: podcast.artworkURL, size: 128)
                VStack(alignment: .leading, spacing: 8) {
                    Text(podcast.title)
                        .font(.system(.title, design: .serif))
                    Text(podcast.author)
                        .foregroundStyle(PodcstPalette.secondary)
                    Button(isSubscribed ? "Subscribed" : "Subscribe", action: toggle)
                        .buttonStyle(.borderedProminent)
                        .tint(isSubscribed ? PodcstPalette.surface : PodcstPalette.accent)
                }
            }
            if !podcast.description.isEmpty {
                Text(podcast.description.strippingHTML)
                    .font(.subheadline)
                    .foregroundStyle(PodcstPalette.secondary)
                    .lineLimit(5)
            }
        }
        .padding(.horizontal, 20)
    }
}

struct EpisodeRow: View {
    @Environment(PlaybackController.self) private var playback
    let episode: Episode

    var body: some View {
        HStack(spacing: 12) {
            NavigationLink(value: episode) {
                HStack(spacing: 12) {
                    ArtworkView(url: episode.artworkURL, size: 58)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(episode.title)
                            .font(.subheadline.weight(.medium))
                            .lineLimit(2)
                        HStack(spacing: 8) {
                            if let published = episode.published {
                                Text(published, format: .dateTime.month(.abbreviated).day())
                            }
                            if let duration = episode.duration, duration > 0 {
                                Text(Duration.seconds(duration))
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(PodcstPalette.tertiary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            Button {
                playback.play(episode)
            } label: {
                Image(systemName: "play.circle.fill")
                    .font(.title2)
                    .foregroundStyle(PodcstPalette.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Play \(episode.title)")
            Menu {
                Button("Play next") { playback.enqueue(episode, next: true) }
                Button("Add to queue") { playback.enqueue(episode) }
            } label: {
                Image(systemName: "ellipsis")
                    .foregroundStyle(PodcstPalette.secondary)
                    .frame(width: 30, height: 40)
            }
            .accessibilityLabel("Episode actions")
        }
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) { Divider().overlay(PodcstPalette.rule) }
    }
}

struct EpisodeDetailView: View {
    @Environment(PlaybackController.self) private var playback
    let episode: Episode

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                ArtworkView(url: episode.artworkURL, size: 260)
                    .frame(maxWidth: .infinity)
                VStack(alignment: .leading, spacing: 8) {
                    Text(episode.title)
                        .font(.system(.title, design: .serif))
                    if let podcastTitle = episode.podcastTitle {
                        Text(podcastTitle)
                            .foregroundStyle(PodcstPalette.secondary)
                    }
                    HStack(spacing: 10) {
                        if let published = episode.published {
                            Text(published, format: .dateTime.year().month(.abbreviated).day())
                        }
                        if let duration = episode.duration, duration > 0 {
                            Text(Duration.seconds(duration))
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(PodcstPalette.tertiary)
                }
                HStack(spacing: 12) {
                    Button {
                        playback.play(episode)
                    } label: {
                        Label("Play", systemImage: "play.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(PodcstPalette.accent)
                    Button("Play next") {
                        playback.enqueue(episode, next: true)
                    }
                    .buttonStyle(.bordered)
                }
                ShowNotesContent(episode: episode)
            }
            .padding(20)
        }
        .podcstPage()
        .navigationTitle("Episode")
        .navigationBarTitleDisplayMode(.inline)
    }
}

extension String {
    var strippingHTML: String {
        replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
    }
}

enum Duration {
    static func seconds(_ value: Double) -> String {
        let minutes = Int(value / 60)
        if minutes < 60 { return "\(minutes) min" }
        return "\(minutes / 60) hr \(minutes % 60) min"
    }

    static func clock(_ value: Double) -> String {
        let total = max(0, Int(value.rounded(.down)))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60
        if hours > 0 { return String(format: "%d:%02d:%02d", hours, minutes, seconds) }
        return String(format: "%02d:%02d", minutes, seconds)
    }
}
