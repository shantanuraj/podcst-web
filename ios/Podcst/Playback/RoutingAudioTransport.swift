import Foundation
import Observation

@MainActor
final class RoutingAudioTransport: PlaybackTransport {
    enum Backend: String {
        case custom
        case system
        case systemFallback
    }

    var onUpdate: (@MainActor (PlaybackTransportUpdate) -> Void)?
    var hasSource: Bool { source != nil }
    var position: TimeInterval { backend?.position ?? targetPosition }
    var diagnostics: LocalAudioDiagnostics? { (backend as? LocalAudioTransport)?.diagnostics }
    var activeBackend: Backend? {
        guard let backend else { return nil }
        if backend is LocalAudioTransport { return .custom }
        return fallbackReason == nil ? .system : .systemFallback
    }

    private let media: MediaStore
    private let preferSystemPlayback: Bool
    private var backend: (any PlaybackTransport)?
    private var source: PlaybackSource?
    private var lease: MediaAssetLease?
    private var releasing = false
    private var preparation: Task<Void, Never>?
    private var retirements: [UUID: Task<Void, Never>] = [:]
    private var generation = UUID()
    private var session = UUID()
    private var targetPosition: TimeInterval = 0
    private var rate: Double = 1
    private var effects = AudioEffects()
    private var fallbackReason: String?
    private var needsDownloadForEffects = false
    private var inspectionEnabled = false
    private var lastTraceSample: TimeInterval = 0

    init(media: MediaStore, preferSystemPlayback: Bool = false) {
        self.media = media
        self.preferSystemPlayback = preferSystemPlayback
    }

    func configureInspection(enabled: Bool) {
        inspectionEnabled = enabled
        (backend as? LocalAudioTransport)?.configureInspection(enabled: enabled)
    }

    func inspectionSnapshot() async -> AudioInspectionSnapshot? {
        await (backend as? LocalAudioTransport)?.inspectionSnapshot()
    }

    var activeInspectionEpoch: UUID? { (backend as? LocalAudioTransport)?.activeInspectionEpoch }

    func takeOutputInspection(epoch: UUID) async -> [AudioOutputInspectionPacket] {
        await (backend as? LocalAudioTransport)?.takeOutputInspection(epoch: epoch) ?? []
    }

    func load(source: PlaybackSource, at position: TimeInterval, generation: UUID) {
        guard !releasing else { return }
        stop()
        self.source = source
        self.generation = generation
        targetPosition = position
        trace("route_load", values: ["position": position, "preferSystem": preferSystemPlayback ? 1 : 0])
        let token = session
        let pendingRetirements = Array(retirements.values)
        preparation = Task { [weak self] in
            guard let self, self.session == token, !Task.isCancelled else { return }
            guard let url = source.url else { self.emit(.failed); return }
            do {
                for retirement in pendingRetirements { await retirement.value }
                guard self.session == token, !Task.isCancelled else { return }
                if url.isFileURL {
                    if self.preferSystemPlayback { self.installSystem(token: token) }
                    else { self.installNative(source: source, decoder: nil, token: token) }
                } else if case .episode(let episode) = source {
                    if !self.preferSystemPlayback, url.pathExtension.lowercased() == "m3u8" || episode.file.type.lowercased().contains("mpegurl") {
                        self.installSystem(reason: "Audio effects are unavailable for live streams.", token: token)
                        return
                    }
                    let lease = try await self.media.pin(episode)
                    guard self.session == token, !Task.isCancelled else { await lease.release(); return }
                    self.lease = lease
                    self.trace("route_pinned", values: ["completeFile": lease.completeFileURL == nil ? 0 : 1])
                    if self.preferSystemPlayback {
                        if let file = lease.completeFileURL {
                            let snapshot = await lease.byteSource.snapshot()
                            guard self.session == token, !Task.isCancelled else { return }
                            self.installSystem(token: token, effectiveSource: .url(file, contentType: snapshot.metadata?.contentType))
                        } else {
                            self.installSystem(token: token)
                        }
                        return
                    }
                    if let file = lease.completeFileURL {
                        let metadata = try await lease.byteSource.metadata()
                        guard self.session == token, !Task.isCancelled else { return }
                        self.installNative(source: .url(file, contentType: metadata.contentType), decoder: nil, token: token)
                    } else {
                        let metadata = try await lease.byteSource.metadata()
                        guard self.session == token, !Task.isCancelled else { return }
                        if let file = await lease.byteSource.completeFileURL() {
                            guard self.session == token, !Task.isCancelled else { return }
                            self.installNative(source: .url(file, contentType: metadata.contentType), decoder: nil, token: token)
                        } else if metadata.capability == .randomAccess {
                            let configuration = LocalAudioConfiguration()
                            let decoder = ProgressiveAudioDecoder(source: lease.byteSource, blockFrames: configuration.blockFrames, bufferCount: 2)
                            self.installNative(source: source, decoder: decoder, token: token)
                        } else {
                            self.installSystem(reason: "Download this episode to use audio effects. This server does not support reliable streaming with effects.", token: token, needsDownload: true)
                        }
                    }
                } else {
                    self.installSystem(reason: self.preferSystemPlayback ? nil : "Download this episode to use audio effects.", token: token)
                }
            } catch {
                guard self.session == token, !Task.isCancelled else { return }
                let failure = error as NSError
                self.trace("route_prepare_failed", values: ["code": Double(failure.code)], labels: ["domain": failure.domain])
                let failedLease = self.lease
                self.lease = nil
                await failedLease?.release()
                guard self.session == token, !Task.isCancelled else { return }
                self.emit(.failed)
            }
        }
    }

