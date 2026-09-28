import AVFoundation
import SwiftUI
import UniformTypeIdentifiers

struct LocalAudioHarnessView: View {
    @Environment(PlaybackController.self) private var playback
    @Environment(MediaStore.self) private var media
    @Environment(\.scenePhase) private var scenePhase
    let transport: RoutingAudioTransport
    private let reference = ProcessInfo.processInfo.arguments.contains("-AudioLabReference")
    @State private var inspection = AudioLabInspectionSession()
    @State private var importing = false
    @State private var browsing = false
    @State private var isOpening = false
    @State private var scopedFile: URL?
    @State private var importError: String?
    @State private var scrubbing = false
    @State private var scrubPosition: Double = 0
    @State private var comparisonSource: ComparisonSource?
    @State private var comparisonLease: MediaAssetLease?
    @State private var exporting = false
    @State private var captureDocument = AudioLabCaptureDocument()

    private var shouldInspect: Bool {
        inspection.isEnabled && !reference && scenePhase == .active && comparisonSource == nil
    }

    var body: some View {
        NavigationStack {
            List {
                if let episode = playback.currentEpisode {
                    playbackSection(episode)
                    if !reference {
                        Section {
                            Toggle("Volume Boost", isOn: effectBinding(\.volumeBoost))
                            Toggle("Trim Silence", isOn: effectBinding(\.trimSilence))
                            Button("Compare a passage", systemImage: "repeat") {
                                Task { await compare(at: playback.currentTime) }
                            }
                            .disabled(isOpening || playback.duration <= 0 || playback.state == .loading)
                            if case .unavailable(let reason) = playback.audioEffectState {
                                Text(reason).font(.footnote).foregroundStyle(.secondary)
                            }
                        } header: {
                            Text("Audio effects")
                        } footer: {
                            Text("Compare the same downloaded passage with effects off, boost, trim and both. Choose fixed level or matched loudness.")
                        }
                        AudioLabInspectorView(inspection: inspection, unsupportedBackend: transport.activeBackend == .systemFallback) { cut in
                            let length = cut.duration <= 4 ? 10.0 : cut.duration <= 14 ? 20.0 : 30.0
                            Task { await compare(at: max(0, cut.sourceEnd - length + 3), length: length) }
                        }
                    }
                } else {
                    Section {
                        ContentUnavailableView("Listen. Inspect. Compare.", systemImage: "waveform", description: Text("Choose an episode, open a local file, or start with the built-in test signal."))
                        sourceButtons
                    }
                }
                if let importError {
                    Section {
                        Text(importError).foregroundStyle(.red)
                    }
                }
                validationSection
            }
            .navigationTitle(reference ? "Audio Reference" : "Audio Lab")
            .tint(PodcstPalette.accent)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        sourceButtons
                    } label: {
                        Label("Choose audio", systemImage: "plus")
                    }
                    .disabled(isOpening)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Export capture", systemImage: "square.and.arrow.up") {
                        exportCapture()
                    }
                    .disabled(inspection.reading == nil && inspection.comparison == nil)
                }
            }
            .sheet(isPresented: $browsing) {
                AudioLabCatalogView { episode in Task { await open(episode) } }
            }
            .sheet(item: $comparisonSource, onDismiss: releaseComparison) { source in
                AudioLabComparisonView(sourceURL: source.url, position: source.position, duration: source.duration, rate: source.rate, initialLength: source.length, onBegin: { playback.pause() }, onReport: { report in
                    inspection.comparison = report
                    inspection.record("Comparison rendered", at: source.position)
                })
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.audio]) { result in
                switch result {
                case .success(let url): Task { await open(url) }
                case .failure: importError = "The file could not be opened. Try selecting it again."
                }
            }
            .fileExporter(isPresented: $exporting, document: captureDocument, contentType: .json, defaultFilename: "Podcst Audio Capture") { result in
                if case .failure = result { importError = "The capture could not be saved. Try exporting it again." }
            }
            .task(id: shouldInspect) {
                transport.configureInspection(enabled: shouldInspect)
                if shouldInspect { await inspection.run(transport: transport, playback: playback) }
            }
            .onChange(of: playback.state) { _, state in
                inspection.record("Playback \(state.rawValue)", at: playback.currentTime)
            }
            .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification).receive(on: RunLoop.main)) { _ in
                inspection.record("Output route changed", detail: AudioLabRoute.current.outputs.joined(separator: ", "), at: playback.currentTime)
            }
            .onChange(of: inspection.isEnabled) { _, enabled in
                inspection.record(enabled ? "Measurement enabled" : "Measurement disabled", at: playback.currentTime)
            }
            .task {
                let arguments = ProcessInfo.processInfo.arguments
                if let option = arguments.firstIndex(of: "-AudioLabFile"), arguments.indices.contains(option + 1) {
                    await open(URL(fileURLWithPath: arguments[option + 1]))
                } else if arguments.contains("-AudioLabFixture") {
                    await openFixture()
                }
            }
        }
    }

    @ViewBuilder
    private var sourceButtons: some View {
        Button("Browse podcasts", systemImage: "magnifyingglass") { browsing = true }
            .disabled(isOpening)
        Button("Open audio file", systemImage: "folder") { importing = true }
            .disabled(isOpening)
        Button("Use test signal", systemImage: "waveform.path") {
            Task { await openFixture() }
        }
        .disabled(isOpening)
    }

    private func playbackSection(_ episode: Episode) -> some View {
        Section {
            HStack(spacing: 12) {
                ArtworkView(url: episode.artworkURL, size: 56)
                VStack(alignment: .leading, spacing: 4) {
                    Text(episode.title).font(.headline).fixedSize(horizontal: false, vertical: true)
                    if let title = episode.podcastTitle {
                        Text(title).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.vertical, 4)
            if episode.audioURL?.isFileURL == false {
                HStack {
                    DownloadButton(episode: episode)
                    if case .available = media.status(for: episode) {
                        Spacer()
                        Button("Play download") { Task { await open(episode) } }
                            .buttonStyle(.borderless)
                            .disabled(isOpening)
                    }
                }
            }
            Slider(value: Binding(get: { scrubbing ? scrubPosition : playback.currentTime }, set: { scrubPosition = $0 }), in: 0...max(1, playback.duration), onEditingChanged: { editing in
                if editing { scrubPosition = playback.currentTime }
                scrubbing = editing
                if !editing { playback.seek(to: scrubPosition) }
            })
            .accessibilityLabel("Playback position")
            .accessibilityValue(AudioLabFormat.time(playback.currentTime))
            HStack {
                Text(AudioLabFormat.time(playback.currentTime))
                Spacer()
                Text(AudioLabFormat.time(playback.duration))
            }
            .font(.caption.monospacedDigit())
            HStack(spacing: 28) {
                Spacer()
                Button { playback.skipBackward() } label: { Image(systemName: "gobackward.10") }
                    .accessibilityLabel("Back ten seconds")
                Button { playback.toggle() } label: {
                    Image(systemName: playback.isPlaybackRequested ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 54))
                }
                .accessibilityLabel(playback.isPlaybackRequested ? "Pause" : "Play")
                Button { playback.skipForward() } label: { Image(systemName: "goforward.30") }
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
            if playback.state == .failed {
                Text("Playback failed. Try playing again or choose another source.").foregroundStyle(.red)
            }
        } header: {
            Text("Playback")
        }
    }

    private var validationSection: some View {
        Section {
            TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                VStack(spacing: 12) {
                    LabeledContent("Engine", value: engineName)
                    LabeledContent("Player", value: playback.state.rawValue.capitalized)
                    if let status = transport.diagnostics {
                        LabeledContent("Source / output", value: "\(Int(status.sourceSampleRate)) / \(Int(status.outputSampleRate)) Hz")
                        LabeledContent("Queued buffers", value: "\(status.scheduledBuffers)")
                        LabeledContent("Owned audio memory", value: ByteCountFormatter.string(fromByteCount: Int64(status.allocatedBytes), countStyle: .memory))
                        LabeledContent("Underruns", value: "\(status.underruns)")
                    }
                    if transport.activeBackend == .systemFallback {
                        Text("This source uses AVPlayer fallback. Signal inspection requires playback through the custom engine.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .font(.subheadline.monospacedDigit())
            }
        } header: {
            Text("Engine health")
        } footer: {
            Text(reference ? "AVPlayer reference with effects unavailable. Keep source, route, volume and speed identical between runs." : "Turn off Measure audio for power benchmarks. Exports contain measurements and configuration, without audio, episode titles or private source URLs.")
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

    private func effectBinding(_ keyPath: WritableKeyPath<AudioEffects, Bool>) -> Binding<Bool> {
        Binding(get: { playback.requestedEffects[keyPath: keyPath] }, set: { value in
            var options = playback.audioPreferences.options(for: playback.currentEpisode?.feed)
            options.effects[keyPath: keyPath] = value
            playback.audioPreferences.set(options, for: playback.currentEpisode?.feed)
        })
    }

    private func open(_ url: URL) async {
        guard !isOpening else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        await open(Episode(guid: UUID().uuidString, feed: "local-audio-lab", podcastTitle: "Podcst Audio Lab", title: url.deletingPathExtension().lastPathComponent, file: EpisodeFile(url: url.absoluteString)), scopedURL: scoped ? url : nil)
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
        inspection.reset()
        playback.play(episode)
    }

    private func openFixture() async {
        guard !isOpening else { return }
        isOpening = true
        do {
            let url = try await AudioLabFixtures.make()
            isOpening = false
            await open(url)
        } catch {
            isOpening = false
            importError = "The test signal could not be created."
        }
    }

    private func compare(at position: Double, length: Double = 20) async {
        guard !isOpening, let episode = playback.currentEpisode, let sourceURL = episode.audioURL else { return }
        isOpening = true
        defer { isOpening = false }
        do {
            let url: URL
            if sourceURL.isFileURL { url = sourceURL }
            else {
                guard case .available = media.status(for: episode) else {
                    importError = "Download this episode first to compare the same audio without network buffering."
                    return
                }
                let lease = try await media.pin(episode)
                guard episode.identity == playback.currentEpisode?.identity, let file = lease.completeFileURL else {
                    await lease.release()
                    importError = "The downloaded file is not ready. Try downloading it again."
                    return
                }
                comparisonLease = lease
                url = file
            }
            playback.pause()
            inspection.freeze()
            importError = nil
            comparisonSource = ComparisonSource(url: url, position: position, duration: playback.duration, rate: playback.rate, length: length)
        } catch {
            importError = "The source could not be prepared for comparison."
        }
    }

    private func releaseComparison() {
        let lease = comparisonLease
        comparisonLease = nil
        Task { await lease?.release() }
    }

    private func exportCapture() {
        do {
            captureDocument = try inspection.capture(backend: engineName, episode: playback.currentEpisode, options: playback.audioPreferences.options(for: playback.currentEpisode?.feed))
            exporting = true
        } catch {
            importError = "The capture could not be created. Try returning to live measurement."
        }
    }
}

private struct ComparisonSource: Identifiable {
    let id = UUID()
    let url: URL
    let position: Double
    let duration: Double
    let rate: Double
    let length: Double
}
