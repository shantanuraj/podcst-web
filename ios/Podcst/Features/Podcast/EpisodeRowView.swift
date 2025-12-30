import SwiftUI

struct EpisodeRowView: View {
    @Environment(PlayerState.self) private var playerState
    let episode: Episode

    private var isCurrentlyPlaying: Bool {
        playerState.currentEpisode?.stableId == episode.stableId && playerState.isPlaying
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    if let date = episode.publishedDate {
                        Text(date, style: .date)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }

                    Text(episode.title)
                        .font(.headline)
                        .lineLimit(2)
                }

                Spacer()

                if let duration = episode.duration {
                    Text(duration.shortDurationFormatted)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if let summary = episode.summary, !summary.isEmpty {
                Text(summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            HStack(spacing: 16) {
                Button {
                    if isCurrentlyPlaying {
                        playerState.pause()
                    } else {
                        playerState.play(episode)
                    }
                } label: {
                    Label(
                        isCurrentlyPlaying ? "Pause" : "Play",
                        systemImage: isCurrentlyPlaying ? "pause.fill" : "play.fill"
                    )
                    .font(.caption)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .tint(isCurrentlyPlaying ? Color.accentColor : nil)

                if episode.id != nil {
                    Button {
                        playerState.queueEpisode(episode)
                    } label: {
                        Label("Queue", systemImage: "text.badge.plus")
                            .font(.caption)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }
        }
        .padding(.vertical, 8)
    }
}

struct EpisodeDetailView: View {
    let podcastId: Int
    let episodeId: Int

    var body: some View {
        Text("Episode \(episodeId)")
            .navigationTitle("Episode")
    }
}
