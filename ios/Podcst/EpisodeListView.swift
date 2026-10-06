import SwiftUI
import UIKit

enum EpisodeList: Hashable {
    case starred
    case downloads

    var title: String {
        switch self {
        case .starred: "Starred"
        case .downloads: "Downloads"
        }
    }

    var systemImage: String {
        switch self {
        case .starred: "star.fill"
        case .downloads: "arrow.down"
        }
    }
}

struct EpisodeListView: View {
    @Environment(StarStore.self) private var stars
    @Environment(MediaStore.self) private var media
    let list: EpisodeList
    @State private var titleVisible = false

    private var episodes: [Episode] {
        switch list {
        case .starred: stars.episodes
        case .downloads: media.downloadedEpisodes
        }
    }

    private var extent: String? {
        switch list {
        case .starred:
            let seconds = episodes.compactMap(\.duration).filter { $0 > 0 }.reduce(0, +)
            return seconds > 0 ? Duration.seconds(seconds) : nil
        case .downloads:
            let bytes = episodes.compactMap { media.status(for: $0).downloadedBytes }.reduce(0, +)
            return bytes > 0 ? bytes.formatted(.byteCount(style: .file)) : nil
        }
    }

    var body: some View {
        let episodes = episodes
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 12) {
                    ListTile(systemImage: list.systemImage, size: 52)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(list.title)
                            .font(.serif(.title))
                            .tracking(-0.4)
                            .accessibilityAddTraits(.isHeader)
                        Text("^[\(list == .starred ? stars.stars.count : episodes.count) episode](inflect: true)\(extent.map { " · \($0)" } ?? "")")
                            .font(.sans(.footnote))
                            .foregroundStyle(PodcstPalette.tertiary)
                    }
                }
                .padding(.top, 6)
                if list == .starred {
                    if let error = stars.error { Text(error).font(.sans(.footnote)).accessibilityAddTraits(.updatesFrequently) }
                    else if stars.pending { Text("Saved on this device. Waiting to sync…").font(.sans(.footnote)) }
                    ForEach(stars.stars.filter { $0.episode == nil }) { star in
                        HStack {
                            Text(star.membership.availability == .unavailable ? "Episode unavailable" : "Episode details unavailable")
                            Spacer()
                            Button("Unstar") { stars.remove(id: star.id) }
                        }
                        .padding(.vertical, 12)
                    }
                }
                if episodes.isEmpty && (list != .starred || stars.stars.isEmpty) {
                    Group {
                        switch list {
                        case .starred:
                            EmptyState(systemImage: "star", title: "No starred episodes", message: "Swipe right on any episode, or tap its star, to keep it here.")
                        case .downloads:
                            EmptyState(systemImage: "arrow.down.circle", title: "Listen anywhere", message: "Download episodes from their details or episode menu to keep listening offline.")
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 40)
                } else {
                    switch list {
                    case .starred: if !episodes.isEmpty { StarredEpisodes(episodes: episodes) }
                    case .downloads: DownloadedEpisodes(episodes: episodes)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.y + geometry.contentInsets.top > 60
        } action: { _, visible in
            withAnimation(.easeInOut(duration: 0.2)) { titleVisible = visible }
        }
        .refreshable { if list == .starred { await stars.refresh() } }
        .task { if list == .starred { await stars.refresh() } }
        .podcstPage()
        .navigationTitle(titleVisible ? list.title : "")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct StarredEpisodes: View {
    enum Filter: Hashable {
        case all
        case downloaded
        case show(feed: String, title: String)

        var title: String {
            switch self {
            case .all: "All"
            case .downloaded: "Downloaded"
            case .show(_, let title): title
            }
        }
    }

    struct Facet: Identifiable {
        let filter: Filter
        let count: Int
        var id: Filter { filter }
    }

    enum Sort: CaseIterable, Identifiable {
        case recent
        case newest
        case oldest

        var id: Self { self }

        var title: String {
            switch self {
            case .recent: "Recently starred"
            case .newest: "Newest"
            case .oldest: "Oldest"
            }
        }

        func apply(_ episodes: [Episode]) -> [Episode] {
            switch self {
            case .recent: episodes
            case .newest: episodes.sorted { ($0.published ?? .distantPast) > ($1.published ?? .distantPast) }
            case .oldest: episodes.sorted { ($0.published ?? .distantFuture) < ($1.published ?? .distantFuture) }
            }
        }
    }

    @Environment(PlaybackController.self) private var playback
    @Environment(MediaStore.self) private var media
    @Environment(Router.self) private var router
    let episodes: [Episode]
    @State private var filter = Filter.all
    @State private var sort = Sort.recent

    private func matches(_ filter: Filter, _ episode: Episode) -> Bool {
        switch filter {
        case .all: true
        case .downloaded: media.status(for: episode).downloadedBytes != nil
        case .show(let feed, _): episode.feed == feed
        }
    }

    private var facets: [Facet] {
        let shows = episodes.reduce(into: [Filter]()) { shows, episode in
            guard let title = episode.podcastTitle, !title.isEmpty,
                  !shows.contains(where: { if case .show(episode.feed, _) = $0 { true } else { false } }) else { return }
            shows.append(.show(feed: episode.feed, title: title))
        }
        return ([.all, .downloaded] + shows)
            .map { filter in Facet(filter: filter, count: episodes.count { matches(filter, $0) }) }
            .filter { $0.count > 0 }
    }

    var body: some View {
        let facets = facets
        let selected = facets.first { $0.filter == filter } ?? facets[0]
        let visible = sort.apply(episodes.filter { matches(selected.filter, $0) })
        HStack(spacing: 10) {
            Button {
                play(visible)
            } label: {
                Label("Play all", systemImage: "play.fill")
            }
            .buttonStyle(PodcstButtonStyle(kind: .ink, height: 44))
            Button {
                visible.forEach { playback.enqueue($0) }
                router.toast = Toast(title: String(AttributedString(localized: "Added ^[\(visible.count) episode](inflect: true) to queue").characters))
            } label: {
                Label("Add to queue", systemImage: "text.append")
            }
            .buttonStyle(PodcstButtonStyle(kind: .outline, height: 44))
        }
        .padding(.top, 16)
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(facets) { facet in
                    FacetChip(title: facet.filter.title, count: facet.count, selected: facet.filter == selected.filter) {
                        filter = facet.filter
                    }
                }
            }
            .padding(.horizontal, 20)
        }
        .scrollIndicators(.hidden)
        .padding(.horizontal, -20)
        .padding(.top, 16)
        ListCaption("\(selected.filter.title) · \(selected.count)") {
            Menu {
                Picker("Sort", selection: $sort) {
                    ForEach(Sort.allCases) { Text($0.title).tag($0) }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(sort.title)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                }
                .font(.sans(.footnote))
                .foregroundStyle(PodcstPalette.ink)
                .frame(minHeight: 44)
            }
            .accessibilityLabel("Sort by \(sort.title)")
        }
        ForEach(visible, id: \.identity) { episode in
            EpisodeRow(episode: episode, context: .starred, showsSeparator: episode.identity != visible.last?.identity)
        }
    }

    private func play(_ episodes: [Episode]) {
        guard let first = episodes.first else { return }
        playback.play(first, at: playback.position(of: first) ?? 0)
        episodes.dropFirst().reversed().forEach { playback.enqueue($0, next: true) }
    }
}

