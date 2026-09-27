import AVFoundation
import Foundation
import Darwin

struct LocalAudioConfiguration: Sendable {
    enum Output: Sendable {
        case device
        case offline(sampleRate: Double, channels: AVAudioChannelCount, maximumFrames: AVAudioFrameCount)
    }

    var output: Output = .device
    var blockFrames: AVAudioFrameCount = 2048
    var bufferCount: Int = 8
    var limiterEnabled = true
}

struct LocalAudioDiagnostics: Sendable {
    let sourceSampleRate: Double
    let outputSampleRate: Double
    let sourceFrameCount: AVAudioFramePosition
    let decodedThroughFrame: AVAudioFramePosition
    let playerFrame: AVAudioFramePosition
    let renderedFrames: UInt64
    let limiterLatencyFrames: UInt32
    let scheduledBuffers: Int
    let bufferCapacityFrames: UInt64
    let allocatedBytes: UInt64
    let underruns: Int
    let isReady: Bool
    let isPlaying: Bool
    let reachedEnd: Bool
    let failure: LocalAudioError?
}

@MainActor
final class LocalAudioTransport: PlaybackTransport {
    var onUpdate: (@MainActor (PlaybackTransportUpdate) -> Void)?
    var hasSource: Bool { sourceURL != nil }
    var position: TimeInterval {
        guard let graph, let info, resolveOutputOrigin(in: graph) else { return heldPosition }
        let audible = max(0, Double(graph.limiter.renderedFrameCount) - outputOrigin - latencyFrames(in: graph))
        let source = Double(info.startFrame) / info.sampleRate + audible / graph.format.sampleRate * rate
        return min(info.duration, max(heldPosition, min(source, Double(decodedThroughFrame) / info.sampleRate)))
    }

    var diagnostics: LocalAudioDiagnostics {
        let frames = info == nil ? 0 : UInt64(configuration.blockFrames) * UInt64(configuration.bufferCount)
        return LocalAudioDiagnostics(
            sourceSampleRate: info?.sampleRate ?? 0,
            outputSampleRate: graph?.format.sampleRate ?? 0,
            sourceFrameCount: info?.frameCount ?? 0,
            decodedThroughFrame: decodedThroughFrame,
            playerFrame: graph.map { playerFrame(in: $0) } ?? 0,
            renderedFrames: graph?.limiter.renderedFrameCount ?? 0,
            limiterLatencyFrames: graph?.limiter.latencyFrames ?? 0,
            scheduledBuffers: occupiedSlots.count,
            bufferCapacityFrames: frames,
            allocatedBytes: frames * UInt64(info?.channels ?? 0) * 4 + (graph?.limiter.allocatedBytes ?? 0),
            underruns: underruns,
            isReady: ready,
            isPlaying: playing,
            reachedEnd: reachedEnd,
            failure: failure
        )
    }

    private let configuration: LocalAudioConfiguration
    private let decoder: LocalAudioDecoder
    private var sourceURL: URL?
    private var graph: LocalAudioGraph?
    private var info: LocalAudioFileInfo?
    private var generation = UUID()
    private var graphGeneration = UUID()
    private var preparation: Task<Void, Never>?
    private var fillTask: Task<Void, Never>?
    private var ticker: Task<Void, Never>?
    private var observers: LocalAudioObservers?
    private var occupiedSlots: Set<Int> = []
    private var decodedThroughFrame: AVAudioFramePosition = 0
    private var paddingRemaining: AVAudioFramePosition = 0
    private var completionOutputFrame: Double?
    private var decoderEnded = false
    private var draining = false
    private var drainedAtOutputFrame: Double?
    private var starvationFrame: AVAudioFramePosition?
    private var starvationRecoveryOutputFrame: Double?
    private var ready = false
    private var playing = false
    private var wantsPlayback = false
    private var reachedEnd = false
    private var heldPosition: TimeInterval = 0
    private var outputOrigin: Double = 0
    private var rate: Double = 1
    private var underruns = 0
    private var scheduledStartHostTime: UInt64?
    private var needsReprime = false
    private var bufferWaiters: [CheckedContinuation<Void, Never>] = []
    private var failure: LocalAudioError?

