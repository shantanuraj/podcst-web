import SwiftUI

struct DiscoverView: View {
    @Environment(APIClient.self) private var api
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var topPodcasts: [Podcast] = []
    @State private var error: String?
    @State private var chartPosition: String? = "discover-top"
    @AppStorage(DiscoveryRegion.key) private var region = DiscoveryRegion.detected.rawValue

    var body: some View {
        GeometryReader { geometry in
            let wide = sizeClass == .regular && geometry.size.width >= 700 && !typeSize.isAccessibilitySize
            Group {
                if #available(iOS 27.1, *), hasFold(in: geometry) {
                    ArrangementView {
                        ScrollView {
                            DiscoverFeature(podcast: topPodcasts.first, region: region, expanded: true)
                                .padding(20)
                        }
                    } secondary: {
                        DiscoverScroll(position: $chartPosition) {
                            VStack(alignment: .leading, spacing: 0) {
                                VStack { SectionHeader("The chart").id("discover-top") }
                                    .scrollTargetLayout()
                                DiscoverChart(podcasts: topPodcasts, start: 1, columns: 1)
                            }
                            .padding(20)
                        }
                    }
                    .arrangementViewStyle(.split)
                } else {
                    DiscoverScroll(position: $chartPosition) {
                        VStack(alignment: .leading, spacing: 24) {
                            let layout = wide
                                ? AnyLayout(HStackLayout(alignment: .top, spacing: 28))
                                : AnyLayout(VStackLayout(alignment: .leading, spacing: 0))
                            layout {
                                VStack(spacing: 0) {
                                    DiscoverFeature(podcast: topPodcasts.first, region: region, expanded: wide)
                                        .id("discover-top")
                                }
                                .scrollTargetLayout()
                                .frame(maxWidth: .infinity, alignment: .topLeading)
                                VStack(alignment: .leading, spacing: 0) {
                                    if wide { SectionHeader("The chart") }
                                    DiscoverChart(podcasts: topPodcasts, start: 1, end: 8, columns: 1)
                                }
                                .frame(maxWidth: .infinity, alignment: .topLeading)
                            }
                            DiscoverChart(podcasts: topPodcasts, start: 8, columns: wide ? 2 : 1)
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 12)
                        .padding(.bottom, 24)
                    }
                }
            }
            .refreshable { await loadTop(forceRefresh: true) }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if let error {
                ErrorRow(message: error) { await loadTop(forceRefresh: true) }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 8)
            }
        }
        .podcstPage()
        .screenHeader("Discover") { AccountButton() }
        .task(id: region) {
            chartPosition = "discover-top"
            topPodcasts = api.cachedTop(locale: region, limit: 30) ?? []
            await loadTop()
        }
        .task(id: topPodcasts.map(\.artworkURL)) {
            let urls = topPodcasts.compactMap(\.artworkURL)
            if let first = urls.first { await ArtworkStore.shared.prefetch([first], pixelSize: 768) }
            guard !Task.isCancelled else { return }
            await ArtworkStore.shared.prefetch(Array(urls.dropFirst()), pixelSize: 160)
        }
    }

    @available(iOS 27.1, *)
    private func hasFold(in geometry: GeometryProxy) -> Bool {
        geometry.reservedRegions(kind: .division).contains { region in
            let frame = region.frame
            let size = geometry.size
            return frame.height > frame.width
                ? frame.minX > 80 && size.width - frame.maxX > 80
                : frame.minY > 80 && size.height - frame.maxY > 80
        }
    }

    private func loadTop(forceRefresh: Bool = false) async {
        let requested = region
        do {
            let podcasts = try await (forceRefresh ? api.refreshTop(locale: requested, limit: 30) : api.top(locale: requested, limit: 30))
            guard !Task.isCancelled, region == requested else { return }
            topPodcasts = podcasts
            error = nil
        } catch {
            guard !Task.isCancelled, region == requested else { return }
            self.error = "Top podcasts are unavailable right now."
        }
    }
}

private struct DiscoverScroll<Content: View>: View {
    @Binding var position: String?
    @State private var visiblePosition: String?
    @State private var phase = ScrollPhase.idle
    let content: Content

    init(position: Binding<String?>, @ViewBuilder content: () -> Content) {
        _position = position
        _visiblePosition = State(initialValue: position.wrappedValue)
        self.content = content()
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView { content }
                .scrollPosition(id: $visiblePosition, anchor: .top)
                .onAppear {
                    if let position { proxy.scrollTo(position, anchor: .top) }
                }
                .onChange(of: visiblePosition) { _, value in
                    if phase.isScrolling, let value { position = value }
                }
                .onChange(of: position) { _, value in
                    if value != visiblePosition { visiblePosition = value }
                }
                .onScrollPhaseChange { _, value in
                    phase = value
                    if value == .idle, let visiblePosition { position = visiblePosition }
                }
        }
    }
}

