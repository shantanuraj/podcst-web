import SwiftUI

struct MiniPlayerView: View {
    @Environment(PlayerState.self) private var playerState
    @State private var showNowPlaying = false

    var body: some View {
        if let episode = playerState.currentEpisode {
            VStack(spacing: 0) {
                GeometryReader { geometry in
                    Rectangle()
                        .fill(Color.accentColor)
                        .frame(width: geometry.size.width * playerState.progress)
                }
                .frame(height: 2)

                HStack(spacing: 12) {
                    AsyncImage(url: episode.artworkURL) { image in
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    } placeholder: {
                        Rectangle()
                            .fill(.tertiary)
                    }
                    .frame(width: 48, height: 48)
                    .clipped()

                    VStack(alignment: .leading, spacing: 2) {
                        Text(episode.title)
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .lineLimit(1)

                        Text(episode.podcastTitle ?? "")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }

                    Spacer()

                    HStack(spacing: 20) {
                        Button {
                            playerState.seekBackward()
                        } label: {
                            Image(systemName: "gobackward.10")
                                .font(.title3)
                        }

                        Button {
                            playerState.togglePlayback()
                        } label: {
                            Image(systemName: playerState.isPlaying ? "pause.fill" : "play.fill")
                                .font(.title2)
                        }

                        Button {
                            playerState.seekForward()
                        } label: {
                            Image(systemName: "goforward.30")
                                .font(.title3)
                        }
                    }
                    .foregroundStyle(.primary)
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
            }
            .background(.ultraThinMaterial)
            .onTapGesture {
                showNowPlaying = true
            }
            .sheet(isPresented: $showNowPlaying) {
                NowPlayingView()
            }
        }
    }
}