    init(configuration: LocalAudioConfiguration = LocalAudioConfiguration()) {
        self.configuration = configuration
        decoder = LocalAudioDecoder(blockFrames: configuration.blockFrames, bufferCount: configuration.bufferCount)
    }

    deinit {
        preparation?.cancel()
        fillTask?.cancel()
        ticker?.cancel()
        let graph = graph
        let decoder = decoder
        let token = graphGeneration
        Task { @MainActor in
            graph?.stop()
            await decoder.close(generation: token)
        }
    }

    func load(url: URL, at position: TimeInterval, generation: UUID) {
        stop()
        self.generation = generation
        sourceURL = url
        prepare(at: position)
    }

    func play(atRate rate: Double) {
        guard hasSource, !reachedEnd, rate.isFinite, (0.5...2).contains(rate) else { return }
        wantsPlayback = true
        if abs(self.rate - rate) > 0.0001 {
            let sourcePosition = position
            self.rate = rate
            prepare(at: sourcePosition)
            return
        }
        startPlayback()
    }

    func pause() {
        wantsPlayback = false
        pauseGraph()
    }

    func seek(to position: TimeInterval, generation: UUID) {
        guard hasSource else { return }
        self.generation = generation
        prepare(at: position)
    }

    func setRate(_ rate: Double) {
        guard rate.isFinite, (0.5...2).contains(rate), abs(self.rate - rate) > 0.0001 else { return }
        let sourcePosition = position
        self.rate = rate
        if hasSource { prepare(at: sourcePosition) }
    }

    func stop() {
        let oldGeneration = graphGeneration
        graphGeneration = UUID()
        generation = UUID()
        wantsPlayback = false
        preparation?.cancel()
        preparation = nil
        tearDownGraph()
        sourceURL = nil
        info = nil
        underruns = 0
        heldPosition = 0
        ready = false
        reachedEnd = false
        failure = nil
        Task { await decoder.close(generation: oldGeneration) }
    }

    func shutdown() {
        onUpdate = nil
        stop()
    }

    func waitUntilReady() async throws {
        while let preparation {
            await preparation.value
            if self.preparation == nil { break }
        }
        if let failure { throw failure }
        guard ready else { throw LocalAudioError.notReady }
    }

    func waitForDecodedBuffers() async throws {
        let token = graphGeneration
        while graphGeneration == token {
            await fillTask?.value
            if let failure { throw failure }
            guard let graph, let info else { throw LocalAudioError.notReady }
            let queued = decodedThroughFrame - info.startFrame - playerFrame(in: graph)
            let reserve = AVAudioFramePosition(configuration.blockFrames) * AVAudioFramePosition(max(1, configuration.bufferCount / 2))
            if decoderEnded || starvationFrame != nil || queued >= reserve { return }
            await withCheckedContinuation { bufferWaiters.append($0) }
        }
        throw LocalAudioError.cancelled
    }

    func renderOffline(frames: AVAudioFrameCount, into buffer: AVAudioPCMBuffer, awaitingDecodedBuffers: Bool = true) async throws -> AVAudioEngineManualRenderingStatus {
        try await waitUntilReady()
        guard playing else { throw LocalAudioError.notReady }
        if awaitingDecodedBuffers { try await waitForDecodedBuffers() }
        guard case .offline(_, _, let maximumFrames) = configuration.output,
              let graph, frames > 0, frames <= maximumFrames,
              frames <= buffer.frameCapacity, buffer.format == graph.format,
              playing else { throw LocalAudioError.notReady }
        let token = graphGeneration
        let status: AVAudioEngineManualRenderingStatus
        do {
            status = try graph.engine.renderOffline(frames, to: buffer)
        } catch {
            fail(.cannotRender, token: token)
            throw LocalAudioError.cannotRender
        }
        await Task.yield()
        guard graphGeneration == token else { throw LocalAudioError.cancelled }
        publishPosition()
        await fillTask?.value
        finishOfflineIfNeeded()
        return status
    }

