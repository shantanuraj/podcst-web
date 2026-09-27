import SwiftUI

struct PodcastDetailView: View {
    @Environment(APIClient.self) private var api
    @Environment(LibraryStore.self) private var library
    @Environment(PlaybackController.self) private var playback
    let podcast: Podcast
    @State private var detail: Podcast?
    @State private var isLoading = false
    @State private var filter = ""
    @State private var newestFirst = true
    @State private var expanded = false
    @State private var titleVisible = false

    private var content: Podcast { detail ?? podcast }

    private var episodes: [Episode] {
        let sorted = content.episodes.sorted {
            let order = ($0.published ?? .distantPast) > ($1.published ?? .distantPast)
            return newestFirst ? order : !order
        }
        guard !filter.isEmpty else { return sorted }
        return sorted.filter { $0.title.localizedCaseInsensitiveContains(filter) }
    }

    private var host: String? {
        content.link.flatMap(URL.init(string:))?.host()?.replacingOccurrences(of: "www.", with: "")
    }

    var body: some View {
        let subscribed = library.isSubscribed(content)
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ArtworkView(url: content.artworkURL, size: 180)
                    .shadow(color: .black.opacity(0.3), radius: 20, y: 14)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 4)
                VStack(spacing: 6) {
                    Text(content.title)
                        .font(.serif(.title))
                        .tracking(-0.4)
                    HStack(spacing: 4) {
                        Text(content.author)
                            .foregroundStyle(PodcstPalette.secondary)
                        if let host, let link = content.link.flatMap(URL.init(string:)) {
                            Text("·").foregroundStyle(PodcstPalette.secondary)
                            Link(host, destination: link)
                                .foregroundStyle(PodcstPalette.accent)
                        }
                    }
                    .font(.sans(.subheadline))
                    .lineLimit(1)
                    if let published = ([content.published] + content.episodes.map(\.published)).compactMap({ $0 }).max() {
                        Text("Updated \(published.formatted(.dateTime.year().month(.wide).day()))")
                            .eyebrow()
                    }
                }
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.top, 18)
                HStack(spacing: 10) {
                    Button {
                        Task { await library.toggleSubscription(content) }
                    } label: {
                        HStack(spacing: 6) {
                            if subscribed { Image(systemName: "checkmark").foregroundStyle(PodcstPalette.accent) }
                            Text(subscribed ? "Subscribed" : "Subscribe")
                        }
                    }
                    .buttonStyle(PodcstButtonStyle(kind: subscribed ? .surface : .ink, height: 44))
                    Button {
                        if let latest = episodes.first { playback.play(latest) }
                    } label: {
                        Label("Latest", systemImage: "play.fill")
                    }
                    .buttonStyle(PodcstButtonStyle(kind: .surface, height: 44))
                    .disabled(content.episodes.isEmpty)
                    if let url = URL(string: content.link ?? content.feed) {
                        ShareLink(item: url) {
                            Image(systemName: "square.and.arrow.up")
                                .frame(width: 20)
                        }
                        .buttonStyle(PodcstButtonStyle(kind: .surface, height: 44))
                        .frame(width: 44)
                        .accessibilityLabel("Share podcast")
                    }
                }
                .padding(.top, 16)
                if !content.description.isEmpty {
                    Text(content.description.strippingHTML.trimmingCharacters(in: .whitespacesAndNewlines))
                        .font(.sans(.subheadline))
                        .lineSpacing(4)
                        .foregroundStyle(PodcstPalette.secondary)
                        .lineLimit(expanded ? nil : 2)
                        .padding(.top, 16)
                        .onTapGesture { withAnimation(.snappy) { expanded.toggle() } }
                        .accessibilityAddTraits(.isButton)
                        .accessibilityHint(expanded ? "Collapse description" : "Expand description")
                }
                SectionHeader("Episodes") {
                    Menu {
                        Picker("Order", selection: $newestFirst) {
                            Text("Newest first").tag(true)
                            Text("Oldest first").tag(false)
                        }
                    } label: {
                        Text("\(max(content.episodeCount, content.episodes.count)) · \(newestFirst ? "Newest first" : "Oldest first")")
                            .font(.sans(.footnote))
                            .foregroundStyle(PodcstPalette.tertiary)
                    }
                }
                .padding(.top, 20)
                if content.episodes.count > 10 {
                    TextField("Filter episodes", text: $filter)
                        .modifier(FieldChrome())
                        .padding(.vertical, 12)
                }
                if !content.episodes.isEmpty {
                    ForEach(episodes, id: \.identity) { episode in
                        EpisodeRow(episode: episode)
                    }
                } else if isLoading {
                    ProgressView().frame(maxWidth: .infinity).padding(30)
                } else {
                    Text("No episodes available.")
                        .foregroundStyle(PodcstPalette.secondary)
                        .padding(.vertical, 20)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.y + geometry.contentInsets.top > 250
        } action: { _, visible in
            withAnimation(.easeInOut(duration: 0.2)) { titleVisible = visible }
        }
        .podcstPage()
        .navigationTitle(titleVisible ? content.title : "")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadDetails() }
    }

    private func loadDetails() async {
        if detail == nil {
            detail = api.cachedPodcast(id: podcast.id, feed: podcast.feed)
        }
        isLoading = detail == nil
        defer { isLoading = false }
        detail = (try? await api.detail(of: podcast)) ?? detail ?? podcast
    }
}