    func play(atRate rate: Double) {
        self.rate = rate
        trace("route_play", values: ["rate": rate, "position": position])
        backend?.play(atRate: rate)
    }

    func pause() {
        trace("route_pause", values: ["position": position])
        backend?.pause()
    }

    func seek(to position: TimeInterval, generation: UUID) {
        targetPosition = position
        self.generation = generation
        trace("route_seek", values: ["position": position])
        if let backend { backend.seek(to: position, generation: generation) }
        else if let source { load(source: source, at: position, generation: generation) }
    }

    func setRate(_ rate: Double) {
        self.rate = rate
        trace("route_rate", values: ["rate": rate])
        backend?.setRate(rate)
    }

    func setEffects(_ effects: AudioEffects) {
        self.effects = effects
        trace("route_effects", values: ["boost": effects.volumeBoost ? 1 : 0, "trim": effects.trimSilence ? 1 : 0])
        if preferSystemPlayback {
            if backend != nil { emit(.effects(systemEffectState)) }
        } else if fallbackReason != nil {
            if resumeEffectsFromDownload() { return }
            emit(.effects(systemEffectState))
        } else {
            backend?.setEffects(effects)
            if backend == nil, effects.enabled { emit(.effects(.preparing)) }
        }
    }

    func stop() {
        if source != nil || backend != nil { trace("route_stop", values: ["position": position]) }
        session = UUID()
        if let preparation {
            preparation.cancel()
            let id = UUID()
            retirements[id] = Task { [weak self] in
                await preparation.value
                self?.retirements[id] = nil
            }
        }
        preparation = nil
        let retiring = backend
        backend = nil
        source = nil
        fallbackReason = nil
        needsDownloadForEffects = false
        targetPosition = 0
        retire(retiring, releasingLease: true)
    }

    func shutdown() {
        onUpdate = nil
        stop()
    }

    func releaseMedia() async {
        releasing = true
        defer { releasing = false }
        stop()
        while !retirements.isEmpty {
            for task in Array(retirements.values) { await task.value }
        }
    }

    private func installNative(source: PlaybackSource, decoder: (any PCMDecoder)?, token: UUID) {
        guard session == token else { return }
        let transport = LocalAudioTransport(sourceDecoder: decoder)
        transport.configureInspection(enabled: inspectionEnabled)
        backend = transport
        trace("route_install", labels: ["backend": "custom", "input": decoder == nil ? "file" : "progressive"])
        transport.onUpdate = { [weak self, weak transport] update in
            guard let self, let transport, self.backend === transport, self.session == token, update.generation == self.generation else { return }
            if case .failed = update.event, transport.diagnostics.failure == .unsupportedFormat {
                self.trace("route_unsupported_format")
                self.targetPosition = transport.position
                self.installSystem(reason: "Audio effects are unavailable for this format.", token: token, effectiveSource: source)
                return
            }
            self.emit(update.event)
        }
        transport.setRate(rate)
        transport.setEffects(effects)
        transport.load(source: source, at: targetPosition, generation: generation)
    }

    private func installSystem(reason: String? = nil, token: UUID, effectiveSource: PlaybackSource? = nil, needsDownload: Bool = false) {
        guard session == token, let source = effectiveSource ?? source else { return }
        if backend != nil { trace("route_retire", values: ["releaseLease": source.url?.isFileURL == true ? 0 : 1]) }
        retire(backend, releasingLease: source.url?.isFileURL != true)
        let transport = AVPlayerTransport()
        backend = transport
        fallbackReason = reason
        needsDownloadForEffects = needsDownload
        trace("route_install", values: ["needsDownload": needsDownload ? 1 : 0], labels: ["backend": reason == nil ? "system" : "systemFallback", "input": source.url?.isFileURL == true ? "file" : "remote"])
        transport.onUpdate = { [weak self, weak transport] update in
            guard let self, let transport, self.backend === transport, self.session == token, update.generation == self.generation else { return }
            if case .effects = update.event { return }
            self.emit(update.event)
        }
        transport.setRate(rate)
        transport.load(source: source, at: targetPosition, generation: generation)
        emit(.effects(systemEffectState))
        guard session == token else { return }
        if needsDownload { observeDownload(token: token) }
    }