    private func prepare(at position: TimeInterval) {
        preparation?.cancel()
        let oldGeneration = graphGeneration
        graphGeneration = UUID()
        let token = graphGeneration
        tearDownGraph()
        heldPosition = position.isFinite ? max(0, position) : 0
        ready = false
        reachedEnd = false
        failure = nil
        decoderEnded = false
        draining = false
        drainedAtOutputFrame = nil
        starvationFrame = nil
        starvationRecoveryOutputFrame = nil
        paddingRemaining = 0
        completionOutputFrame = nil
        outputOrigin = 0
        scheduledStartHostTime = nil
        needsReprime = false
        emit(.playback(isPlaying: false))
        guard graphGeneration == token, let sourceURL else { return }
        preparation = Task { [weak self] in
            guard let self else { return }
            await self.decoder.close(generation: oldGeneration)
            do {
                let info = try await self.decoder.open(url: sourceURL, at: self.heldPosition, generation: token)
                guard self.graphGeneration == token, !Task.isCancelled else { return }
                self.info = info
                self.heldPosition = Double(info.startFrame) / info.sampleRate
                self.decodedThroughFrame = info.startFrame
                let graph = try await LocalAudioGraph.make(info: info, configuration: self.configuration, rate: self.rate)
                guard self.graphGeneration == token, !Task.isCancelled else { graph.stop(); return }
                self.graph = graph
                self.configureObservers(graph: graph, token: token)
                self.requestFill(token: token)
                await self.fillTask?.value
                guard self.graphGeneration == token, !Task.isCancelled, self.failure == nil else { return }
                self.ready = true
                self.preparation = nil
                self.emit(.seeked(self.heldPosition))
                guard self.graphGeneration == token else { return }
                self.emit(.ready(duration: info.duration))
                guard self.graphGeneration == token else { return }
                if self.wantsPlayback { self.startPlayback() }
            } catch {
                self.fail(error as? LocalAudioError ?? .cannotCreateGraph, token: token)
            }
        }
    }

    private func requestFill(token: UUID) {
        guard fillTask == nil, graphGeneration == token, graph != nil, !reachedEnd else { return }
        fillTask = Task { [weak self] in
            guard let self else { return }
            do {
                while !Task.isCancelled, self.graphGeneration == token,
                      self.starvationFrame == nil,
                      let slot = (0..<self.configuration.bufferCount).first(where: { !self.occupiedSlots.contains($0) }) {
                    if self.decoderEnded {
                        guard self.paddingRemaining > 0 else { break }
                        let frames = AVAudioFrameCount(min(AVAudioFramePosition(self.configuration.blockFrames), self.paddingRemaining))
                        let lease = try await self.decoder.silence(slot: slot, frames: frames, generation: token)
                        guard self.graphGeneration == token, !Task.isCancelled else { return }
                        self.paddingRemaining -= AVAudioFramePosition(frames)
                        self.schedule(lease, token: token)
                    } else {
                        let block = try await self.decoder.read(slot: slot, generation: token)
                        guard self.graphGeneration == token, !Task.isCancelled else { return }
                        if self.detectStarvation() {
                            await self.decoder.release(slot: slot, generation: token)
                            break
                        }
                        self.decodedThroughFrame = block.sourceStart + AVAudioFramePosition(block.lease.buffer.frameLength)
                        if block.endOfFile { self.beginEndPadding() }
                        if block.lease.buffer.frameLength > 0 {
                            self.schedule(block.lease, token: token)
                        } else {
                            await self.decoder.release(slot: slot, generation: token)
                        }
                    }
                }
                guard self.graphGeneration == token else { return }
                self.fillTask = nil
                self.signalBufferChange()
                if self.ready, self.wantsPlayback, !self.playing { self.startPlayback() }
            } catch {
                self.fail(error as? LocalAudioError ?? .cannotDecode, token: token)
            }
        }
    }

