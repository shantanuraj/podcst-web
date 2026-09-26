import SwiftUI

enum AppTab: Hashable {
    case discover
    case library
    case queue
}

struct RootView: View {
    @Environment(PlaybackController.self) private var playback
    @State private var selectedTab: AppTab = .discover
    @State private var showingNowPlaying = false

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab("Discover", systemImage: "sparkles", value: .discover) {
                DiscoverView()
            }
            Tab("Library", systemImage: "books.vertical", value: .library) {
                LibraryView()
            }
            Tab("Queue", systemImage: "text.line.first.and.arrowtriangle.forward", value: .queue) {
                QueueView()
            }
        }
        .tint(PodcstPalette.accent)
        .background(PodcstPalette.paper)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if playback.currentEpisode != nil {
                NowPlayingBar(showingDetail: $showingNowPlaying)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 8)
            }
        }
        .sheet(isPresented: $showingNowPlaying) {
            NowPlayingView()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .preferredColorScheme(.dark)
        .toolbarBackground(PodcstPalette.paper, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

struct AccountToolbarItem: View {
    @State private var showingSettings = false

    var body: some View {
        Button {
            showingSettings = true
        } label: {
            Image(systemName: "person.crop.circle")
        }
        .accessibilityLabel("Account and settings")
        .sheet(isPresented: $showingSettings) {
            SettingsView()
        }
    }
}

struct NowPlayingBar: View {
    @Environment(PlaybackController.self) private var playback
    @Binding var showingDetail: Bool

    var body: some View {
        HStack(spacing: 12) {
            Button {
                showingDetail = true
            } label: {
                HStack(spacing: 12) {
                    ArtworkView(url: playback.currentEpisode?.artworkURL, size: 46)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(playback.currentEpisode?.title ?? "")
                            .font(.subheadline.weight(.medium))
                            .lineLimit(1)
                        Text(playback.currentEpisode?.podcastTitle ?? "Podcst")
                            .font(.caption)
                            .foregroundStyle(PodcstPalette.secondary)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .buttonStyle(.plain)
            Button {
                playback.toggle()
            } label: {
                Image(systemName: playback.isPlaying ? "pause.fill" : "play.fill")
                    .font(.body.weight(.semibold))
                    .frame(width: 34, height: 34)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(playback.isPlaying ? "Pause" : "Play")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
    }
}

struct ArtworkView: View {
    let url: URL?
    let size: CGFloat

    var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let image):
                image.resizable().scaledToFill()
            default:
                ZStack {
                    PodcstPalette.surface
                    Image(systemName: "waveform").foregroundStyle(PodcstPalette.tertiary)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: min(12, size * 0.16)))
    }
}
