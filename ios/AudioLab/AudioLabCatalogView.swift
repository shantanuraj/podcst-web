import SwiftUI

struct AudioLabCatalogView: View {
    @Environment(APIClient.self) private var api
    @Environment(\.dismiss) private var dismiss
    let onSelect: (Episode) -> Void
    @State private var query = ""
    @State private var topPodcasts: [Podcast] = []
    @State private var loadingTop = true
    @State private var topError = false
    @State private var searchState = SearchState.loading

    private enum SearchState {
        case loading
        case loaded([Podcast])
        case failed
    }

    private var term: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            List {
                if term.isEmpty {
                    Section("Top podcasts · United States") {
                        if topError {
                            AudioLabCatalogError(message: "Top podcasts could not be loaded.") {
                                await loadTop(refresh: true)
                            }
                        }
                        if topPodcasts.isEmpty {
                            if loadingTop {
                                ProgressView("Loading top podcasts…")
                            } else if !topError {
                                Text("No top podcasts are available right now.")
                                    .foregroundStyle(.secondary)
                            }
                        }
                        podcasts(topPodcasts)
                    }
                } else {
                    Section("Search results") {
                        switch searchState {
                        case .loading:
                            ProgressView("Searching podcasts…")
                        case .loaded(let results):
                            if results.isEmpty {
                                ContentUnavailableView("No podcasts found", systemImage: "magnifyingglass", description: Text("Try another name or paste an RSS feed link."))
                            } else {
                                podcasts(results)
                            }
                        case .failed:
                            AudioLabCatalogError(message: "Search could not be completed. Check your connection or try another name or RSS feed link.") {
                                await search(term, debounce: false)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Choose an episode")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Podcasts or RSS link")
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .refreshable {
                if term.isEmpty {
                    await loadTop(refresh: true)
                } else {
                    await search(term, debounce: false)
                }
            }
            .onChange(of: term) { _, _ in searchState = .loading }
            .task { await loadTop() }
            .task(id: term) { await search(term) }
        }
        .tint(PodcstPalette.accent)
    }

    private func podcasts(_ values: [Podcast]) -> some View {
        ForEach(values, id: \.identity) { podcast in
            NavigationLink {
                AudioLabEpisodesView(podcast: podcast, onClose: { dismiss() }) { episode in
                    onSelect(episode)
                    dismiss()
                }
            } label: {
                AudioLabPodcastLabel(podcast: podcast)
            }
            .accessibilityLabel("\(podcast.title), \(podcast.author)")
            .accessibilityHint("Choose an episode to test")
        }
    }

    private func loadTop(refresh: Bool = false) async {
        if topPodcasts.isEmpty, let cached = api.cachedTop(locale: "us", limit: 30) {
            topPodcasts = cached
        }
        loadingTop = true
        topError = false
        defer { loadingTop = false }
        do {
            let results = try await (refresh ? api.refreshTop(locale: "us", limit: 30) : api.top(locale: "us", limit: 30))
            guard !Task.isCancelled else { return }
            topPodcasts = results
        } catch {
            guard !Task.isCancelled else { return }
            topError = true
        }
    }

    private func search(_ requestedTerm: String, debounce: Bool = true) async {
        guard !requestedTerm.isEmpty else { return }
        searchState = .loading
        do {
            if debounce { try await Task.sleep(for: .milliseconds(300)) }
            let results: [Podcast]
            if let url = URL(string: requestedTerm), ["http", "https"].contains(url.scheme?.lowercased()), url.host != nil {
                results = [try await api.podcast(feed: requestedTerm)]
            } else {
                results = try await api.search(term: requestedTerm, locale: "us")
            }
            guard !Task.isCancelled, requestedTerm == term else { return }
            searchState = .loaded(results)
        } catch {
            guard !Task.isCancelled, requestedTerm == term else { return }
            searchState = .failed
        }
    }
}

private struct AudioLabEpisodesView: View {
    @Environment(APIClient.self) private var api
    let podcast: Podcast
    let onClose: () -> Void
    let onSelect: (Episode) -> Void
    @State private var detail: Podcast?
    @State private var loading = true
    @State private var failed = false
    @State private var filter = ""

    private var content: Podcast { detail ?? podcast }

    private var episodes: [Episode] {
        let term = filter.trimmingCharacters(in: .whitespacesAndNewlines)
        return content.episodes
            .filter { term.isEmpty || $0.title.localizedCaseInsensitiveContains(term) }
            .sorted { ($0.published ?? .distantPast) > ($1.published ?? .distantPast) }
    }

    var body: some View {
        List {
            Section {
                AudioLabPodcastLabel(podcast: content)
            }
            Section {
                if failed {
                    AudioLabCatalogError(message: "The full episode list could not be loaded.", retry: load)
                }
                if loading {
                    ProgressView("Loading episodes…")
                }
                ForEach(episodes, id: \.identity) { episode in
                    Button {
                        var selection = episode
                        selection.podcastTitle = selection.podcastTitle ?? content.title
                        selection.podcastId = selection.podcastId ?? content.id
                        if selection.feed.isEmpty { selection.feed = content.feed }
                        if selection.cover.isEmpty { selection.cover = content.cover }
                        onSelect(selection)
                    } label: {
                        AudioLabEpisodeLabel(episode: episode)
                    }
                    .buttonStyle(.plain)
                    .disabled(!canPlay(episode))
                    .accessibilityHint(canPlay(episode) ? "Play this episode in Audio Lab" : "This episode has no playable audio link")
                }
                if episodes.isEmpty, !loading, !failed {
                    ContentUnavailableView(
                        filter.isEmpty ? "No episodes available" : "No matching episodes",
                        systemImage: filter.isEmpty ? "waveform" : "magnifyingglass",
                        description: Text(filter.isEmpty ? "Choose another podcast to test." : "Try another episode title.")
                    )
                }
            } header: {
                Text("Episodes · Newest first")
            }
        }
        .navigationTitle("Episodes")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $filter, prompt: "Filter episodes")
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done", action: onClose)
            }
        }
        .task { await load() }
    }

    private func canPlay(_ episode: Episode) -> Bool {
        guard let url = episode.audioURL else { return false }
        return ["http", "https"].contains(url.scheme?.lowercased()) && url.host != nil
    }

    private func load() async {
        detail = detail ?? api.cachedPodcast(id: podcast.id, feed: podcast.feed)
        loading = true
        failed = false
        defer { loading = false }
        do {
            let result = try await api.detail(of: content)
            guard !Task.isCancelled else { return }
            detail = result
        } catch {
            guard !Task.isCancelled else { return }
            failed = true
        }
    }
}

private struct AudioLabPodcastLabel: View {
    let podcast: Podcast

    var body: some View {
        HStack(spacing: 12) {
            ArtworkView(url: podcast.artworkURL, size: 52)
            VStack(alignment: .leading, spacing: 4) {
                Text(podcast.title)
                    .font(.headline)
                    .lineLimit(2)
                Text(podcast.author)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct AudioLabEpisodeLabel: View {
    let episode: Episode

    private var metadata: String {
        [
            episode.published?.formatted(date: .abbreviated, time: .omitted),
            episode.duration.flatMap { $0 > 0 ? Duration.seconds($0) : nil },
        ].compactMap { $0 }.joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(episode.title)
                    .font(.body.weight(.medium))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                Text(metadata)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "play.circle")
                .font(.title2)
                .foregroundStyle(PodcstPalette.accent)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 5)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

private struct AudioLabCatalogError: View {
    let message: String
    let retry: () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message).foregroundStyle(.secondary)
            Button("Retry") { Task { await retry() } }
        }
    }
}