    private func beginEndPadding() {
        guard !decoderEnded, let info, let graph else { return }
        decoderEnded = true
        paddingRemaining = AVAudioFramePosition(ceil(info.sampleRate * rate * 0.25))
        let sourceFrames = Double(decodedThroughFrame - info.startFrame + paddingRemaining)
        completionOutputFrame = ceil(sourceFrames / info.sampleRate / rate * graph.format.sampleRate) + Double(graph.limiter.latencyFrames)
    }

    private func schedule(_ lease: LocalAudioBufferLease, token: UUID) {
        guard let graph else { return }
        occupiedSlots.insert(lease.slot)
        signalBufferChange()
        graph.player.scheduleBuffer(lease.buffer, completionCallbackType: .dataConsumed) { [weak self, lease] _ in
            Task { @MainActor [weak self, lease] in
                guard let self, self.graphGeneration == token else { return }
                await self.decoder.release(slot: lease.slot, generation: token)
                guard self.graphGeneration == token else { return }
                self.occupiedSlots.remove(lease.slot)
                self.requestFill(token: token)
            }
        }
    }

    private func startPlayback() {
        guard ready, wantsPlayback, !playing, !reachedEnd, let graph else { return }
        if needsReprime {
            prepare(at: heldPosition)
            return
        }
        let token = graphGeneration
        do {
            try graph.engine.start()
            if graph.offline {
                graph.player.play()
            } else {
                let host = mach_absolute_time() + AVAudioTime.hostTime(forSeconds: 0.05)
                scheduledStartHostTime = host
                graph.player.play(at: AVAudioTime(hostTime: host))
            }
            playing = true
            emit(.playback(isPlaying: true))
            guard graphGeneration == token, playing, wantsPlayback else { return }
            if !graph.offline { startTicker() }
        } catch {
            fail(.cannotStart, token: token)
        }
    }

    private func pauseGraph() {
        if playing { needsReprime = true }
        heldPosition = position
        graph?.player.pause()
        graph?.engine.pause()
        playing = false
        ticker?.cancel()
        ticker = nil
        emit(.playback(isPlaying: false))
    }

    private func tearDownGraph() {
        fillTask?.cancel()
        fillTask = nil
        ticker?.cancel()
        ticker = nil
        observers = nil
        graph?.stop()
        graph = nil
        occupiedSlots.removeAll(keepingCapacity: true)
        playing = false
        signalBufferChange()
    }

