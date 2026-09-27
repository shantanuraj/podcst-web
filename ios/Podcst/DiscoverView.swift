import SwiftUI

struct DiscoverView: View {
    @Environment(APIClient.self) private var api
    @State private var topPodcasts: [Podcast] = []
    @State private var error: String?
    @AppStorage(DiscoveryRegion.key) private var region = DiscoveryRegion.detected.rawValue

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if let error {
                    ErrorRow(message: error) {
                        await loadTop(forceRefresh: true)
                    }
                    .padding(.bottom, 18)
                }
                SectionHeader("Top podcasts") {
                    Text("\(region) · Today").eyebrow()
                }
                if let first = topPodcasts.first {
                    FeaturedChartRow(podcast: first)
                }
                ForEach(Array(topPodcasts.dropFirst().enumerated()), id: \.element.identity) { offset, podcast in
                    RankedPodcastRow(rank: offset + 2, podcast: podcast)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 24)
        }
        .podcstPage()
        .screenHeader("Discover") { AccountButton() }
        .refreshable { await loadTop(forceRefresh: true) }
        .task(id: region) { await loadTop() }
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
}

private struct FeaturedChartRow: View {
    @Environment(APIClient.self) private var api
    @Environment(PlaybackController.self) private var playback
    let podcast: Podcast

    var body: some View {
        NavigationLink(value: Route.podcast(podcast)) {
            HStack(spacing: 16) {
                ArtworkView(url: podcast.artworkURL, size: 128)
                VStack(alignment: .leading, spacing: 4) {
                    Text("No. 1").eyebrow(PodcstPalette.accent)
                    Text(podcast.title)
                        .font(.serif(.title2))
                        .lineLimit(3)
                    Text(podcast.author)
                        .font(.sans(.footnote))
                        .foregroundStyle(PodcstPalette.secondary)
                        .lineLimit(1)
                    HStack(spacing: 8) {
                        SubscribeCapsule(podcast: podcast)
                        Button {
                            Task {
                                if let latest = try? await api.detail(of: podcast).episodes.first { playback.play(latest) }
                            }
                        } label: {
                            RoundIcon(systemName: "play.fill", diameter: 32)
                        }
                        .accessibilityLabel("Play latest episode")
                    }
                    .padding(.top, 10)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.vertical, 18)
            .hairline()
        }
        .buttonStyle(.plain)
    }
}

private struct SubscribeCapsule: View {
    @Environment(LibraryStore.self) private var library
    let podcast: Podcast

    var body: some View {
        let subscribed = library.isSubscribed(podcast)
        Button(subscribed ? "Subscribed" : "Subscribe") {
            Task { await library.toggleSubscription(podcast) }
        }
        .font(.sans(.footnote).weight(.semibold))
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
        .foregroundStyle(subscribed ? PodcstPalette.ink : .white)
        .background(subscribed ? Color.clear : PodcstPalette.accent, in: Capsule())
        .overlay { if subscribed { Capsule().strokeBorder(PodcstPalette.rule) } }
        .buttonStyle(.plain)
    }
}

private struct RankedPodcastRow: View {
    @Environment(LibraryStore.self) private var library
    let rank: Int
    let podcast: Podcast

    var body: some View {
        let subscribed = library.isSubscribed(podcast)
        NavigationLink(value: Route.podcast(podcast)) {
            HStack(spacing: 14) {
                Text("\(rank)")
                    .font(.serif(.title2, italic: true))
                    .foregroundStyle(PodcstPalette.muted)
                    .frame(minWidth: 26)
                ArtworkView(url: podcast.artworkURL, size: 52)
                VStack(alignment: .leading, spacing: 2) {
                    Text(podcast.title)
                        .font(.serif(.body))
                        .lineLimit(1)
                    Text(podcast.author)
                        .font(.sans(.caption))
                        .foregroundStyle(PodcstPalette.secondary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    Task { await library.toggleSubscription(podcast) }
                } label: {
                    RoundIcon(systemName: subscribed ? "checkmark" : "plus", diameter: 32, tint: subscribed ? PodcstPalette.accent : PodcstPalette.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(subscribed ? "Unsubscribe from \(podcast.title)" : "Subscribe to \(podcast.title)")
            }
            .padding(.vertical, 11)
            .hairline()
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Number \(rank), \(podcast.title), \(podcast.author)")
    }
}

struct PodcastRow: View {
    let podcast: Podcast

    var body: some View {
        NavigationLink(value: Route.podcast(podcast)) {
            HStack(spacing: 14) {
                ArtworkView(url: podcast.artworkURL, size: 52)
                VStack(alignment: .leading, spacing: 2) {
                    Text(podcast.title)
                        .font(.serif(.body))
                        .lineLimit(2)
                    Text(podcast.author)
                        .font(.sans(.caption))
                        .foregroundStyle(PodcstPalette.secondary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.right")
                    .font(.sans(.footnote).weight(.semibold))
                    .foregroundStyle(PodcstPalette.muted)
            }
            .padding(.vertical, 11)
            .hairline()
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(podcast.title), \(podcast.author)")
    }
}
