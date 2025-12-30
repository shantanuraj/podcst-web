import SwiftUI

struct SearchView: View {
    @State private var searchText = ""
    @State private var results: [PodcastSearchResult] = []
    @State private var isSearching = false
    @State private var searchTask: Task<Void, Never>?

    private let apiClient = APIClient(baseURL: Configuration.apiBaseURL)

    var body: some View {
        List {
            if results.isEmpty && !searchText.isEmpty && !isSearching {
                ContentUnavailableView.search(text: searchText)
            } else {
                ForEach(results, id: \.stableId) { result in
                    NavigationLink(value: result.id.map { Destination.podcast($0) }) {
                        HStack(spacing: 12) {
                            AsyncImage(url: URL(string: result.thumbnail)) { image in
                                image
                                    .resizable()
                                    .aspectRatio(contentMode: .fill)
                            } placeholder: {
                                Rectangle()
                                    .fill(.tertiary)
                            }
                            .frame(width: 56, height: 56)
                            .clipped()

                            VStack(alignment: .leading, spacing: 4) {
                                Text(result.title)
                                    .font(.headline)
                                    .lineLimit(2)

                                Text(result.author)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                    }
                    .disabled(result.id == nil)
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle("Search")
        .searchable(text: $searchText, prompt: "Search podcasts")
        .onChange(of: searchText) { _, newValue in
            searchTask?.cancel()
            searchTask = Task {
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }
                await search(term: newValue)
            }
        }
        .overlay {
            if isSearching {
                ProgressView()
            }
        }
    }

    private func search(term: String) async {
        guard !term.isEmpty else {
            results = []
            return
        }

        isSearching = true
        defer { isSearching = false }

        do {
            results = try await apiClient.searchPodcasts(
                term: term,
                locale: Configuration.defaultLocale
            )
        } catch {
            results = []
        }
    }
}