    private func startTicker() {
        ticker?.cancel()
        let token = graphGeneration
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(100))
                guard let self, self.graphGeneration == token, !Task.isCancelled else { return }
                self.publishPosition()
            }
        }
    }

    private func publishPosition() {
        guard let graph else { return }
        let token = graphGeneration
        if graph.limiter.renderFailureCount > 0 {
            fail(.cannotRender, token: token)
            return
        }
        guard resolveOutputOrigin(in: graph) else { return }
        _ = detectStarvation()
        guard graphGeneration == token else { return }
        heldPosition = position
        emit(.position(heldPosition))
        guard graphGeneration == token else { return }
        if let starvationRecoveryOutputFrame,
           Double(graph.limiter.renderedFrameCount) >= starvationRecoveryOutputFrame,
           let starvationFrame, let info {
            prepare(at: Double(starvationFrame) / info.sampleRate)
            return
        }
        advanceDrain()
    }

    private func detectStarvation() -> Bool {
        if starvationFrame != nil { return true }
        guard playing, !decoderEnded, let graph, let info,
              playerFrame(in: graph) > decodedThroughFrame - info.startFrame else { return false }
        starvationFrame = decodedThroughFrame
        underruns += 1
        let contentSeconds = Double(decodedThroughFrame - info.startFrame) / info.sampleRate / rate
        starvationRecoveryOutputFrame = outputOrigin + (contentSeconds + 0.25) * graph.format.sampleRate + Double(graph.limiter.latencyFrames)
        emit(.playback(isPlaying: false))
        return true
    }

    private func finishOfflineIfNeeded() {
        advanceDrain()
    }

    private func advanceDrain() {
        guard let graph, decoderEnded, paddingRemaining == 0, let completionOutputFrame else { return }
        let rendered = Double(graph.limiter.renderedFrameCount)
        if !draining, rendered >= completionOutputFrame + outputOrigin {
            draining = true
            graph.limiter.beginDraining()
        }
        guard draining, graph.limiter.isDrained else { return }
        if drainedAtOutputFrame == nil { drainedAtOutputFrame = rendered }
        if let drainedAtOutputFrame,
           rendered >= drainedAtOutputFrame + graph.limiterNode.outputPresentationLatency * graph.format.sampleRate {
            finish(token: graphGeneration)
        }
    }

    private func finish(token: UUID) {
        guard graphGeneration == token, !reachedEnd, decoderEnded else { return }
        reachedEnd = true
        heldPosition = info?.duration ?? heldPosition
        graph?.player.pause()
        graph?.engine.pause()
        playing = false
        ticker?.cancel()
        ticker = nil
        emit(.position(heldPosition))
        guard graphGeneration == token else { return }
        emit(.ended)
    }

    private func fail(_ error: LocalAudioError, token: UUID) {
        guard graphGeneration == token, error != .cancelled else { return }
        failure = error
        graphGeneration = UUID()
        preparation?.cancel()
        ready = false
        wantsPlayback = false
        preparation = nil
        tearDownGraph()
        Task { await decoder.close(generation: token) }
        emit(.failed)
    }

    private func signalBufferChange() {
        let waiters = bufferWaiters
        bufferWaiters.removeAll(keepingCapacity: true)
        for waiter in waiters { waiter.resume() }
    }

    private func resolveOutputOrigin(in graph: LocalAudioGraph) -> Bool {
        guard let scheduledStartHostTime else { return true }
        let first = graph.limiter.firstRenderHostTime
        guard first > 0 else { return false }
        outputOrigin = Double(graph.limiter.firstRenderHostFrameOffset) + AVAudioTime.seconds(forHostTime: scheduledStartHostTime - min(first, scheduledStartHostTime)) * graph.format.sampleRate
        return true
    }

    private func latencyFrames(in graph: LocalAudioGraph) -> Double {
        Double(graph.limiter.latencyFrames) + graph.limiterNode.outputPresentationLatency * graph.format.sampleRate
    }

    private func playerFrame(in graph: LocalAudioGraph) -> AVAudioFramePosition {
        guard let time = graph.player.lastRenderTime, time.isSampleTimeValid,
              let playerTime = graph.player.playerTime(forNodeTime: time), playerTime.isSampleTimeValid else { return 0 }
        return playerTime.sampleTime
    }

    private func configureObservers(graph: LocalAudioGraph, token: UUID) {
        guard !graph.offline else { return }
        let observers = LocalAudioObservers()
        self.observers = observers
        observers.configuration = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: graph.engine, queue: nil) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.graphGeneration == token else { return }
                self.prepare(at: self.position)
            }
        }
        observers.reset = NotificationCenter.default.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: nil) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.graphGeneration == token else { return }
                let position = self.position
                self.wantsPlayback = false
                self.emit(.failed)
                guard self.graphGeneration == token else { return }
                self.prepare(at: position)
            }
        }
    }

    private func emit(_ event: PlaybackTransportEvent) {
        onUpdate?(PlaybackTransportUpdate(generation: generation, event: event))
    }
}

