import SwiftUI

struct PodcastDetailView: View {
    @Environment(APIClient.self) private var api
    @Environment(LibraryStore.self) private var library
    @Environment(PlaybackController.self) private var playback
    @Environment(Router.self) private var router
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    let podcast: Podcast
    @State private var store = PodcastDetailStore()
    @State private var filter = ""
    @State private var newestFirst = true
    @State private var expanded = false
    @State private var titleVisible = false
    @State private var readAttempt = UUID()
    @State private var forceRefresh = false
    @State private var episodePosition: String? = "podcast-top"
    @State private var recommendations: (key: String, podcasts: [Podcast])?
    @AppStorage(DiscoveryRegion.key) private var region = DiscoveryRegion.detected.rawValue

    private var currentScope: Bool { store.scope == nil || store.scope == api.activityToken }
    private var content: Podcast {
        guard currentScope else { return Podcast(id: podcast.id, feed: "", title: "Podcast unavailable") }
        return store.podcast ?? podcast
    }
    private var query: PodcastEpisodeQuery { PodcastEpisodeQuery(search: filter.trimmingCharacters(in: .whitespacesAndNewlines), newestFirst: newestFirst) }
    private var relatedKey: String { "\(content.identity):\(content.isPrivate == true):\(region):\(api.activityToken)" }
    private var relatedPodcasts: [Podcast] {
        recommendations?.key == relatedKey ? recommendations?.podcasts ?? [] : []
    }

    var body: some View {
        GeometryReader { geometry in
            let wide = sizeClass == .regular && geometry.size.width >= 700 && !typeSize.isAccessibilitySize
            let columnWidth = wide && geometry.size.width >= 820 ? min(300, (geometry.size.width - 72) * 0.3) : nil
            Group {
                if #available(iOS 27.1, *), geometry.hasInteriorFold {
                    ArrangementView {
                        ScrollView {
                            PodcastHeader(podcast: content, latest: currentScope ? store.latest : nil, wide: false, aboutWidth: nil, expanded: $expanded)
                                .padding(20)
                        }
                        .modifier(ArtworkBackdrop(url: content.artworkURL, artworkSize: 180, headerHeight: 360))
                    } secondary: {
                        episodeScroll(wide: false, showsHeader: false, aboutWidth: nil, relatedWidth: nil)
                            .podcstPage()
                    }
                    .arrangementViewStyle(.split)
                } else {
                    episodeScroll(wide: wide, showsHeader: true, aboutWidth: columnWidth, relatedWidth: relatedPodcasts.isEmpty ? nil : columnWidth)
                        .modifier(ArtworkBackdrop(url: content.artworkURL, artworkSize: 180, headerHeight: wide ? 300 : 360))
                }
            }
            .podcstPage()
        }
        .navigationTitle(titleVisible ? content.title : "")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: relatedKey) {
            let key = relatedKey
            guard recommendations?.key != key else { return }
            recommendations = nil
            guard let id = content.id, id > 0, content.isPrivate != true else { return }
            guard let podcasts = try? await api.related(podcastID: id, locale: region) else { return }
            guard !Task.isCancelled, relatedKey == key else { return }
            recommendations = (key, podcasts)
        }
        .task(id: "\(podcast.identity):\(api.activityToken):\(scenePhase):\(readAttempt):\(query)") {
            guard scenePhase == .active else { return }
            let refresh = forceRefresh
            forceRefresh = false
            await store.load(podcast, api: api, query: query, forceRefresh: refresh)
        }
        .onChange(of: query) { _, _ in episodePosition = "podcast-episodes" }
    }

    private func episodeScroll(wide: Bool, showsHeader: Bool, aboutWidth: CGFloat?, relatedWidth: CGFloat?) -> some View {
        AnchoredScroll(position: $episodePosition) {
            VStack(alignment: .leading, spacing: 0) {
                if showsHeader {
                    VStack {
                        PodcastHeader(podcast: content, latest: currentScope ? store.latest : nil, wide: wide, aboutWidth: aboutWidth, expanded: $expanded)
                            .padding(.bottom, 28)
                            .id("podcast-top")
                    }
                    .scrollTargetLayout()
                }
                HStack(alignment: .top, spacing: 32) {
                    PodcastEpisodesView(store: store, query: query, filter: $filter, newestFirst: $newestFirst, wide: wide, inlineFilter: wide && relatedWidth == nil, showsHeader: showsHeader) {
                        readAttempt = UUID()
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if let relatedWidth {
                        RelatedPodcastsView(podcasts: relatedPodcasts)
                            .frame(width: relatedWidth)
                    }
                }
            }
            .frame(maxWidth: 1100)
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 24)
            .frame(maxWidth: .infinity)
        }
        .refreshable { forceRefresh = true; readAttempt = UUID() }
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.y + geometry.contentInsets.top > 250
        } action: { _, visible in
            withAnimation(.easeInOut(duration: 0.2)) { titleVisible = visible }
        }
    }

}

