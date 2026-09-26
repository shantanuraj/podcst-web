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
        playerTabs
            .tint(PodcstPalette.accent)
            .background(PodcstPalette.paper)
            .sheet(isPresented: $showingNowPlaying) {
                NowPlayingView()
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
            .preferredColorScheme(.dark)
            .toolbarBackground(PodcstPalette.paper, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
    }

    @ViewBuilder
    private var playerTabs: some View {
        if #available(iOS 26.1, *) {
            tabs.tabViewBottomAccessory(isEnabled: playback.currentEpisode != nil) {
                NowPlayingBar(showingDetail: $showingNowPlaying)
            }
        } else if #available(iOS 26.0, *) {
            tabs.tabViewBottomAccessory {
                if playback.currentEpisode != nil {
                    NowPlayingBar(showingDetail: $showingNowPlaying)
                }
            }
        } else {
            tabs
        }
    }

    private var tabs: some View {
        TabView(selection: $selectedTab) {
            Tab("Discover", systemImage: "sparkles", value: .discover) {
                DiscoverView()
                    .modifier(PlayerInset(showingDetail: $showingNowPlaying))
            }
            Tab("Library", systemImage: "books.vertical", value: .library) {
                LibraryView()
                    .modifier(PlayerInset(showingDetail: $showingNowPlaying))
            }
            Tab("Queue", systemImage: "text.line.first.and.arrowtriangle.forward", value: .queue) {
                QueueView()
                    .modifier(PlayerInset(showingDetail: $showingNowPlaying))
            }
        }
    }
}

private struct PlayerInset: ViewModifier {
    @Environment(PlaybackController.self) private var playback
    @Binding var showingDetail: Bool

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
        } else {
            content.safeAreaInset(edge: .bottom, spacing: 0) {
                if playback.currentEpisode != nil {
                    NowPlayingBar(showingDetail: $showingDetail)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                }
            }
        }
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
                    ArtworkView(url: playback.currentEpisode?.artworkURL, size: 40)
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
            .accessibilityLabel("\(playback.currentEpisode?.title ?? ""), \(playback.currentEpisode?.podcastTitle ?? "Podcst")")
            .accessibilityHint("Open Now Playing")
            Button {
                playback.toggle()
            } label: {
                Image(systemName: playback.isPlaying ? "pause.fill" : "play.fill")
                    .font(.body.weight(.semibold))
                    .frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(playback.isPlaying ? "Pause" : "Play")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .accessibilityElement(children: .contain)
    }
}

struct ArtworkView: View {
    let url: URL?
    var size: CGFloat? = nil

    var body: some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay {
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
            }
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: min(12, (size ?? 160) * 0.16)))
            .accessibilityHidden(true)
    }
}
