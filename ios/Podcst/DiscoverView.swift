import SwiftUI

struct DiscoverView: View {
    @Environment(APIClient.self) private var api
    @State private var topPodcasts: [Podcast] = []
    @State private var searchResults: [Podcast] = []
    @State private var searchText = ""
    @State private var isSearching = false
    @State private var error: String?
    @State private var region = "us"

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 28) {
                    if let error {
                        ErrorRow(message: error) {
                            await loadTop()
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
            .onChange(of: searchText) { _, term in
                Task { await search(term) }
            }
            .refreshable { await loadTop() }
            .task { await loadTop() }
            .navigationDestination(for: Podcast.self) { podcast in
                PodcastDetailView(podcast: podcast)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        ForEach(["us", "nl", "fr", "in", "se"], id: \.self) { code in
                            Button(code.uppercased()) {
                                region = code
                                Task { await loadTop() }
                            }
                        }
                    } label: {
                        Label(region.uppercased(), systemImage: "globe")
                    }
                    .accessibilityLabel("Region: \(region.uppercased())")
                }
            }
        }
    }

    private func loadTop() async {
        do {
            topPodcasts = try await api.top(locale: region, limit: 30)
            error = nil
        } catch {
            self.error = "Top podcasts are unavailable right now."
        }
    }

    private func search(_ term: String) async {
        guard !term.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            searchResults = []
            return
        }
        isSearching = true
        defer { isSearching = false }
        do {
            searchResults = try await api.search(term: term, locale: region).map {
                Podcast(id: $0.id, feed: $0.feed, title: $0.title, author: $0.author, cover: $0.thumbnail, thumbnail: $0.thumbnail)
            }
        } catch {
            searchResults = []
        }
    }
}

struct PodcastGrid: View {
    let podcasts: [Podcast]

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 24) {
            ForEach(podcasts) { podcast in
                NavigationLink(value: podcast) {
                    PodcastCard(podcast: podcast)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct PodcastCard: View {
    let podcast: Podcast

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            ArtworkView(url: podcast.artworkURL, size: 160)
                .frame(maxWidth: .infinity)
                .aspectRatio(1, contentMode: .fit)
            Text(podcast.title)
                .font(.headline)
                .lineLimit(2)
            Text(podcast.author)
                .font(.subheadline)
                .foregroundStyle(PodcstPalette.secondary)
                .lineLimit(1)
        }
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