private struct PodcastEpisodesView: View {
    @Environment(APIClient.self) private var api
    let store: PodcastDetailStore
    let query: PodcastEpisodeQuery
    @Binding var filter: String
    @Binding var newestFirst: Bool
    let wide: Bool
    let inlineFilter: Bool
    let showsHeader: Bool
    let retry: () -> Void

    private var visible: Bool { store.scope == api.activityToken && store.query == query }
    private var episodes: [Episode] { visible ? store.episodes : [] }
    private var total: Int { max(store.podcast?.episodeCount ?? 0, store.page?.total ?? 0) }

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            SectionHeader("Episodes") {
                HStack(spacing: 14) {
                    if inlineFilter, total > 10 || !filter.isEmpty {
                        PodcastEpisodeFilter(text: $filter).frame(maxWidth: 240)
                    }
                    if store.isLoading, !episodes.isEmpty { ProgressView().controlSize(.small) }
                    Menu {
                        Picker("Order", selection: $newestFirst) {
                            Text("Newest first").tag(true)
                            Text("Oldest first").tag(false)
                        }
                    } label: {
                        Text("\(total) · \(newestFirst ? "Newest first" : "Oldest first")")
                            .font(.sans(.footnote))
                            .foregroundStyle(PodcstPalette.tertiary)
                    }
                }
            }
            .id(showsHeader ? "podcast-episodes" : "podcast-top")
            if !inlineFilter, total > 10 || !filter.isEmpty {
                PodcastEpisodeFilter(text: $filter).padding(.vertical, 12)
            }
            if visible, store.loadFailed || store.updateFailed {
                ErrorRow(message: episodes.isEmpty ? "Couldn't load episodes." : "Couldn't check for updates. Showing saved episodes.") { retry() }
                    .padding(.vertical, 12)
            }
            ForEach(episodes, id: \.identity) { episode in
                EpisodeRow(episode: episode, showsSummary: wide)
                    .id(episode.identity)
            }
            if episodes.isEmpty {
                if !visible || store.isLoading || store.isRechecking {
                    HStack(spacing: 10) {
                        ProgressView().controlSize(.small)
                        Text("Loading episodes…")
                    }
                    .font(.sans(.subheadline))
                    .foregroundStyle(PodcstPalette.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 30)
                } else if !store.loadFailed {
                    Text(query.search.isEmpty ? "No episodes available." : "No episodes match your search.")
                        .foregroundStyle(PodcstPalette.secondary)
                        .padding(.vertical, 20)
                }
            }
            if visible, store.hasMore {
                if store.moreFailed {
                    ErrorRow(message: "Couldn't load more episodes.") {
                        if store.loadFailed { retry() }
                        else { await store.loadMore(api: api) }
                    }
                        .padding(.vertical, 12)
                } else {
                    Button {
                        Task { await store.loadMore(api: api) }
                    } label: {
                        HStack(spacing: 10) {
                            if store.isLoadingMore { ProgressView().controlSize(.small) }
                            Text("Load more episodes")
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .disabled(store.isLoading || store.isLoadingMore || store.loadFailed)
                    .task(id: store.page?.nextCursor) { await store.loadMore(api: api) }
                }
            }
        }
        .scrollTargetLayout()
    }
}

