import SwiftUI

struct QueueView: View {
    @Environment(PlaybackController.self) private var playback

    var body: some View {
        NavigationStack {
            Group {
                if playback.queue.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "text.line.first.and.arrowtriangle.forward")
                            .font(.system(size: 42, weight: .light))
                            .foregroundStyle(PodcstPalette.tertiary)
                        Text("Your queue is empty")
                            .font(.system(.title2, design: .serif))
                        Text("Add episodes as you browse and they will appear here.")
                            .font(.subheadline)
                            .foregroundStyle(PodcstPalette.secondary)
                    }
                    .multilineTextAlignment(.center)
                    .padding(28)
                } else {
                    List {
                        ForEach(playback.queue, id: \.identity) { episode in
                            QueueRow(episode: episode, isCurrent: episode.identity == playback.currentEpisode?.identity)
                                .listRowBackground(PodcstPalette.paper)
                        }
                        .onDelete { offsets in playback.remove(atOffsets: offsets) }
                        .onMove { source, destination in playback.move(fromOffsets: source, toOffset: destination) }
                    }
                    .listStyle(.plain)
                    .toolbar { EditButton() }
                }
            }
            .podcstPage()
            .navigationTitle("Queue")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    AccountToolbarItem()
                }
            }
        }
    }
}

struct QueueRow: View {
    @Environment(PlaybackController.self) private var playback
    let episode: Episode
    let isCurrent: Bool

    var body: some View {
        HStack(spacing: 12) {
            ArtworkView(url: episode.artworkURL, size: 52)
            VStack(alignment: .leading, spacing: 3) {
                Text(episode.title)
                    .font(.subheadline.weight(isCurrent ? .semibold : .regular))
                    .lineLimit(2)
                Text(episode.podcastTitle ?? "")
                    .font(.caption)
                    .foregroundStyle(PodcstPalette.secondary)
                    .lineLimit(1)
            }
            Spacer()
            if isCurrent {
                Image(systemName: playback.isPlaying ? "waveform" : "pause.fill")
                    .foregroundStyle(PodcstPalette.accent)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { playback.play(episode) }
    }
}