struct EpisodeRow: View {
    enum Lead {
        case date
        case artwork
    }

    @Environment(PlaybackController.self) private var playback
    let episode: Episode
    var lead: Lead = .date

    private var duration: TimeInterval? { episode.duration.flatMap { $0 > 0 ? $0 : nil } }

    private var fraction: Double? {
        guard let position = playback.position(of: episode), position > 0, let duration else { return nil }
        return min(1, position / duration)
    }

    private var meta: String {
        let remaining = playback.position(of: episode).flatMap { position in
            duration.flatMap { position > 0 ? "\(Duration.seconds(max(0, $0 - position))) left" : nil }
        }
        switch lead {
        case .date:
            return [duration.map(Duration.seconds), remaining].compactMap { $0 }.joined(separator: " · ")
        case .artwork:
            if let remaining { return remaining }
            let isNew = episode.published.map { $0 > .now.addingTimeInterval(-7 * 86400) } ?? false
            return [isNew ? "New" : episode.podcastTitle, duration.map(Duration.seconds)].compactMap { $0 }.joined(separator: " · ")
        }
    }

    var body: some View {
        let isCurrent = playback.position(of: episode) != nil
        HStack(spacing: 14) {
            NavigationLink(value: Route.episode(episode)) {
                HStack(spacing: 14) {
                    switch lead {
                    case .date: DateBlock(date: episode.published)
                    case .artwork: ArtworkView(url: episode.artworkURL, size: 48)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(episode.title)
                            .font(.serif(.body))
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        HStack(spacing: 8) {
                            if lead == .artwork, let fraction {
                                Capsule()
                                    .fill(PodcstPalette.rule)
                                    .frame(width: 44, height: 3)
                                    .overlay(alignment: .leading) {
                                        Capsule().fill(PodcstPalette.accent).frame(width: 44 * fraction)
                                    }
                            }
                            Text(meta)
                                .font(.sans(.caption))
                                .foregroundStyle(PodcstPalette.tertiary)
                                .lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(episode.title), \(episode.dateline)")
            Button {
                if isCurrent { playback.toggle() } else { playback.play(episode) }
            } label: {
                RoundIcon(systemName: isCurrent && playback.isPlaying ? "pause.fill" : "play.fill")
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isCurrent && playback.isPlaying ? "Pause \(episode.title)" : "Play \(episode.title)")
        }
        .padding(.vertical, 12)
        .hairline()
        .contextMenu {
            Button("Play next", systemImage: "text.line.first.and.arrowtriangle.forward") { playback.enqueue(episode, next: true) }
            Button("Add to queue", systemImage: "text.append") { playback.enqueue(episode) }
        }
    }
}

struct EpisodeDetailView: View {
    @Environment(PlaybackController.self) private var playback
    let episode: Episode

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .bottom, spacing: 16) {
                    ArtworkView(url: episode.artworkURL, size: 96)
                    Text(episode.dateline)
                        .eyebrow()
                }
                .padding(.top, 8)
                Text(episode.title)
                    .font(.serif(.title))
                    .tracking(-0.4)
                    .padding(.top, 18)
                NavigationLink(value: Route.podcast(episode.podcast)) {
                    Text(episode.byline)
                        .font(.sans(.subheadline))
                        .foregroundStyle(PodcstPalette.secondary)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
                .padding(.top, 6)
                HStack(spacing: 10) {
                    EpisodePlayButton(episode: episode)
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
                .padding(.top, 20)
                PodcstPalette.rule
                    .frame(height: 1)
                    .padding(.vertical, 20)
                ShowNotesContent(episode: episode)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 28)
        }
        .podcstPage()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let url = URL(string: episode.link ?? episode.file.url) {
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(item: url)
                }
            }
        }
    }
}

private struct EpisodePlayButton: View {
    @Environment(PlaybackController.self) private var playback
    let episode: Episode

    var body: some View {
        let position = playback.position(of: episode)
        let playing = position != nil && playback.isPlaying
        let fraction = position.map { _ in playback.progress } ?? 0
        Button {
            if position != nil { playback.toggle() } else { playback.play(episode) }
        } label: {
            Label(title(position: position, playing: playing), systemImage: playing ? "pause.fill" : "play.fill")
        }
        .buttonStyle(PodcstButtonStyle(kind: .accent))
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
    @Environment(PlaybackController.self) private var playback
    let episode: Episode
    @State private var rendered: (identity: String, text: AttributedString)?

    var body: some View {
        let notes = ShowNotesParser.notes(of: episode)
        VStack(alignment: .leading, spacing: 16) {
            if notes.isEmpty {
                Text("No show notes were provided for this episode.")
                    .foregroundStyle(PodcstPalette.secondary)
            } else if let rendered, rendered.identity == episode.identity {
                Text(rendered.text)
                    .font(.sans(.body))
                    .lineSpacing(6)
                    .foregroundStyle(PodcstPalette.secondary)
                    .tint(PodcstPalette.accent)
                    .textSelection(.enabled)
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
            if let link = episode.link, let url = URL(string: link) {
                Link("Open episode website", destination: url)
                    .font(.sans(.subheadline).weight(.medium))
                    .foregroundStyle(PodcstPalette.accent)
            }
        }
        .task(id: episode.identity) {
            rendered = (episode.identity, ShowNotesParser.attributedString(notes))
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
