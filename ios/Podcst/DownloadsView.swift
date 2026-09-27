import SwiftUI

struct DownloadsView: View {
    @Environment(MediaStore.self) private var media

    private var ready: [Episode] {
        media.downloadedEpisodes.filter {
            if case .available = media.status(for: $0) { return true }
            return false
        }
    }

    private var pending: [Episode] {
        media.downloadedEpisodes.filter {
            if case .available = media.status(for: $0) { return false }
            return true
        }
    }

    var body: some View {
        Group {
            if media.downloadedEpisodes.isEmpty {
                ContentUnavailableView {
                    Label("Listen anywhere", systemImage: "arrow.down.circle")
                        .font(.serif(.title2))
                } description: {
                    Text("Download episodes from their details or episode menu to keep listening offline.")
                        .font(.sans(.body))
                        .foregroundStyle(PodcstPalette.secondary)
                }
            } else {
                List {
                    if !pending.isEmpty {
                        Section {
                            ForEach(pending, id: \.identity) { episode in
                                DownloadRow(episode: episode)
                            }
                        } header: {
                            Text("Pending downloads").eyebrow()
                        }
                    }
                    if !ready.isEmpty {
                        Section {
                            ForEach(ready, id: \.identity) { episode in
                                DownloadRow(episode: episode)
                            }
                        } header: {
                            Text("Ready to listen").eyebrow()
                        } footer: {
                            Text("These episodes are ready to play without an internet connection.")
                                .font(.sans(.footnote))
                                .foregroundStyle(PodcstPalette.secondary)
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .podcstPage()
        .navigationTitle("Downloads")
        .navigationBarTitleDisplayMode(.large)
        .downloadAlerts()
    }
}

private struct DownloadRow: View {
    @Environment(MediaStore.self) private var media
    @Environment(PlaybackController.self) private var playback
    let episode: Episode

    private var status: MediaDownloadState { media.status(for: episode) }
    private var isCurrent: Bool { playback.currentEpisode?.identity == episode.identity }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                NavigationLink(value: Route.episode(episode)) {
                    HStack(alignment: .top, spacing: 12) {
                        ArtworkView(url: episode.artworkURL, size: 56)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(episode.title)
                                .font(.serif(.body))
                                .fixedSize(horizontal: false, vertical: true)
                            if let podcast = episode.podcastTitle, !podcast.isEmpty {
                                Text(podcast)
                                    .font(.sans(.caption))
                                    .foregroundStyle(PodcstPalette.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(episode.title), episode details")
                DownloadButton(episode: episode, compact: true)
            }
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(status.downloadDescription)
                        .font(.sans(.caption))
                        .foregroundStyle(PodcstPalette.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if case .downloading = status {
                        if let progress = status.downloadProgress {
                            ProgressView(value: progress)
                                .tint(PodcstPalette.accent)
                                .accessibilityLabel("Download progress")
                        } else {
                            ProgressView()
                                .tint(PodcstPalette.accent)
                                .accessibilityLabel("Downloading")
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if case .available = status {
                    Button {
                        if isCurrent { playback.toggle() } else { playback.play(episode) }
                    } label: {
                        Image(systemName: isCurrent && playback.isPlaying ? "pause.fill" : "play.fill")
                            .font(.sans(.body).weight(.semibold))
                            .foregroundStyle(PodcstPalette.accent)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(isCurrent && playback.isPlaying ? "Pause \(episode.title)" : "Play \(episode.title)")
                }
            }
        }
        .padding(.vertical, 12)
        .listRowBackground(PodcstPalette.paper)
        .listRowSeparatorTint(PodcstPalette.rule)
        .contextMenu {
            DownloadMenuActions(episode: episode)
        }
    }
}
