#if DEBUG
import SwiftUI
import UniformTypeIdentifiers

struct LocalAudioHarnessView: View {
    @Environment(PlaybackController.self) private var playback
    let transport: LocalAudioTransport
    @State private var importing = false
    @State private var selectedFile: URL?
    @State private var scopedFile: URL?
    @State private var importError: String?
    @State private var scrubbing = false
    @State private var scrubPosition: Double = 0

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button {
                        importing = true
                    } label: {
                        Label("Open audio file", systemImage: "folder")
                    }
                    if let selectedFile {
                        Text(selectedFile.lastPathComponent)
                            .font(.headline)
                            .textSelection(.enabled)
                    }
                    if let importError {
                        Text(importError).foregroundStyle(.red)
                    }
                } footer: {
                    Text("Development player for local MP3, M4A and WAV files. Uses the native engine and final peak limiter. Files and playback progress stay on this device.")
                }

                if playback.currentEpisode != nil {
                    Section {
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
                                Image(systemName: playback.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                                    .font(.system(size: 54))
                            }
                            .accessibilityLabel(playback.isPlaying ? "Pause" : "Play")
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
                        LabeledContent("Player", value: playback.state.rawValue.capitalized)
                    } header: {
                        Text("Playback")
                    } footer: {
                        Text("Speed changes rebuild the development graph at the current position. Brief buffering during this transition is expected.")
                    }
                }

                Section {
                    TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                        let status = transport.diagnostics
                        VStack(spacing: 12) {
                            LabeledContent("Source", value: "\(Int(status.sourceSampleRate)) Hz")
                            LabeledContent("Output", value: "\(Int(status.outputSampleRate)) Hz")
                            LabeledContent("Queued buffers", value: "\(status.scheduledBuffers)")
                            LabeledContent("Owned audio memory", value: ByteCountFormatter.string(fromByteCount: Int64(status.allocatedBytes), countStyle: .memory))
                            LabeledContent("Underruns", value: "\(status.underruns)")
                            if status.failure != nil {
                                Text("Playback failed. Try another local MP3, M4A or WAV file.")
                                    .foregroundStyle(.red)
                            }
                        }
                        .font(.subheadline.monospacedDigit())
                    }
                    Text("The peak limiter follows speed processing. Volume Boost and Trim Silence are not enabled in this milestone.")
                    Text("Test seeking, background playback, headphones and the lock screen here. Device listening and power measurements remain part of M1.6.")
                } header: {
                    Text("Audio validation")
                }
            }
            .navigationTitle("Audio Lab")
            .tint(PodcstPalette.accent)
            .fileImporter(isPresented: $importing, allowedContentTypes: [.audio]) { result in
                switch result {
                case .success(let url): open(url)
                case .failure:
                    importError = "The file could not be opened. Try selecting it again."
                }
            }
            .task {
                let arguments = ProcessInfo.processInfo.arguments
                if let option = arguments.firstIndex(of: "-AudioLabFile"), arguments.indices.contains(option + 1) {
                    open(URL(fileURLWithPath: arguments[option + 1]))
                }
            }
        }
    }

    private func open(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        playback.clear()
        scopedFile?.stopAccessingSecurityScopedResource()
        scopedFile = scoped ? url : nil
        selectedFile = url
        importError = nil
        playback.play(Episode(
            guid: UUID().uuidString,
            feed: "local-audio-lab",
            podcastTitle: "Podcst Audio Lab",
            title: url.deletingPathExtension().lastPathComponent,
            file: EpisodeFile(url: url.absoluteString)
        ))
    }

    private func timestamp(_ seconds: TimeInterval) -> String {
        let value = Int(max(0, seconds))
        return value >= 3_600
            ? String(format: "%d:%02d:%02d", value / 3_600, value / 60 % 60, value % 60)
            : String(format: "%d:%02d", value / 60, value % 60)
    }
}
#endif