private struct DiscoverFeature: View {
    let podcast: Podcast?
    let region: String
    let expanded: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader("Top podcasts") {
                Text("\(region) · Today").eyebrow()
            }
            if let podcast {
                FeaturedChartRow(podcast: podcast, expanded: expanded)
            }
        }
    }
}

private struct DiscoverChart: View {
    let podcasts: [Podcast]
    let start: Int
    var end: Int? = nil
    let columns: Int

    var body: some View {
        let entries = podcasts.enumerated().dropFirst(start).prefix(max(0, (end ?? podcasts.count) - start))
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 28), count: columns), spacing: 0) {
            ForEach(Array(entries), id: \.element.identity) { index, podcast in
                RankedPodcastRow(rank: index + 1, podcast: podcast)
                    .id(podcast.identity)
            }
        }
        .scrollTargetLayout()
    }
}

private struct FeaturedChartRow: View {
    @Environment(APIClient.self) private var api
    @Environment(\.self) private var environment
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var info: Podcast?
    @State private var tint: (URL?, ArtworkTint?)?
    let podcast: Podcast
    let expanded: Bool

    private var description: String {
        (info?.identity == podcast.identity ? info?.description ?? podcast.description : podcast.description).strippingHTML
    }

    var body: some View {
        let stacked = expanded || typeSize.isAccessibilitySize
        let layout = stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 18))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 16))
        layout {
            NavigationLink(value: Route.podcast(podcast)) {
                ArtworkView(url: podcast.artworkURL, size: stacked ? nil : 112)
                    .frame(maxWidth: stacked ? 160 : nil)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open \(podcast.title)")
            VStack(alignment: .leading, spacing: 6) {
                Text("No. 1 today").eyebrow(PodcstPalette.accent)
                NavigationLink(value: Route.podcast(podcast)) {
                    Text(podcast.title)
                        .font(.serif(expanded ? .title : .title2))
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .buttonStyle(.plain)
                Text(podcast.author)
                    .font(.sans(.footnote))
                    .foregroundStyle(PodcstPalette.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if expanded, !description.isEmpty {
                    Text(description)
                        .font(.sans(.subheadline))
                        .foregroundStyle(PodcstPalette.secondary)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 6)
                }
                FeaturedChartActions(podcast: podcast, expanded: expanded)
                    .padding(.top, 12)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(expanded ? 20 : 0)
        .padding(.vertical, expanded ? 0 : 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            if expanded {
                let color = tint?.0 == podcast.artworkURL ? tint?.1?.headerColor(in: environment) ?? .clear : .clear
                LinearGradient(colors: [color, .clear], startPoint: .topLeading, endPoint: .bottomTrailing)
                    .clipShape(RoundedRectangle(cornerRadius: 18))
            }
        }
        .hairline(!expanded)
        .padding(.top, expanded ? 14 : 0)
        .task(id: podcast.identity) {
            info = api.cachedPodcast(id: podcast.id, feed: podcast.feed)
            guard let id = podcast.id, let loaded = try? await api.podcastInfo(id: id), !Task.isCancelled else { return }
            info = loaded
        }
        .task(id: podcast.artworkURL) {
            let url = podcast.artworkURL
            let loaded = await ArtworkStore.shared.tint(url, pixelSize: 768)
            guard !Task.isCancelled else { return }
            tint = (url, loaded)
        }
    }
}

private struct FeaturedChartActions: View {
    let podcast: Podcast
    let expanded: Bool

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) {
                SubscribeCapsule(podcast: podcast)
                PlayLatestButton(podcast: podcast, expanded: expanded)
            }
            VStack(alignment: .leading, spacing: 10) {
                SubscribeCapsule(podcast: podcast)
                PlayLatestButton(podcast: podcast, expanded: expanded)
            }
        }
    }
}

private struct PlayLatestButton: View {
    @Environment(APIClient.self) private var api
    @Environment(PlaybackController.self) private var playback
    let podcast: Podcast
    let expanded: Bool

    var body: some View {
        Button {
            Task {
                if let latest = try? await api.detail(of: podcast).episodes.first { playback.play(latest) }
            }
        } label: {
            if expanded {
                Label("Play latest", systemImage: "play.fill")
                    .font(.sans(.footnote).weight(.semibold))
                    .padding(.horizontal, 14)
                    .frame(minHeight: 44)
                    .foregroundStyle(PodcstPalette.ink)
                    .overlay { Capsule().strokeBorder(PodcstPalette.rule) }
            } else {
                RoundIcon(systemName: "play.fill", diameter: 44)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Play latest episode")
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
        .frame(minHeight: 44)
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
