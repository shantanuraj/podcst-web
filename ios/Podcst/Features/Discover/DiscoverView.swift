import SwiftUI

struct DiscoverView: View {
    @State private var podcasts: [Podcast] = []
    @State private var isLoading = true
    @State private var error: Error?

    private let apiClient = APIClient(baseURL: Configuration.apiBaseURL)

    private let columns = [
        GridItem(.adaptive(minimum: 150), spacing: 16)
    ]

    var body: some View {
        ScrollView {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(.top, 100)
            } else if let error {
                ContentUnavailableView(
                    "Failed to load",
                    systemImage: "wifi.slash",
                    description: Text(error.localizedDescription)
                )
            } else {
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(podcasts) { podcast in
                        NavigationLink(value: Destination.podcast(podcast.id)) {
                            PodcastTile(podcast: podcast)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding()
            }
        }
        .navigationTitle("Discover")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                NavigationLink(value: Destination.search) {
                    Image(systemName: "magnifyingglass")
                }
            }
        }
        .task {
            await loadTopPodcasts()
        }
        .refreshable {
            await loadTopPodcasts()
        }
    }

    private func loadTopPodcasts() async {
        isLoading = true
        error = nil

        do {
            podcasts = try await apiClient.fetchTopPodcasts(
                limit: 50,
                locale: Configuration.defaultLocale
            )
        } catch {
            self.error = error
        }

        isLoading = false
    }
}
