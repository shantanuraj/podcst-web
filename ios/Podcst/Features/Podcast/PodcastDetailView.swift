import SwiftUI

struct PodcastDetailView: View {
    let podcastId: Int

    @State private var podcast: PodcastInfo?
    @State private var episodes: [Episode] = []
    @State private var hasMore = true
    @State private var nextCursor: Int?
    @State private var isLoading = true
    @State private var isLoadingMore = false
    @State private var searchText = ""
    @State private var error: Error?

    private let apiClient = APIClient(baseURL: Configuration.apiBaseURL)

    var body: some View {
        List {
            if let podcast {
                PodcastHeaderView(podcast: podcast)
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)

                ForEach(episodes, id: \.stableId) { episode in
                    EpisodeRowView(episode: episode)
                }

                if hasMore && !isLoadingMore {
                    Color.clear
                        .frame(height: 1)
                        .onAppear {
                            Task { await loadMoreEpisodes() }
                        }
                }

                if isLoadingMore {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                    .listRowSeparator(.hidden)
                }
            } else if isLoading {
                HStack {
                    Spacer()
                    ProgressView()
                    Spacer()
                }
                .listRowSeparator(.hidden)
            } else if let error {
                ContentUnavailableView(
                    "Failed to load",
                    systemImage: "wifi.slash",
                    description: Text(error.localizedDescription)
                )
            }
        }
        .listStyle(.plain)
        .navigationTitle(podcast?.title ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $searchText, prompt: "Search episodes")
        .onChange(of: searchText) { _, _ in
            Task { await searchEpisodes() }
        }
        .task {
            await loadPodcast()
            await loadMoreEpisodes()
        }
    }

    private func loadPodcast() async {
        do {
            podcast = try await apiClient.fetchPodcastInfo(id: podcastId)
        } catch {
            self.error = error
        }
        isLoading = false
    }

    private func loadMoreEpisodes() async {
        guard !isLoadingMore else { return }
        isLoadingMore = true

        do {
            let result = try await apiClient.fetchEpisodes(
                podcastId: podcastId,
                limit: 20,
                cursor: nextCursor,
                search: searchText.isEmpty ? nil : searchText
            )
            episodes.append(contentsOf: result.episodes)
            hasMore = result.hasMore
            nextCursor = result.nextCursor
        } catch {
            self.error = error
        }

        isLoadingMore = false
    }

    private func searchEpisodes() async {
        episodes = []
        nextCursor = nil
        hasMore = true
        await loadMoreEpisodes()
    }
}

struct PodcastHeaderView: View {
    let podcast: PodcastInfo

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 16) {
                AsyncImage(url: URL(string: podcast.cover)) { image in
                    image
                        .resizable()
                        .aspectRatio(1, contentMode: .fill)
                } placeholder: {
                    Rectangle()
                        .fill(.tertiary)
                }
                .frame(width: 120, height: 120)
                .clipped()
                .overlay {
                    Rectangle()
                        .strokeBorder(.primary.opacity(0.1), lineWidth: 1)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text(podcast.title)
                        .font(.title2)
                        .fontWeight(.semibold)

                    Text(podcast.author)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    Text("\(podcast.episodeCount) episodes")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }

            if !podcast.description.isEmpty {
                Text(podcast.description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(4)
            }

            SubscribeButton(podcastId: podcast.id)
        }
        .padding()
    }
}

struct SubscribeButton: View {
    let podcastId: Int
    @State private var isSubscribed = false
    @State private var isLoading = false

    private let apiClient = APIClient(baseURL: Configuration.apiBaseURL)

    var body: some View {
        Button {
            Task { await toggleSubscription() }
        } label: {
            HStack {
                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: isSubscribed ? "checkmark" : "plus")
                }
                Text(isSubscribed ? "Subscribed" : "Subscribe")
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .tint(isSubscribed ? .secondary : .accentColor)
        .disabled(isLoading)
    }

    private func toggleSubscription() async {
        isLoading = true
        defer { isLoading = false }

        do {
            if isSubscribed {
                try await apiClient.unsubscribe(podcastId: podcastId)
                isSubscribed = false
            } else {
                try await apiClient.subscribe(podcastId: podcastId)
                isSubscribed = true
            }
        } catch {
        }
    }
}
