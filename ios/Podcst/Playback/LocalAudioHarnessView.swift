#if DEBUG
import SwiftUI
import UniformTypeIdentifiers

struct LocalAudioHarnessView: View {
    @Environment(PlaybackController.self) private var playback
    @Environment(MediaStore.self) private var media
    let transport: RoutingAudioTransport
    private let reference = ProcessInfo.processInfo.arguments.contains("-AudioLabReference")
    @State private var importing = false
    @State private var browsing = false
    @State private var isOpening = false
    @State private var scopedFile: URL?
    @State private var importError: String?
    @State private var scrubbing = false
    @State private var scrubPosition: Double = 0

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button {
                        browsing = true
                    } label: {
                        Label("Browse podcasts", systemImage: "magnifyingglass")
                    }
                    .disabled(isOpening)
                    Button {
                        importing = true
                    } label: {
                        Label("Open audio file", systemImage: "folder")
                    }
                    .disabled(isOpening)
                    if let importError {
                        Text(importError).foregroundStyle(.red)
                    }
                } header: {
                    Text("Choose audio")
                } footer: {
                    Text("US top podcasts, podcast search, and local MP3, M4A or WAV files. Test playback doesn’t update your library or listening history.")
                }

                if let episode = playback.currentEpisode {
                    Section {
                        HStack(spacing: 12) {
                            ArtworkView(url: episode.artworkURL, size: 56)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(episode.title)
                                    .font(.headline)
                                    .fixedSize(horizontal: false, vertical: true)
                                if let title = episode.podcastTitle {
                                    Text(title)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .padding(.vertical, 4)
                        if episode.audioURL?.isFileURL == false {
                            HStack {
                                DownloadButton(episode: episode)
                                if case .available = media.status(for: episode) {
                                    Spacer()
                                    Button("Play download") {
                                        Task { await open(episode) }
                                    }
                                    .buttonStyle(.borderless)
                                    .disabled(isOpening)
                                }
                            }
                            Text("Download to compare the same audio without network buffering.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        Slider(
                            value: Binding(
                                get: { scrubbing ? scrubPosition : playback.currentTime },
                                set: { scrubPosition = $0 }
                            ),
                            in: 0...max(1, playback.duration),
                            onEditingChanged: { editing in
                                if editing { scrubPosition = playback.currentTime }
                                scrubbing = editing
                                if !editing { playback.seek(to: scrubPosition) }
                            }
                        )
                        .accessibilityLabel("Playback position")
                        .accessibilityValue(timestamp(playback.currentTime))
                        HStack {
                            Text(timestamp(playback.currentTime))
                            Spacer()
                            Text(timestamp(playback.duration))
                        }
                        .font(.caption.monospacedDigit())
                        HStack(spacing: 28) {
                            Spacer()
                            Button { playback.skipBackward() } label: {
                                Image(systemName: "gobackward.10")
                            }
                            .accessibilityLabel("Back ten seconds")
                            Button { playback.toggle() } label: {
                                Image(systemName: playback.isPlaybackRequested ? "pause.circle.fill" : "play.circle.fill")
                                    .font(.system(size: 54))
                            }
                            .accessibilityLabel(playback.isPlaybackRequested ? "Pause" : "Play")
                            Button { playback.skipForward() } label: {
                                Image(systemName: "goforward.30")
                            }
                            .accessibilityLabel("Forward thirty seconds")
                            Spacer()
                        }
                        .buttonStyle(.borderless)
                        .font(.title)
                        .padding(.vertical, 8)
                        Picker("Speed", selection: Binding(get: { playback.rate }, set: { playback.setRate($0) })) {
                            ForEach(PlaybackController.supportedRates, id: \.self) { rate in
                                Text("\(rate, specifier: "%g")×").tag(rate)
                            }
                        }
                        if !reference { AudioControlsButton() }
                        LabeledContent("Player", value: playback.state.rawValue.capitalized)
                        if playback.state == .failed {
                            Text("Playback failed. Try playing again or choose another episode or file.")
                                .foregroundStyle(.red)
                        }
                    } header: {
                        Text("Playback")
                    } footer: {
                        Text(reference ? "AVPlayer reference without audio effects." : "Use the same passage and route when comparing speed and audio effects.")
                    }
                }

                Section {
                    TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                        VStack(spacing: 12) {
                            LabeledContent("Engine", value: engineName)
                            if let status = transport.diagnostics {
                                VStack(spacing: 12) {
                                    LabeledContent("Source", value: "\(Int(status.sourceSampleRate)) Hz")
                                    LabeledContent("Output", value: "\(Int(status.outputSampleRate)) Hz")
                                    LabeledContent("Queued buffers", value: "\(status.scheduledBuffers)")
                                    LabeledContent("Owned audio memory", value: ByteCountFormatter.string(fromByteCount: Int64(status.allocatedBytes), countStyle: .memory))
                                    LabeledContent("Underruns", value: "\(status.underruns)")
                                }
                                .font(.subheadline.monospacedDigit())
                            }
                            if transport.activeBackend == .systemFallback {
                                Text("This source uses AVPlayer fallback. Try downloading it or choose another file to test the custom engine.")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    Text(reference ? "Reference playback uses AVPlayer with the same session and controls." : "The peak limiter follows speed processing and sample-rate conversion. Audio settings apply to the native source.")
                    Text("Keep source, route, volume and speed identical for matched listening and power measurements.")
                } header: {
                    Text("Audio validation")
                }
            }
            .navigationTitle(reference ? "Audio Reference" : "Audio Lab")
            .tint(PodcstPalette.accent)
            .sheet(isPresented: $browsing) {
                AudioLabCatalogView { episode in
                    Task { await open(episode) }
                }
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.audio]) { result in
                switch result {
                case .success(let url): Task { await open(url) }
                case .failure:
                    importError = "The file could not be opened. Try selecting it again."
                }
            }
            .task {
                let arguments = ProcessInfo.processInfo.arguments
                if let option = arguments.firstIndex(of: "-AudioLabFile"), arguments.indices.contains(option + 1) {
                    await open(URL(fileURLWithPath: arguments[option + 1]))
                }
            }
        }
    }

    private var engineName: String {
        switch transport.activeBackend {
        case .custom: "Podcst custom engine"
        case .system: "AVPlayer"
        case .systemFallback: "AVPlayer fallback"
        case nil: playback.state == .loading ? "Preparing" : "No audio selected"
        }
    }

    private func open(_ url: URL) async {
        guard !isOpening else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        await open(Episode(
            guid: UUID().uuidString,
            feed: "local-audio-lab",
            podcastTitle: "Podcst Audio Lab",
            title: url.deletingPathExtension().lastPathComponent,
            file: EpisodeFile(url: url.absoluteString)
        ), scopedURL: scoped ? url : nil)
    }

    private func open(_ episode: Episode, scopedURL: URL? = nil) async {
        guard !isOpening else { return }
        isOpening = true
        defer { isOpening = false }
        playback.clear()
        await transport.releaseMedia()
        scopedFile?.stopAccessingSecurityScopedResource()
        scopedFile = scopedURL
        importError = nil
        playback.play(episode)
    }

    private func timestamp(_ seconds: TimeInterval) -> String {
        let value = Int(max(0, seconds))
        return value >= 3_600
            ? String(format: "%d:%02d:%02d", value / 3_600, value / 60 % 60, value % 60)
            : String(format: "%d:%02d", value / 60, value % 60)
    }
}
#endif
