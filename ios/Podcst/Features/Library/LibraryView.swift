import SwiftUI
import SwiftData

struct LibraryView: View {
    @State private var selectedTab = 0

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $selectedTab) {
                Text("Subscriptions").tag(0)
                Text("Downloads").tag(1)
            }
            .pickerStyle(.segmented)
            .padding()

            TabView(selection: $selectedTab) {
                SubscriptionsListView()
                    .tag(0)

                DownloadsView()
                    .tag(1)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
        }
        .navigationTitle("Library")
    }
}

struct SubscriptionsListView: View {
    @State private var subscriptions: [PodcastWithEpisodes] = []
    @State private var isLoading = true
    @State private var error: Error?

    private let apiClient = APIClient(baseURL: Configuration.apiBaseURL)

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if subscriptions.isEmpty {
                ContentUnavailableView(
                    "No Subscriptions",
                    systemImage: "star",
                    description: Text("Subscribe to podcasts to see them here")
                )
            } else {
                List {
                    ForEach(subscriptions, id: \.stableId) { subscription in
                        NavigationLink(value: subscription.id.map { Destination.podcast($0) }) {
                            HStack(spacing: 12) {
                                AsyncImage(url: URL(string: subscription.cover)) { image in
                                    image
                                        .resizable()
                                        .aspectRatio(contentMode: .fill)
                                } placeholder: {
                                    Rectangle()
                                        .fill(.tertiary)
                                }
                                .frame(width: 60, height: 60)
                                .clipped()

                                VStack(alignment: .leading, spacing: 4) {
                                    Text(subscription.title)
                                        .font(.headline)
                                        .lineLimit(1)

                                    Text(subscription.author)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)

                                    if let latestEpisode = subscription.episodes.first {
                                        Text(latestEpisode.title)
                                            .font(.caption)
                                            .foregroundStyle(.tertiary)
                                            .lineLimit(1)
                                    }
                                }
                            }
                        }
                        .disabled(subscription.id == nil)
                    }
                }
                .listStyle(.plain)
            }
        }
        .task {
            await loadSubscriptions()
        }
        .refreshable {
            await loadSubscriptions()
        }
    }

    private func loadSubscriptions() async {
        isLoading = true
        error = nil

        do {
            subscriptions = try await apiClient.fetchSubscriptions()
        } catch APIError.unauthorized {
            subscriptions = []
        } catch {
            self.error = error
        }

        isLoading = false
    }
}

struct DownloadsView: View {
    @Query private var downloads: [DownloadedEpisode]

    var body: some View {
        Group {
            if downloads.isEmpty {
                ContentUnavailableView(
                    "No Downloads",
                    systemImage: "arrow.down.circle",
                    description: Text("Download episodes to listen offline")
                )
            } else {
                List {
                    ForEach(downloads, id: \.episodeId) { download in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Episode \(download.episodeId)")
                                .font(.headline)

                            Text(download.downloadedAt, style: .relative)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
    }
}