@MainActor
private final class LocalAudioGraph {
    let engine: AVAudioEngine
    let player: AVAudioPlayerNode
    let pitch: AVAudioUnitTimePitch
    let limiterNode: AVAudioUnit
    let limiter: PodcstLimiterAudioUnit
    let format: AVAudioFormat
    let offline: Bool

    private init(engine: AVAudioEngine, player: AVAudioPlayerNode, pitch: AVAudioUnitTimePitch, limiterNode: AVAudioUnit, limiter: PodcstLimiterAudioUnit, format: AVAudioFormat, offline: Bool) {
        self.engine = engine
        self.player = player
        self.pitch = pitch
        self.limiterNode = limiterNode
        self.limiter = limiter
        self.format = format
        self.offline = offline
    }

    static func make(info: LocalAudioFileInfo, configuration: LocalAudioConfiguration, rate: Double) async throws -> LocalAudioGraph {
        let engine = AVAudioEngine()
        let format: AVAudioFormat
        let offline: Bool
        switch configuration.output {
        case .device:
            let hardware = engine.outputNode.inputFormat(forBus: 0)
            guard hardware.sampleRate.isFinite, hardware.sampleRate.rounded() == hardware.sampleRate, (8_000...192_000).contains(hardware.sampleRate), hardware.channelCount > 0, let output = AVAudioFormat(standardFormatWithSampleRate: hardware.sampleRate, channels: min(2, hardware.channelCount)), output.channelCount > 0 else { throw LocalAudioError.unsupportedFormat }
            format = output
            offline = false
        case .offline(let sampleRate, let channels, let maximumFrames):
            guard sampleRate.isFinite, sampleRate.rounded() == sampleRate, (8_000...192_000).contains(sampleRate), (1...2).contains(channels), maximumFrames > 0, maximumFrames <= 8192,
                  let output = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: channels) else { throw LocalAudioError.invalidConfiguration }
            try engine.enableManualRenderingMode(.offline, format: output, maximumFrameCount: maximumFrames)
            format = output
            offline = true
        }
        PodcstLimiterAudioUnit.register()
        let limiterNode: AVAudioUnit = try await withCheckedThrowingContinuation { continuation in
            AVAudioUnit.instantiate(with: PodcstLimiterAudioUnit.componentDescription(), options: []) { node, error in
                if let node { continuation.resume(returning: node) }
                else { continuation.resume(throwing: error ?? LocalAudioError.cannotCreateGraph) }
            }
        }
        guard let limiter = limiterNode.auAudioUnit as? PodcstLimiterAudioUnit,
              let sourceFormat = AVAudioFormat(standardFormatWithSampleRate: info.sampleRate, channels: info.channels) else { throw LocalAudioError.cannotCreateGraph }
        try limiter.configureLimiterEnabled(configuration.limiterEnabled)
        let player = AVAudioPlayerNode()
        let pitch = AVAudioUnitTimePitch()
        pitch.rate = Float(rate)
        pitch.bypass = abs(rate - 1) < 0.0001
        engine.attach(player)
        engine.attach(pitch)
        engine.attach(limiterNode)
        engine.connect(player, to: pitch, format: sourceFormat)
        engine.connect(pitch, to: engine.mainMixerNode, format: sourceFormat)
        engine.disconnectNodeOutput(engine.mainMixerNode)
        engine.connect(engine.mainMixerNode, to: limiterNode, format: format)
        engine.connect(limiterNode, to: engine.outputNode, format: format)
        engine.mainMixerNode.outputVolume = 1
        engine.prepare()
        return LocalAudioGraph(engine: engine, player: player, pitch: pitch, limiterNode: limiterNode, limiter: limiter, format: format, offline: offline)
    }

    func stop() {
        engine.stop()
        player.stop()
    }
}

private final class LocalAudioObservers {
    var configuration: NSObjectProtocol?
    var reset: NSObjectProtocol?

    deinit {
        if let configuration { NotificationCenter.default.removeObserver(configuration) }
        if let reset { NotificationCenter.default.removeObserver(reset) }
    }
}
