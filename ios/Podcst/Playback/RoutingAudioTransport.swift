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

    init(media: MediaStore, preferSystemPlayback: Bool = false) {
        self.media = media
        self.preferSystemPlayback = preferSystemPlayback
    }

    func configureInspection(enabled: Bool) {
        inspectionEnabled = enabled
        (backend as? LocalAudioTransport)?.configureInspection(enabled: enabled)
    }

    func inspectionSnapshot() -> AudioInspectionSnapshot? {
        (backend as? LocalAudioTransport)?.inspectionSnapshot()
    }

    var activeInspectionEpoch: UUID? { (backend as? LocalAudioTransport)?.activeInspectionEpoch }

    func takeOutputInspection() -> [AudioOutputInspectionPacket] {
        (backend as? LocalAudioTransport)?.takeOutputInspection() ?? []
    }

    func load(source: PlaybackSource, at position: TimeInterval, generation: UUID) {
        guard !releasing else { return }
        stop()
        self.source = source
        self.generation = generation
        targetPosition = position
        let token = session
        preparation = Task { [weak self] in
            guard let self, self.session == token, !Task.isCancelled else { return }
            guard let url = source.url else { self.emit(.failed); return }
            do {
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
        backend?.play(atRate: rate)
    }

    func pause() { backend?.pause() }

    func seek(to position: TimeInterval, generation: UUID) {
        targetPosition = position
        self.generation = generation
        if let backend { backend.seek(to: position, generation: generation) }
        else if let source { load(source: source, at: position, generation: generation) }
    }

    func setRate(_ rate: Double) {
        self.rate = rate
        backend?.setRate(rate)
    }

    func setEffects(_ effects: AudioEffects) {
        self.effects = effects
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
        backend?.shutdown()
        backend = nil
        source = nil
        fallbackReason = nil
        needsDownloadForEffects = false
        targetPosition = 0
        releaseLease()
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
        transport.onUpdate = { [weak self, weak transport] update in
            guard let self, let transport, self.backend === transport, self.session == token, update.generation == self.generation else { return }
            if case .failed = update.event, transport.diagnostics.failure == .unsupportedFormat {
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
        backend?.shutdown()
        let transport = AVPlayerTransport()
        backend = transport
        fallbackReason = reason
        needsDownloadForEffects = needsDownload
        transport.onUpdate = { [weak self, weak transport] update in
            guard let self, let transport, self.backend === transport, self.session == token, update.generation == self.generation else { return }
            if case .effects = update.event { return }
            self.emit(update.event)
        }
        transport.setRate(rate)
        transport.load(source: source, at: targetPosition, generation: generation)
        emit(.effects(systemEffectState))
        guard session == token else { return }
        if source.url?.isFileURL != true { releaseLease() }
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
        let token = session
        emit(.playback(isPlaying: false))
        guard session == token else { return true }
        emit(.effects(.preparing))
        guard session == token else { return true }
        load(source: source, at: position, generation: generation)
        return true
    }

    private func releaseLease() {
        guard let lease else { return }
        self.lease = nil
        let id = UUID()
        retirements[id] = Task { [weak self] in
            await lease.release()
            self?.retirements[id] = nil
        }
    }

    private func emit(_ event: PlaybackTransportEvent) {
        onUpdate?(PlaybackTransportUpdate(generation: generation, event: event))
    }
}
