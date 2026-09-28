import SwiftUI

struct LibraryView: View {
    @Environment(LibraryStore.self) private var library
    @Environment(SessionStore.self) private var session
    @Environment(PlaybackController.self) private var playback
    @State private var showingLogin = false

    private var continueAndNew: [Episode] {
        let current = playback.currentEpisode.flatMap { playback.currentTime > 0 ? $0 : nil }
        return (current.map { [$0] } ?? []) + library.newReleases.filter { $0.identity != current?.identity }
    }

    var body: some View {
        ScrollView {
            if library.podcasts.isEmpty {
                Group {
                    if library.isLoading {
                        ProgressView().tint(PodcstPalette.accent)
                    } else {
                        EmptyLibraryView(signedIn: session.user != nil) { showingLogin = true }
                    }
                }
                .frame(maxWidth: .infinity)
                .containerRelativeFrame(.vertical)
            } else {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if !continueAndNew.isEmpty {
                        SectionHeader("Continue & new") {
                            NavigationLink("See all", value: Route.releases)
                                .font(.sans(.footnote).weight(.medium))
                                .foregroundStyle(PodcstPalette.accent)
                        }
                        ForEach(continueAndNew.prefix(3), id: \.identity) { episode in
                            EpisodeRow(episode: episode, context: .library)
                        }
                    }
                    SectionHeader("Subscriptions") {
                        Text(library.podcasts.count == 1 ? "1 show" : "\(library.podcasts.count) shows")
                            .font(.sans(.footnote))
                            .foregroundStyle(PodcstPalette.tertiary)
                    }
                    .padding(.top, 22)
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 3), spacing: 14) {
                        ForEach(library.podcasts, id: \.identity) { podcast in
                            NavigationLink(value: Route.podcast(podcast)) {
                                ArtworkView(url: podcast.artworkURL)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(podcast.title), \(podcast.author)")
                        }
                    }
                    .padding(.top, 14)
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 24)
            }
        }
        .refreshable { await library.load(forceRefresh: true) }
        .podcstPage()
        .screenHeader("Library") {
            HStack(spacing: 14) {
                NavigationLink(value: Route.downloads) {
                    Image(systemName: "arrow.down.circle")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("Downloads")
                if session.user == nil {
                    Button("Sign in") { showingLogin = true }
                        .font(.sans(.body).weight(.medium))
                        .foregroundStyle(PodcstPalette.accent)
                }
                AccountButton()
            }
        }
        .sheet(isPresented: $showingLogin) { LoginView() }
    }
}

struct ReleasesView: View {
    @Environment(LibraryStore.self) private var library
    @Environment(\.locale) private var locale

    var body: some View {
        TimelineView(.periodic(from: ReleaseSection.calendar.startOfDay(for: .now), by: 86400)) { timeline in
            let sections = ReleaseSection.grouping(library.newReleases)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(sections) { section in
                        Section {
                            ForEach(section.episodes, id: \.identity) { episode in
                                EpisodeRow(
                                    episode: episode,
                                    context: .releases,
                                    showsSeparator: episode.identity != section.episodes.last?.identity
                                )
                            }
                        } header: {
                            let recent = section.isRecent(relativeTo: timeline.date)
                            Text(section.title(relativeTo: timeline.date, locale: locale))
                                .font(.sans(recent ? .subheadline : .footnote).weight(.medium))
                                .foregroundStyle(recent ? PodcstPalette.ink : PodcstPalette.secondary)
                                .accessibilityAddTraits(.isHeader)
                                .padding(.top, section.id == sections.first?.id ? 8 : 20)
                                .padding(.bottom, 4)
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
            .refreshable { await library.load(forceRefresh: true) }
        }
        .podcstPage()
        .navigationTitle("New releases")
    }
}

private struct EmptyLibraryView: View {
    @Environment(Router.self) private var router
    let signedIn: Bool
    let signIn: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            EmptyState(systemImage: "square.grid.2x2", title: "Your library is empty", message: "Subscribe to podcasts and keep your listening in one place across devices.")
            Button("Browse top podcasts") { router.tab = .discover }
                .buttonStyle(PodcstButtonStyle(kind: .accent))
            if !signedIn {
                Button("Sign in to sync", action: signIn)
                    .buttonStyle(PodcstButtonStyle(kind: .outline))
            }
        }
        .frame(maxWidth: 320)
        .padding(28)
    }
}
