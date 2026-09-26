import SwiftUI

struct DiscoverView: View {
    @Environment(APIClient.self) private var api
    @State private var topPodcasts: [Podcast] = []
    @State private var searchResults: [Podcast] = []
    @State private var searchText = ""
    @State private var error: String?
    @AppStorage("region") private var region = "us"

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 28) {
                    if let error {
                        ErrorRow(message: error) {
                            await loadTop(forceRefresh: true)
                        }
                    }
                    if !searchText.isEmpty {
                        SectionHeader(title: "Search")
                        PodcastGrid(podcasts: searchResults)
                    } else {
                        SectionHeader(title: "Top podcasts", detail: region.uppercased())
                        PodcastGrid(podcasts: topPodcasts)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 24)
            }
            .podcstPage()
            .navigationTitle("Discover")
            .searchable(text: $searchText, prompt: "Search podcasts")
            .task(id: searchText) {
                do {
                    try await Task.sleep(for: .milliseconds(300))
                } catch {
                    return
                }
                guard !Task.isCancelled else { return }
                await search(searchText)
            }
            .refreshable { await loadTop(forceRefresh: true) }
            .task(id: region) { await loadTop() }
            .navigationDestination(for: Podcast.self) { podcast in
                PodcastDetailView(podcast: podcast)
            }
            .navigationDestination(for: Episode.self) { episode in
                EpisodeDetailView(episode: episode)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    AccountToolbarItem()
                }
            }
        }
    }

    private func loadTop(forceRefresh: Bool = false) async {
        if let cached = api.cachedTop(locale: region, limit: 30) {
            topPodcasts = cached
        }
        do {
            topPodcasts = try await (forceRefresh ? api.refreshTop(locale: region, limit: 30) : api.top(locale: region, limit: 30))
            error = nil
        } catch {
            self.error = "Top podcasts are unavailable right now."
        }
    }

    private func search(_ term: String) async {
        let trimmed = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            searchResults = []
            return
        }
        do {
            if let url = URL(string: trimmed), ["http", "https"].contains(url.scheme?.lowercased()) {
                searchResults = [try await api.podcast(feed: trimmed)]
                return
            }
            searchResults = try await api.search(term: trimmed, locale: region).map {
                Podcast(id: $0.id, feed: $0.feed, title: $0.title, author: $0.author, cover: $0.thumbnail, thumbnail: $0.thumbnail)
            }
        } catch {
            searchResults = []
        }
    }
}

struct PodcastGrid: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .headline) private var minimumCardWidth = 148
    let podcasts: [Podcast]

    private var columns: [GridItem] {
        [GridItem(
            dynamicTypeSize.isAccessibilitySize ? .flexible() : .adaptive(minimum: minimumCardWidth),
            spacing: 18,
            alignment: .top
        )]
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 26) {
            ForEach(podcasts, id: \.identity) { podcast in
                NavigationLink(value: podcast) {
                    PodcastCard(podcast: podcast)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(podcast.title), \(podcast.author)")
            }
        }
    }
}

struct PodcastCard: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let podcast: Podcast

    @ViewBuilder
    private var title: some View {
        if dynamicTypeSize.isAccessibilitySize {
            Text(podcast.title)
                .font(.headline)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            Text(podcast.title)
                .font(.headline)
                .lineLimit(2, reservesSpace: true)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            ArtworkView(url: podcast.artworkURL)
            title
                .frame(maxWidth: .infinity, alignment: .topLeading)
            Text(podcast.author)
                .font(.subheadline)
                .foregroundStyle(PodcstPalette.secondary)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .multilineTextAlignment(.leading)
    }
}

struct SectionHeader: View {
    let title: String
    var detail: String?

    init(title: String, detail: String? = nil) {
        self.title = title
        self.detail = detail
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.system(.title2, design: .serif))
            Spacer()
            if let detail {
                Text(detail)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(PodcstPalette.tertiary)
            }
        }
    }
}

struct ErrorRow: View {
    let message: String
    let retry: () async -> Void

    var body: some View {
        HStack {
            Text(message).font(.subheadline).foregroundStyle(PodcstPalette.secondary)
            Spacer()
            Button("Retry") { Task { await retry() } }
                .foregroundStyle(PodcstPalette.accent)
        }
        .padding(14)
        .background(PodcstPalette.accentSoft, in: RoundedRectangle(cornerRadius: 12))
    }
}