private struct FacetChip: View {
    let title: String
    let count: Int
    let selected: Bool
    let select: () -> Void

    var body: some View {
        Button(action: select) {
            HStack(spacing: 6) {
                Text(title)
                    .font(.sans(.footnote).weight(.medium))
                    .foregroundStyle(selected ? PodcstPalette.paper : PodcstPalette.ink)
                Text("\(count)")
                    .font(.sans(.caption))
                    .foregroundStyle(selected ? PodcstPalette.muted : PodcstPalette.tertiary)
            }
            .lineLimit(1)
            .padding(.horizontal, 13)
            .frame(height: 34)
            .background(selected ? PodcstPalette.ink : .clear, in: Capsule())
            .overlay { Capsule().strokeBorder(selected ? PodcstPalette.ink : PodcstPalette.rule) }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct DownloadedEpisodes: View {
    @Environment(MediaStore.self) private var media
    let episodes: [Episode]

    var body: some View {
        let ready = episodes.filter { media.status(for: $0).downloadedBytes != nil }
        let pending = episodes.filter { media.status(for: $0).downloadedBytes == nil }
        StorageLine(used: ready.compactMap { media.status(for: $0).downloadedBytes }.reduce(0, +))
        if !pending.isEmpty {
            ListCaption("Downloading · \(pending.count)")
            ForEach(pending, id: \.identity) { episode in
                EpisodeRow(episode: episode, context: .downloads, showsSeparator: episode.identity != pending.last?.identity)
            }
        }
        if !ready.isEmpty {
            ListCaption("Ready · \(ready.count)")
            ForEach(ready, id: \.identity) { episode in
                EpisodeRow(episode: episode, context: .downloads, showsSeparator: episode.identity != ready.last?.identity)
            }
        }
    }
}

private struct StorageLine: View {
    let used: Int64
    @State private var volume: (free: Int64, total: Int64)?

    var body: some View {
        let device = UIDevice.current.model
        let usedText = used.formatted(.byteCount(style: .file))
        let freeText = volume.map { $0.free.formatted(.byteCount(style: .file)) }
        VStack(alignment: .leading, spacing: 7) {
            GeometryReader { geometry in
                let total = Double(max(1, volume?.total ?? 1))
                ZStack(alignment: .leading) {
                    PodcstPalette.rule
                    if let volume {
                        PodcstPalette.faint.frame(width: geometry.size.width * min(1, Double(volume.total - volume.free) / total))
                        PodcstPalette.accent.frame(width: geometry.size.width * min(1, Double(used) / total))
                    }
                }
            }
            .frame(height: 6)
            .clipShape(Capsule())
            HStack(spacing: 6) {
                Circle()
                    .fill(PodcstPalette.accent)
                    .frame(width: 7, height: 7)
                Text("Podcst \(usedText)")
                Spacer()
                if let freeText { Text("\(freeText) free on this \(device)") }
            }
            .font(.sans(.caption))
            .foregroundStyle(PodcstPalette.tertiary)
        }
        .padding(.top, 16)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(["Podcst uses \(usedText).", freeText.map { "\($0) free on this \(device)." }].compactMap { $0 }.joined(separator: " "))
        .task(id: used) {
            let values = try? URL.homeDirectory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey, .volumeTotalCapacityKey])
            guard let free = values?.volumeAvailableCapacityForImportantUsage, let total = values?.volumeTotalCapacity else { return }
            volume = (free, Int64(total))
        }
    }
}

private struct ListCaption<Trailing: View>: View {
    let title: String
    let trailing: Trailing

    init(_ title: String, @ViewBuilder trailing: () -> Trailing = { EmptyView() }) {
        self.title = title
        self.trailing = trailing()
    }

    var body: some View {
        HStack {
            Text(title)
                .font(.sans(.footnote))
                .foregroundStyle(PodcstPalette.tertiary)
                .padding(.vertical, 4)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            trailing
        }
        .padding(.top, 16)
        .padding(.bottom, 4)
        .hairline()
    }
}
