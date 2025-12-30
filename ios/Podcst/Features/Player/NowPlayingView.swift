import SwiftUI

struct NowPlayingView: View {
    @Environment(PlayerState.self) private var playerState
    @Environment(\.dismiss) private var dismiss
    @State private var isDragging = false
    @State private var dragPosition: TimeInterval = 0

    private var displayTime: TimeInterval {
        isDragging ? dragPosition : playerState.currentTime
    }

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(.secondary)
                .frame(width: 40, height: 4)
                .padding(.top, 8)
                .padding(.bottom, 24)

            if let episode = playerState.currentEpisode {
                ScrollView {
                    VStack(spacing: 32) {
                        AsyncImage(url: episode.artworkURL) { image in
                            image
                                .resizable()
                                .aspectRatio(1, contentMode: .fit)
                        } placeholder: {
                            Rectangle()
                                .fill(.tertiary)
                                .aspectRatio(1, contentMode: .fit)
                        }
                        .frame(maxWidth: 320)
                        .shadow(radius: 20)

                        VStack(spacing: 8) {
                            Text(episode.title)
                                .font(.title2)
                                .fontWeight(.semibold)
                                .multilineTextAlignment(.center)
                                .lineLimit(3)

                            Text(episode.podcastTitle ?? "")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.horizontal)

                        VStack(spacing: 8) {
                            Slider(
                                value: Binding(
                                    get: { displayTime },
                                    set: { newValue in
                                        dragPosition = newValue
                                    }
                                ),
                                in: 0...max(playerState.duration, 1),
                                onEditingChanged: { editing in
                                    if editing {
                                        isDragging = true
                                        dragPosition = playerState.currentTime
                                    } else {
                                        playerState.seek(to: dragPosition)
                                        isDragging = false
                                    }
                                }
                            )
                            .tint(Color.accentColor)

                            HStack {
                                Text(displayTime.formatted)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()

                                Spacer()

                                Text("-" + (playerState.duration - displayTime).formatted)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()
                            }
                        }
                        .padding(.horizontal, 24)

                        HStack(spacing: 48) {
                            Button {
                                playerState.skipToPrevious()
                            } label: {
                                Image(systemName: "backward.fill")
                                    .font(.title)
                            }

                            Button {
                                playerState.seekBackward()
                            } label: {
                                Image(systemName: "gobackward.10")
                                    .font(.title)
                            }

                            Button {
                                playerState.togglePlayback()
                            } label: {
                                Image(systemName: playerState.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                                    .font(.system(size: 72))
                            }

                            Button {
                                playerState.seekForward()
                            } label: {
                                Image(systemName: "goforward.30")
                                    .font(.title)
                            }

                            Button {
                                playerState.skipToNext()
                            } label: {
                                Image(systemName: "forward.fill")
                                    .font(.title)
                            }
                        }
                        .foregroundStyle(.primary)

                        HStack(spacing: 32) {
                            PlaybackRateButton(rate: playerState.rate) { newRate in
                                playerState.rate = newRate
                            }

                            Button {
                            } label: {
                                Image(systemName: "airplayaudio")
                                    .font(.title3)
                            }

                            Button {
                            } label: {
                                Image(systemName: "list.bullet")
                                    .font(.title3)
                            }
                        }
                        .foregroundStyle(.secondary)
                    }
                    .padding()
                }
            } else {
                ContentUnavailableView(
                    "Nothing Playing",
                    systemImage: "music.note",
                    description: Text("Select an episode to start listening")
                )
            }
        }
        .background(.background)
    }
}

struct PlaybackRateButton: View {
    let rate: Float
    let onRateChange: (Float) -> Void

    private let rates: [Float] = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]

    var body: some View {
        Menu {
            ForEach(rates, id: \.self) { r in
                Button {
                    onRateChange(r)
                } label: {
                    HStack {
                        Text(String(format: "%.2fx", r))
                        if r == rate {
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }
        } label: {
            Text(String(format: "%.1fx", rate))
                .font(.subheadline)
                .fontWeight(.medium)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(.tertiary, in: Capsule())
        }
    }
}