private struct PodcastEpisodeFilter: View {
    @Binding var text: String

    var body: some View {
        TextField("Filter episodes", text: $text)
            .modifier(FieldChrome())
            .accessibilityLabel("Filter episodes")
    }
}

private struct RelatedPodcastsView: View {
    let podcasts: [Podcast]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Listeners also follow")
                .eyebrow()
                .accessibilityAddTraits(.isHeader)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 12)
                .hairline()
            ForEach(podcasts, id: \.identity) { podcast in
                PodcastRow(podcast: podcast)
            }
        }
    }
}

private struct PodcastHeader: View {
    let podcast: Podcast
    let latest: Episode?
    let wide: Bool
    let aboutWidth: CGFloat?
    @Binding var expanded: Bool

    var body: some View {
        VStack(alignment: wide ? .leading : .center, spacing: 20) {
            HStack(alignment: .top, spacing: 32) {
                let layout = wide ? AnyLayout(HStackLayout(alignment: .bottom, spacing: 24)) : AnyLayout(VStackLayout(spacing: 18))
                layout {
                    ArtworkView(url: podcast.artworkURL, size: wide ? 160 : 180)
                        .shadow(color: .black.opacity(0.22), radius: 20, y: 14)
                    VStack(alignment: wide ? .leading : .center, spacing: 8) {
                        if let published = ([podcast.published] + podcast.episodes.map(\.published)).compactMap({ $0 }).max() {
                            Text("Updated \(published.formatted(.dateTime.year().month(.wide).day()))")
                                .eyebrow()
                        }
                        Text(podcast.title)
                            .font(.serif(wide ? .largeTitle : .title))
                            .tracking(-0.4)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(podcast.author)
                            .font(.sans(.subheadline))
                            .foregroundStyle(PodcstPalette.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        PodcastActions(podcast: podcast, latest: latest)
                            .frame(maxWidth: 440)
                            .padding(.top, 10)
                    }
                    .multilineTextAlignment(wide ? .leading : .center)
                    .frame(maxWidth: .infinity, alignment: wide ? .leading : .center)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let aboutWidth {
                    PodcastAbout(podcast: podcast, expanded: $expanded, lineLimit: 6)
                        .frame(width: aboutWidth, alignment: .leading)
                }
            }
            if aboutWidth == nil {
                PodcastAbout(podcast: podcast, expanded: $expanded, lineLimit: wide ? 3 : 2)
                    .frame(maxWidth: 680, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

private struct PodcastActions: View {
    @Environment(LibraryStore.self) private var library
    @Environment(PlaybackController.self) private var playback
    @Environment(Router.self) private var router
    let podcast: Podcast
    let latest: Episode?

    var body: some View {
        let subscribed = library.isSubscribed(podcast)
        HStack(spacing: 10) {
            Button {
                Task { await library.toggleSubscription(podcast) }
            } label: {
                HStack(spacing: 6) {
                    if subscribed { Image(systemName: "checkmark").foregroundStyle(PodcstPalette.accent) }
                    Text(subscribed ? "Subscribed" : "Subscribe")
                }
            }
            .buttonStyle(PodcstButtonStyle(kind: subscribed ? .surface : .ink, height: 44))
            Button {
                if let latest { playback.play(latest) }
            } label: {
                Label("Latest", systemImage: "play.fill")
            }
            .buttonStyle(PodcstButtonStyle(kind: .surface, height: 44))
            .disabled(latest == nil)
            .accessibilityLabel("Play latest episode")
            if podcast.publicLink != nil {
                Button { router.sharing = .podcast(podcast) } label: {
                    Image(systemName: "square.and.arrow.up").frame(width: 20)
                }
                .buttonStyle(PodcstButtonStyle(kind: .surface, height: 44))
                .frame(width: 44)
                .accessibilityLabel("Share podcast")
            }
        }
    }
}

private struct PodcastAbout: View {
    let podcast: Podcast
    @Binding var expanded: Bool
    let lineLimit: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !podcast.description.isEmpty {
                Button {
                    withAnimation(.snappy) { expanded.toggle() }
                } label: {
                    Text(podcast.description.strippingHTML.trimmingCharacters(in: .whitespacesAndNewlines))
                        .font(.sans(.subheadline))
                        .lineSpacing(5)
                        .foregroundStyle(PodcstPalette.secondary)
                        .lineLimit(expanded ? nil : lineLimit)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
                .accessibilityHint(expanded ? "Collapse description" : "Expand description")
            }
            if let link = podcast.link.flatMap(URL.init(string:)), let host = link.host()?.replacingOccurrences(of: "www.", with: "") {
                Link(host, destination: link)
                    .font(.sans(.footnote))
                    .foregroundStyle(PodcstPalette.accent)
                    .frame(minHeight: 44, alignment: .leading)
            }
        }
    }
}

struct EpisodeRow: View {
    enum Context {
        case podcast
        case library
        case releases
        case starred
        case downloads
    }

    @Environment(PlaybackController.self) private var playback
    @Environment(StarStore.self) private var stars
    @Environment(MediaStore.self) private var media
    @Environment(DownloadAlertState.self) private var alerts
    @Environment(Router.self) private var router
    @Environment(LibraryStore.self) private var library
    let episode: Episode
    var context: Context = .podcast
    var showsSeparator = true
    var showsSummary = false

    private var duration: TimeInterval? { episode.duration.flatMap { $0 > 0 ? $0 : nil } }

    private var completed: Bool {
        library.progress(for: episode)?.completed == true && !(playback.position(of: episode) != nil && playback.isPlaybackRequested)
    }

    private var position: TimeInterval? { playback.position(of: episode) ?? library.progress(for: episode)?.position }

    private var fraction: Double? {
        guard !completed, let position, position > 0, let duration else { return nil }
        return min(1, position / duration)
    }

    private var metadata: [String] {
        if completed {
            return [context == .podcast || context == .library ? nil : episode.podcastTitle, duration.map(Duration.seconds), "Played"].compactMap { $0 }
        }
        let remaining = position.flatMap { position in
            duration.flatMap { position > 0 ? "\(Duration.seconds(max(0, $0 - position))) left" : nil }
        }
        switch context {
        case .podcast:
            return [duration.map(Duration.seconds), remaining].compactMap { $0 }
        case .library:
            if let remaining { return [remaining] }
            let isNew = episode.published.map { $0 > .now.addingTimeInterval(-7 * 86400) } ?? false
            return [isNew ? "New" : episode.podcastTitle, duration.map(Duration.seconds)].compactMap { $0 }
        case .downloads where media.status(for: episode).downloadedBytes == nil:
            return [media.status(for: episode).downloadDescription]
        case .releases, .starred, .downloads:
            return [episode.podcastTitle, remaining ?? duration.map(Duration.seconds)].compactMap { $0 }.filter { !$0.isEmpty }
        }
    }

    var body: some View {
        let isCurrent = playback.position(of: episode) != nil
        let starred = stars.contains(episode)
        let metadata = metadata
        HStack(spacing: 14) {
            NavigationLink(value: Route.episode(episode)) {
                HStack(spacing: 14) {
                    switch context {
                    case .podcast: DateBlock(date: episode.published)
                    case .library, .releases, .starred, .downloads: ArtworkView(url: episode.artworkURL, fallbackURL: URL(string: episode.cover), size: 48)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(episode.title)
                            .font(.serif(.body))
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        if showsSummary, let summary = episode.summary, !summary.isEmpty {
                            Text(summary.strippingHTML.trimmingCharacters(in: .whitespacesAndNewlines))
                                .font(.sans(.caption))
                                .foregroundStyle(PodcstPalette.secondary)
                                .lineLimit(1)
                        }
                        HStack(spacing: 8) {
                            if context != .podcast, let fraction {
                                Capsule()
                                    .fill(PodcstPalette.rule)
                                    .frame(width: 44, height: 3)
                                    .overlay(alignment: .leading) {
                                        Capsule().fill(PodcstPalette.accent).frame(width: 44 * fraction)
                                    }
                            }
                            if starred {
                                Image(systemName: "star.fill")
                                    .font(.system(size: 10, weight: .semibold))
                                    .foregroundStyle(PodcstPalette.accent)
                            }
                            HStack(spacing: 4) {
                                ForEach(Array(metadata.enumerated()), id: \.offset) { index, text in
                                    Text(index == 0 ? text : "· \(text)")
                                        .layoutPriority(index == 0 ? 0 : 1)
                                }
                            }
                            .font(.sans(.caption))
                            .foregroundStyle(PodcstPalette.tertiary)
                            .lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .opacity(completed ? 0.5 : 1)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(([episode.title] + metadata + (starred ? ["Starred"] : [])).joined(separator: ", "))
            .accessibilityAction(named: starred ? "Unstar" : "Star") { router.star(episode, !starred, in: stars) }
            trailing(isCurrent: isCurrent)
        }
        .padding(.vertical, 12)
        .hairline(showsSeparator)
        .modifier(EpisodeSwipe(
            leading: EpisodeSwipe.Action(title: starred ? "Unstar" : "Star", systemImage: starred ? "star.slash" : "star.fill") {
                router.star(episode, !starred, in: stars)
            },
            trailing: context == .downloads ? EpisodeSwipe.Action(title: "Remove", systemImage: "trash") {
                Task { await DownloadOperation.remove.perform(for: episode, media: media, alerts: alerts) }
            } : nil
        ))
        .contextMenu {
            EpisodeMenuActions(episode: episode)
        }
    }

    @ViewBuilder
    private func trailing(isCurrent: Bool) -> some View {
        switch context {
        case .starred:
            Button {
                router.star(episode, false, in: stars)
            } label: {
                Image(systemName: "star.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(PodcstPalette.accent)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Unstar \(episode.title)")
        case .downloads:
            if let bytes = media.status(for: episode).downloadedBytes {
                Text(bytes.formatted(.byteCount(style: .file)))
                    .font(.sans(.caption).monospacedDigit())
                    .foregroundStyle(PodcstPalette.tertiary)
            } else {
                DownloadButton(episode: episode, compact: true)
            }
        case .podcast, .library, .releases:
            Button {
                if isCurrent && !completed { playback.toggle() } else { playback.play(episode, at: completed ? 0 : position ?? 0) }
            } label: {
                RoundIcon(systemName: isCurrent && playback.isPlaybackRequested ? "pause.fill" : "play.fill")
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isCurrent && playback.isPlaybackRequested ? "Pause \(episode.title)" : "Play \(episode.title)")
        }
    }
}

struct EpisodeMenuActions: View {
    @Environment(LibraryStore.self) private var library
    @Environment(PlaybackController.self) private var playback
    @Environment(StarStore.self) private var stars
    @Environment(Router.self) private var router
    let episode: Episode

    var body: some View {
        let starred = stars.contains(episode)
        Button("Play next", systemImage: "text.line.first.and.arrowtriangle.forward") { playback.enqueue(episode, next: true) }
        Button("Add to queue", systemImage: "text.append") { playback.enqueue(episode) }
        Button("Mark played", systemImage: "checkmark.circle") { library.mark(episode, played: true) }
        Button("Mark unplayed", systemImage: "circle") { library.mark(episode, played: false) }
        Divider()
        Button(starred ? "Unstar" : "Star", systemImage: starred ? "star.slash" : "star") { router.star(episode, !starred, in: stars) }
        Button("Add to list…", systemImage: "text.badge.plus") { router.listing = episode }
        if episode.publicLink != nil {
            Button("Share…", systemImage: "square.and.arrow.up") { router.sharing = .episode(episode) }
        }
        Divider()
        DownloadMenuActions(episode: episode)
    }
}

struct EpisodeDetailView: View {
    @Environment(APIClient.self) private var api
    @Environment(PlaybackController.self) private var playback
    @Environment(Router.self) private var router
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var loaded: (key: String, value: EpisodeChapters)?
    @State private var rendered: (notes: String, paragraphs: [AttributedString])?
    @State private var readingPosition: String? = "episode-header"
    let episode: Episode

    private var chapterKey: String { "\(episode.identity):\(api.activityToken)" }

    private var chapters: EpisodeChapters {
        let result = loaded?.key == chapterKey ? loaded?.value : nil
        if playback.currentEpisode?.identity == episode.identity, playback.chapters.count >= 2 {
            return EpisodeChapters(chapters: playback.chapters, source: result?.chapters == playback.chapters ? result?.source ?? .none : .none)
        }
        return result ?? EpisodeChapters(chapters: [], source: .none)
    }

    var body: some View {
        let chapters = chapters
        let notes = ShowNotesParser.notes(of: episode)
        let paragraphs = rendered?.notes == notes ? rendered?.paragraphs : nil
        GeometryReader { geometry in
            let wide = sizeClass == .regular && geometry.size.width >= 700 && !typeSize.isAccessibilitySize
            Group {
                if #available(iOS 27.1, *), geometry.hasInteriorFold, !chapters.chapters.isEmpty {
                    ArrangementView {
                        AnchoredScroll(position: $readingPosition) {
                            VStack(alignment: .leading, spacing: 32) {
                                VStack {
                                    EpisodeHeader(episode: episode, wide: false)
                                        .id("episode-header")
                                }
                                .scrollTargetLayout()
                                EpisodeNotesSection(episode: episode, paragraphs: paragraphs)
                            }
                            .padding(20)
                        }
                    } secondary: {
                        ScrollView {
                            EpisodeChapterCard(episode: episode, content: chapters)
                                .padding(20)
                        }
                    }
                    .arrangementViewStyle(.split)
                } else {
                    AnchoredScroll(position: $readingPosition) {
                        VStack(alignment: .leading, spacing: 32) {
                            VStack {
                                EpisodeHeader(episode: episode, wide: wide)
                                    .id("episode-header")
                            }
                            .scrollTargetLayout()
                            if wide {
                                HStack(alignment: .top, spacing: 32) {
                                    EpisodeNotesSection(episode: episode, paragraphs: paragraphs)
                                        .frame(maxWidth: 640, alignment: .leading)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                    if !chapters.chapters.isEmpty {
                                        EpisodeChapterCard(episode: episode, content: chapters)
                                            .frame(width: min(340, (geometry.size.width - 72) * 0.38))
                                    }
                                }
                            } else {
                                if !chapters.chapters.isEmpty {
                                    EpisodeChapterCard(episode: episode, content: chapters)
                                }
                                EpisodeNotesSection(episode: episode, paragraphs: paragraphs)
                            }
                        }
                        .frame(maxWidth: 1100, alignment: .leading)
                        .padding(.horizontal, 20)
                        .padding(.top, 12)
                        .padding(.bottom, 28)
                        .frame(maxWidth: .infinity)
                    }
                }
            }
            .modifier(ArtworkBackdrop(url: episode.artworkURL, artworkSize: wide ? 180 : 112, headerHeight: wide ? 360 : 320, fallbackURL: URL(string: episode.cover)))
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if episode.publicLink != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Share", systemImage: "square.and.arrow.up") { router.sharing = .episode(episode) }
                }
            }
        }
        .task(id: chapterKey) {
            let key = chapterKey
            let fallback = ShowNotesParser.chapters(ShowNotesParser.notes(of: episode))
            loaded = (key, EpisodeChapters(chapters: fallback, source: fallback.isEmpty ? .none : .shownotes))
            guard let result = try? await api.chapters(for: episode), !Task.isCancelled, key == chapterKey else { return }
            if !result.chapters.isEmpty { loaded = (key, result) }
        }
        .task(id: notes) {
            rendered = (notes, ShowNotesParser.paragraphs(notes))
        }
    }

}

private struct EpisodeHeader: View {
    let episode: Episode
    let wide: Bool

    var body: some View {
        let layout = wide ? AnyLayout(HStackLayout(alignment: .bottom, spacing: 28)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 20))
        layout {
            ArtworkView(url: episode.artworkURL, fallbackURL: URL(string: episode.cover), size: wide ? 180 : 112)
                .shadow(color: .black.opacity(0.18), radius: 18, y: 12)
            VStack(alignment: .leading, spacing: 8) {
                Text(episode.dateline).eyebrow()
                Text(episode.title)
                    .font(.serif(wide ? .largeTitle : .title))
                    .tracking(-0.4)
                    .fixedSize(horizontal: false, vertical: true)
                NavigationLink(value: Route.podcast(episode.podcast)) {
                    Text(episode.byline)
                        .font(.sans(.subheadline))
                        .foregroundStyle(PodcstPalette.secondary)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
                EpisodeDetailActions(episode: episode)
                    .frame(maxWidth: 520)
                    .padding(.top, 12)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct EpisodeDetailActions: View {
    @Environment(PlaybackController.self) private var playback
    @Environment(StarStore.self) private var stars
    @Environment(Router.self) private var router
    let episode: Episode

    var body: some View {
        HStack(spacing: 10) {
            EpisodePlayButton(episode: episode)
            let starred = stars.contains(episode)
            Menu {
                Button("Add to list…", systemImage: "text.badge.plus") { router.listing = episode }
            } label: {
                Image(systemName: starred ? "star.fill" : "star")
                    .foregroundStyle(starred ? PodcstPalette.accent : PodcstPalette.ink)
            } primaryAction: {
                router.star(episode, !starred, in: stars)
            }
            .menuStyle(.button)
            .buttonStyle(PodcstButtonStyle(kind: .surface))
            .frame(width: 48)
            .accessibilityLabel(starred ? "Unstar" : "Star")
            DownloadButton(episode: episode, compact: true)
            let queued = playback.queue.contains { $0.identity == episode.identity }
            Button {
                playback.enqueue(episode, next: true)
            } label: {
                Image(systemName: queued ? "checkmark" : "text.line.first.and.arrowtriangle.forward")
                    .foregroundStyle(queued ? PodcstPalette.accent : PodcstPalette.ink)
            }
            .buttonStyle(PodcstButtonStyle(kind: .surface))
            .frame(width: 48)
            .disabled(queued)
            .accessibilityLabel(queued ? "In queue" : "Play next")
        }
    }
}

private struct EpisodeNotesSection: View {
    let episode: Episode
    let paragraphs: [AttributedString]?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionHeader("Show notes")
            ShowNotesText(episode: episode, paragraphs: paragraphs)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct EpisodeChapterCard: View {
    @Environment(PlaybackController.self) private var playback
    @Environment(\.dynamicTypeSize) private var typeSize
    let episode: Episode
    let content: EpisodeChapters

    var body: some View {
        let position = playback.position(of: episode)
        let duration = position != nil ? max(playback.duration, episode.duration ?? 0) : episode.duration ?? 0
        let current = position.flatMap { content.chapters.index(at: $0) }
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Chapters").eyebrow()
                Spacer()
                Text(content.chapters.count, format: .number).eyebrow()
            }
            .padding(.horizontal, 12)
            .padding(.top, 12)
            if content.source == .shownotes {
                Text("Chapters from show notes")
                    .font(.sans(.caption))
                    .foregroundStyle(PodcstPalette.tertiary)
                    .padding(.horizontal, 12)
            }
            ForEach(Array(content.chapters.enumerated()), id: \.element.start) { index, chapter in
                let length = max(0, content.chapters.end(of: index, duration: duration) - chapter.start)
                Button {
                    if playback.currentEpisode?.identity == episode.identity {
                        playback.seek(to: chapter.start)
                        if !playback.isPlaybackRequested { playback.resume() }
                    } else {
                        playback.play(episode, at: chapter.start)
                    }
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(Duration.clock(chapter.start))
                            .font(.sans(.caption).weight(.medium))
                            .monospacedDigit()
                            .foregroundStyle(current == index ? PodcstPalette.accent : PodcstPalette.tertiary)
                            .frame(minWidth: 40, alignment: .leading)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(chapter.title)
                                .font(.serif(.body))
                                .lineSpacing(2)
                                .lineLimit(typeSize.isAccessibilitySize ? nil : 3)
                                .foregroundStyle(PodcstPalette.ink)
                                .fixedSize(horizontal: false, vertical: true)
                            if length > 0 {
                                Text(Duration.seconds(length))
                                    .font(.sans(.caption))
                                    .foregroundStyle(PodcstPalette.tertiary)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(12)
                    .frame(minHeight: 44)
                    .background(current == index ? PodcstPalette.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 10))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .multilineTextAlignment(.leading)
                .accessibilityLabel("Play \(chapter.title) at \(Duration.clock(chapter.start))")
                .accessibilityAddTraits(current == index ? .isSelected : [])
            }
        }
        .padding(8)
        .background(PodcstPalette.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(PodcstPalette.rule) }
    }
}

private struct EpisodePlayButton: View {
    @Environment(PlaybackController.self) private var playback
    let episode: Episode

    var body: some View {
        let position = playback.position(of: episode)
        let playing = position != nil && playback.isPlaybackRequested
        let fraction = position.map { _ in playback.progress } ?? 0
        Button {
            if position != nil { playback.toggle() } else { playback.play(episode) }
        } label: {
            ViewThatFits(in: .horizontal) {
                Label(title(position: position, playing: playing), systemImage: playing ? "pause.fill" : "play.fill")
                    .fixedSize()
                Label(playing ? "Pause" : position.map { $0 > 0 } == true ? "Resume" : "Play", systemImage: playing ? "pause.fill" : "play.fill")
            }
        }
        .buttonStyle(PodcstButtonStyle(kind: .accent))
        .accessibilityLabel(title(position: position, playing: playing))
        .overlay(alignment: .bottomLeading) {
            if fraction > 0 {
                GeometryReader { geometry in
                    Color.white.opacity(0.55)
                        .frame(width: geometry.size.width * fraction, height: 3)
                        .frame(maxHeight: .infinity, alignment: .bottom)
                }
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .allowsHitTesting(false)
            }
        }
    }

    private func title(position: TimeInterval?, playing: Bool) -> String {
        if playing { return "Pause" }
        guard let position, position > 0, playback.remaining > 0 else { return "Play" }
        return "Resume · \(Duration.seconds(playback.remaining)) left"
    }
}

struct ShowNotesContent: View {
    let episode: Episode
    @State private var rendered: (notes: String, paragraphs: [AttributedString])?

    var body: some View {
        let notes = ShowNotesParser.notes(of: episode)
        ShowNotesText(episode: episode, paragraphs: rendered?.notes == notes ? rendered?.paragraphs : nil)
            .task(id: notes) {
                rendered = (notes, ShowNotesParser.paragraphs(notes))
            }
    }
}

private struct ShowNotesText: View {
    @Environment(PlaybackController.self) private var playback
    let episode: Episode
    let paragraphs: [AttributedString]?

    var body: some View {
        let notes = ShowNotesParser.notes(of: episode)
        VStack(alignment: .leading, spacing: 16) {
            if notes.isEmpty {
                Text("No show notes were provided for this episode.")
                    .foregroundStyle(PodcstPalette.secondary)
            } else if let paragraphs {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(Array(paragraphs.enumerated()), id: \.offset) { index, paragraph in
                        Text(paragraph)
                            .font(.sans(.body))
                            .lineSpacing(8)
                            .foregroundStyle(PodcstPalette.secondary)
                            .tint(PodcstPalette.accent)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .id("notes-\(index)")
                    }
                }
                .scrollTargetLayout()
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
            if let link = episode.link, let url = URL(string: link) {
                Link("Open episode website", destination: url)
                    .font(.sans(.subheadline).weight(.medium))
                    .foregroundStyle(PodcstPalette.accent)
            }
        }
        .environment(\.openURL, OpenURLAction { url in
            guard let seconds = ShowNotesParser.timestamp(from: url) else { return .systemAction }
            if playback.position(of: episode) != nil {
                playback.seek(to: seconds)
            } else {
                playback.play(episode, at: seconds)
            }
            return .handled
        })
    }
}
