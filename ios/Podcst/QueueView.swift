import SwiftUI

struct QueueView: View {
    @Environment(PlaybackController.self) private var playback
    @Environment(Router.self) private var router

    private var summary: String {
        let left = playback.remaining + playback.upNext.compactMap(\.duration).reduce(0, +)
        let count = playback.queue.count == 1 ? "1 episode" : "\(playback.queue.count) episodes"
        return left > 0 ? "\(count) · \(Duration.seconds(left)) left" : count
    }

    var body: some View {
        Group {
            if let current = playback.currentEpisode {
                List {
                    Section {
                        Button {
                            router.showingPlayer = true
                        } label: {
                            NowPlayingCard(episode: current)
                        }
                        .buttonStyle(.plain)
                        .listRowInsets(EdgeInsets(top: 12, leading: 12, bottom: 6, trailing: 12))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    } header: {
                        Text(summary).eyebrow()
                    }
                    if !playback.upNext.isEmpty {
                        Section {
                            ForEach(playback.upNext, id: \.identity) { episode in
                                QueueRow(episode: episode)
                                    .listRowBackground(PodcstPalette.paper)
                                    .listRowSeparatorTint(PodcstPalette.rule)
                            }
                            .onDelete { playback.removeUpNext(atOffsets: $0) }
                            .onMove { playback.moveUpNext(fromOffsets: $0, toOffset: $1) }
                        } header: {
                            Text("Up next").eyebrow()
                        }
                    }
                }
                .listStyle(.plain)
            } else {
                EmptyState(systemImage: "text.line.first.and.arrowtriangle.forward", title: "Your queue is empty", message: "Add episodes as you browse and they will appear here.")
            }
        }
        .podcstPage()
        .navigationTitle("Queue")
        .toolbar {
            if !playback.upNext.isEmpty {
                ToolbarItem(placement: .topBarLeading) { EditButton() }
            }
            ToolbarItem(placement: .topBarTrailing) {
                AccountToolbarItem()
            }
        }
    }
}

private struct NowPlayingCard: View {
    @Environment(PlaybackController.self) private var playback
    let episode: Episode

    var body: some View {
        HStack(spacing: 12) {
            ArtworkView(url: episode.artworkURL, size: 52)
            VStack(alignment: .leading, spacing: 2) {
                Text("Now playing").eyebrow(PodcstPalette.accent)
                Text(episode.title)
                    .font(.serif(.body))
                    .lineLimit(1)
                Text([episode.podcastTitle, playback.remaining > 0 ? "\(Duration.seconds(playback.remaining)) left" : nil].compactMap { $0 }.joined(separator: " · "))
                    .font(.sans(.caption))
                    .foregroundStyle(PodcstPalette.secondary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Equalizer(active: playback.isPlaying)
                .padding(.trailing, 4)
        }
        .padding(12)
        .background(PodcstPalette.accentSoft, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityHint("Open Now Playing")
    }
}

struct QueueRow: View {
    @Environment(PlaybackController.self) private var playback
    let episode: Episode

    var body: some View {
        HStack(spacing: 12) {
            ArtworkView(url: episode.artworkURL, size: 48)
            VStack(alignment: .leading, spacing: 2) {
                Text(episode.title)
                    .font(.serif(.body))
                    .lineLimit(2)
                Text([episode.podcastTitle, episode.duration.flatMap { $0 > 0 ? Duration.seconds($0) : nil }].compactMap { $0 }.joined(separator: " · "))
                    .font(.sans(.caption))
                    .foregroundStyle(PodcstPalette.tertiary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .onTapGesture { playback.play(episode) }
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Play now")
    }
}