    private var systemEffectState: AudioEffectState {
        effects.enabled ? .unavailable(fallbackReason ?? "Audio effects are unavailable with AVPlayer.") : .inactive
    }

    private func observeDownload(token: UUID) {
        guard session == token, needsDownloadForEffects, case .episode(let episode) = source else { return }
        withObservationTracking {
            _ = media.status(for: episode)
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in
                guard let self, self.session == token else { return }
                if !self.resumeEffectsFromDownload() { self.observeDownload(token: token) }
            }
        }
        _ = resumeEffectsFromDownload()
    }

    private func resumeEffectsFromDownload() -> Bool {
        guard needsDownloadForEffects, effects.enabled,
              let source, case .episode(let episode) = source,
              case .available = media.status(for: episode) else { return false }
        let position = self.position
        trace("route_download_promotion", values: ["position": position])
        let token = session
        emit(.playback(isPlaying: false))
        guard session == token else { return true }
        emit(.effects(.preparing))
        guard session == token else { return true }
        load(source: source, at: position, generation: generation)
        return true
    }

    private func retire(_ transport: (any PlaybackTransport)?, releasingLease: Bool) {
        transport?.shutdown()
        let native = transport as? LocalAudioTransport
        let retiringLease = releasingLease ? lease : nil
        if releasingLease { lease = nil }
        guard native != nil || retiringLease != nil else { return }
        let pendingRetirements = Array(retirements.values)
        let id = UUID()
        retirements[id] = Task { [weak self] in
            await native?.shutdownAndWait()
            for retirement in pendingRetirements { await retirement.value }
            await retiringLease?.release()
            self?.retirements[id] = nil
        }
    }

    private func emit(_ event: PlaybackTransportEvent) {
        switch event {
        case .ready(let duration): trace("route_ready", values: ["duration": duration])
        case .playback(let isPlaying): trace("route_playback", values: ["playing": isPlaying ? 1 : 0, "position": position])
        case .seeked(let position): trace("route_seeked", values: ["position": position])
        case .ended: trace("route_ended")
        case .failed: trace("route_failed")
        case .position(let position):
            if PlaybackTraceRecorder.shared.isRecording, PlaybackTraceRecorder.now - lastTraceSample >= 1 {
                lastTraceSample = PlaybackTraceRecorder.now
                trace("route_sample", values: ["position": position, "rate": rate, "boost": effects.volumeBoost ? 1 : 0, "trim": effects.trimSilence ? 1 : 0])
            }
        default: break
        }
        onUpdate?(PlaybackTransportUpdate(generation: generation, event: event))
    }

    private func trace(_ event: String, values: [String: Double] = [:], labels: [String: String] = [:]) {
        guard PlaybackTraceRecorder.shared.isRecording else { return }
        var values = values
        var context = ["session": session.uuidString, "generation": generation.uuidString]
        if case .episode(let episode) = source {
            if let id = episode.id { values["episodeId"] = Double(id) }
            if let id = episode.podcastId { values["podcastId"] = Double(id) }
            switch media.status(for: episode) {
            case .notDownloaded:
                context["downloadState"] = "notDownloaded"
            case .downloading(let received, let total):
                context["downloadState"] = "downloading"
                values["downloadReceivedBytes"] = Double(received)
                if let total { values["downloadTotalBytes"] = Double(total) }
            case .paused(let received, let total):
                context["downloadState"] = "paused"
                values["downloadReceivedBytes"] = Double(received)
                if let total { values["downloadTotalBytes"] = Double(total) }
            case .available(let bytes):
                context["downloadState"] = "available"
                values["downloadReceivedBytes"] = Double(bytes)
                values["downloadTotalBytes"] = Double(bytes)
            case .failed:
                context["downloadState"] = "failed"
            }
        }
        if let backend = activeBackend { context["backend"] = backend.rawValue }
        if let sourceID = lease?.byteSource.traceID { context["sourceId"] = sourceID.uuidString }
        context.merge(labels) { _, new in new }
        PlaybackTraceRecorder.shared.record(event, values: values, labels: context)
    }
}
