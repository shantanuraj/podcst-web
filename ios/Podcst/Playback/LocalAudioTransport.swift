import AVFoundation
import Foundation
import Darwin

struct LocalAudioConfiguration: Sendable {
    enum Output: Sendable {
        case device
        case offline(sampleRate: Double, channels: AVAudioChannelCount, maximumFrames: AVAudioFrameCount)
    }

    var output: Output = .device
    var blockFrames: AVAudioFrameCount = 1024
    var bufferCount: Int = 16
    var limiterEnabled = true
    var processingBlockDuration: TimeInterval? = 256 / 48_000
    var bufferedDuration: TimeInterval? = 0.4

    func validate() throws {
        guard (1...8192).contains(blockFrames), (2...16).contains(bufferCount),
              processingBlockDuration.map({ $0.isFinite && $0 > 0 && $0 <= 1 }) ?? true,
              bufferedDuration.map({ $0.isFinite && $0 > 0 && $0 <= 2 }) ?? true else { throw LocalAudioError.invalidConfiguration }
    }

    func processingFrames(at sampleRate: Double) -> AVAudioFrameCount {
        guard let processingBlockDuration else { return blockFrames }
        return min(blockFrames, AVAudioFrameCount(max(1, floor(sampleRate * processingBlockDuration))))
    }

    func bufferedFrames(at sampleRate: Double) -> UInt32 {
        let frames = blockFrames * UInt32(bufferCount)
        guard let bufferedDuration else { return frames }
        return max(frames, UInt32(ceil(sampleRate * bufferedDuration)))
    }
}

struct LocalAudioDiagnostics: Sendable {
    let sourceSampleRate: Double
    let outputSampleRate: Double
    let sourceFrameCount: AVAudioFramePosition
    let decodedThroughFrame: AVAudioFramePosition
    let consumedFrame: AVAudioFramePosition
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
        guard playing, let graph, let info else { return heldPosition }
        let content = presentedContentFrame(in: graph)
        let source = sourceFrame(at: content) / info.sampleRate
        let active = graph.branches[Int(graph.handoff.activeInput)]
        let scheduled = min(Double(starvationFrame ?? decodedThroughFrame), sourceFrame(at: Double(active.cursor))) / info.sampleRate
        let mapped = max(heldPosition, min(source, scheduled))
        return info.durationIsEstimated ? mapped : min(info.duration, mapped)
    }

    var diagnostics: LocalAudioDiagnostics {
        let frames = info.map { UInt64(configuration.bufferedFrames(at: $0.sampleRate)) } ?? 0
        return LocalAudioDiagnostics(
            sourceSampleRate: info?.sampleRate ?? 0,
            outputSampleRate: graph?.format.sampleRate ?? 0,
            sourceFrameCount: info?.frameCount ?? 0,
            decodedThroughFrame: decodedThroughFrame,
            consumedFrame: graph.map { consumedFrame(in: $0) } ?? 0,
            renderedFrames: graph?.limiter.renderedFrameCount ?? 0,
            limiterLatencyFrames: graph?.limiter.latencyFrames ?? 0,
            scheduledBuffers: graph?.branches.reduce(0) { $0 + Int(($1.source.availableFrames + configuration.blockFrames - 1) / configuration.blockFrames) } ?? 0,
            bufferCapacityFrames: frames,
            allocatedBytes: workerAllocatedBytes + UInt64(sourceSpans.count * MemoryLayout<AudioSourceSpan>.stride) + (graph?.allocatedBytes ?? 0) + (replay?.allocatedBytes ?? 0),
            underruns: underruns,
            isReady: ready,
            isPlaying: playing,
            reachedEnd: reachedEnd,
            failure: failure
        )
    }

    private let configuration: LocalAudioConfiguration
    private let decoder: AudioProcessingDecoder
    private var sourceURL: URL?
    private var graph: LocalAudioGraph?
    private var info: LocalAudioFileInfo?
    private var generation = UUID()
    private var graphGeneration = UUID()
    private var preparation: Task<Void, Never>?
    private var fillTask: Task<Void, Never>?
    private var ticker: Task<Void, Never>?
    private var observers: LocalAudioObservers?
    private var replay: AudioReplayWindow?
    private var transition: AudioRateTransition?
    private var decodedThroughFrame: AVAudioFramePosition = 0
    private var scheduledContentFrames: Int64 = 0
    private var sourceSpans: [AudioSourceSpan] = []
    private var effectBoundaries: [AppliedAudioEffects] = []
    private var presentedEffects: AppliedAudioEffects?
    private var effectsRevision: UInt64 = 0
    private var workerAllocatedBytes: UInt64 = 0
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
    private var rate: Double = 1
    private var effects = AudioEffects()
    private var underruns = 0
    private var hasStarted = false
    private var failure: LocalAudioError?
    private var inspectionEnabled = false
    private var inspectionEpoch = UUID()
    private var inspection: AudioInspectionStore?
    private var outputInspectionScratch: [Float] = []
    private var outputInspectionStartFrame: UInt64 = 0
    private var outputInspectionDroppedBaseline: UInt64 = 0

    init(configuration: LocalAudioConfiguration = LocalAudioConfiguration(), sourceDecoder: (any PCMDecoder)? = nil) {
        self.configuration = configuration
        decoder = AudioProcessingDecoder(
            source: sourceDecoder ?? LocalAudioDecoder(blockFrames: configuration.blockFrames, bufferCount: 2),
            blockFrames: configuration.blockFrames,
            bufferCount: configuration.bufferCount,
            outputBlockDuration: configuration.processingBlockDuration
        )
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

    func load(source: PlaybackSource, at position: TimeInterval, generation: UUID) {
        stop()
        self.generation = generation
        sourceURL = source.url
        prepare(at: position)
    }

    func play(atRate rate: Double) {
        guard hasSource, !reachedEnd, rate.isFinite, (0.5...2).contains(rate) else { return }
        wantsPlayback = true
        setRate(rate)
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
        self.rate = rate
        inspection?.record(AudioInspectionEvent(kind: .rate, sourceTime: position, value: rate))
        guard let graph else { return }
        if !hasStarted {
            graph.branches[0].rate = rate
            graph.branches[0].pitch.rate = Float(rate)
            graph.branches[0].pitch.bypass = abs(rate - 1) < 0.0001
        } else {
            beginRateTransition()
        }
    }

    func setEffects(_ effects: AudioEffects) {
        guard self.effects != effects else { return }
        self.effects = effects
        effectsRevision &+= 1
        inspection?.record(AudioInspectionEvent(kind: .requested, sourceTime: position, revision: effectsRevision, effects: effects))
        let revision = effectsRevision
        let token = graphGeneration
        emit(.effects(.preparing))
        Task { [weak self] in
            guard let self else { return }
            do { try await self.decoder.configure(effects, revision: revision) }
            catch { self.fail(.cannotDecode, token: token) }
        }
    }

    func configureInspection(enabled: Bool) {
        guard inspectionEnabled != enabled else { return }
        inspectionEnabled = enabled
        inspectionEpoch = UUID()
        inspection = enabled ? info.map { AudioInspectionStore(epoch: inspectionEpoch, sampleRate: $0.sampleRate) } : nil
        configureOutputInspection()
        let epoch = enabled ? inspectionEpoch : nil
        Task { [weak self] in
            guard let self, self.inspectionEnabled == enabled, !enabled || self.inspectionEpoch == epoch else { return }
            await self.decoder.configureInspection(epoch: epoch)
        }
    }

    func inspectionSnapshot() -> AudioInspectionSnapshot? {
        let dropped = graph?.limiter.droppedTelemetryFrames ?? outputInspectionDroppedBaseline
        return inspection?.snapshot(presentedSourceTime: position, outputTelemetryDroppedFrames: dropped >= outputInspectionDroppedBaseline ? dropped - outputInspectionDroppedBaseline : 0)
    }

    func takeOutputInspection() -> [AudioOutputInspectionPacket] {
        guard inspectionEnabled, let graph, !outputInspectionScratch.isEmpty else { return [] }
        let presentedFrame = AudioOutputInspectionPacket.presentedFrame(renderedFrames: graph.limiter.renderedFrameCount, presentationLatency: graph.limiterNode.outputPresentationLatency, sampleRate: graph.format.sampleRate)
        var packets: [AudioOutputInspectionPacket] = []
        for _ in 0..<16 {
            var info = PodcstOutputTelemetryInfo()
            let count = outputInspectionScratch.withUnsafeMutableBufferPointer {
                graph.limiter.copyTelemetryFrames($0.baseAddress!, capacity: UInt32($0.count / 2), throughOutputFrame: presentedFrame, info: &info)
            }
            guard count > 0 else { break }
            guard info.outputStartFrame >= outputInspectionStartFrame else { continue }
            packets.append(AudioOutputInspectionPacket(epoch: inspectionEpoch, interleavedSamples: Array(outputInspectionScratch.prefix(Int(count * info.channels))), outputStartFrame: info.outputStartFrame, channels: Int(info.channels), sampleRate: info.sampleRate, limiterReductionDB: info.limiterReductionDB))
        }
        return packets
    }

    func sourcePosition(forRenderedOutputFrame frame: UInt64) -> TimeInterval? {
        guard let graph, let info, frame <= graph.limiter.renderedFrameCount,
              Double(frame) >= latencyFrames(in: graph) else { return nil }
        return sourceFrame(at: presentedContentFrame(in: graph, renderedFrame: Double(frame))) / info.sampleRate
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
        workerAllocatedBytes = 0
        sourceSpans.removeAll(keepingCapacity: false)
        effectBoundaries.removeAll(keepingCapacity: false)
        presentedEffects = nil
        underruns = 0
        heldPosition = 0
        ready = false
        reachedEnd = false
        failure = nil
        inspection = nil
        outputInspectionScratch = []
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
            requestFill(token: token)
            await fillTask?.value
            if let failure { throw failure }
            guard graph != nil else { throw LocalAudioError.notReady }
            fillBranches(token: token)
            advanceRateTransition()
            if decoderEnded || starvationFrame != nil || (replay?.end ?? 0) >= requiredContentEnd() { return }
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
        inspectionEpoch = UUID()
        inspection = nil
        scheduledContentFrames = 0
        sourceSpans.removeAll(keepingCapacity: true)
        effectBoundaries.removeAll(keepingCapacity: true)
        presentedEffects = nil
        workerAllocatedBytes = 0
        ready = false
        reachedEnd = false
        failure = nil
        decoderEnded = false
        draining = false
        drainedAtOutputFrame = nil
        starvationFrame = nil
        starvationRecoveryOutputFrame = nil
        transition = nil
        hasStarted = false
        emit(.playback(isPlaying: false))
        guard graphGeneration == token, let sourceURL else { return }
        preparation = Task { [weak self] in
            guard let self else { return }
            await self.decoder.close(generation: oldGeneration)
            do {
                guard self.graphGeneration == token, !Task.isCancelled else { return }
                try self.configuration.validate()
                try await self.decoder.configure(self.effects, revision: self.effectsRevision)
                await self.decoder.configureInspection(epoch: self.inspectionEnabled ? self.inspectionEpoch : nil)
                guard self.graphGeneration == token, !Task.isCancelled else { return }
                let info = try await self.decoder.open(url: sourceURL, at: self.heldPosition, generation: token)
                guard self.graphGeneration == token, !Task.isCancelled else { return }
                self.info = info
                if self.inspectionEnabled {
                    self.inspection = AudioInspectionStore(epoch: self.inspectionEpoch, sampleRate: info.sampleRate, sourceStart: info.startFrame)
                    self.inspection?.record(AudioInspectionEvent(kind: .seek, sourceTime: Double(info.startFrame) / info.sampleRate))
                }
                self.heldPosition = Double(info.startFrame) / info.sampleRate
                self.decodedThroughFrame = info.startFrame
                let graph = try await LocalAudioGraph.make(info: info, configuration: self.configuration, rate: self.rate)
                guard self.graphGeneration == token, !Task.isCancelled else { graph.stop(); return }
                self.graph = graph
                self.configureOutputInspection()
                self.replay = AudioReplayWindow(channels: Int(info.channels), capacity: max(Int(info.sampleRate * 1.5), Int(self.configuration.blockFrames) * self.configuration.bufferCount * 4))
                self.configureObservers(graph: graph, token: token)
                self.requestFill(token: token)
                await self.fillTask?.value
                guard self.graphGeneration == token, !Task.isCancelled, self.failure == nil else { return }
                self.ready = true
                self.preparation = nil
                self.emit(.seeked(self.heldPosition))
                guard self.graphGeneration == token else { return }
                self.emit(.ready(duration: self.info?.durationIsEstimated == true ? 0 : self.info?.duration ?? info.duration))
                guard self.graphGeneration == token else { return }
                if self.wantsPlayback { self.startPlayback() }
            } catch {
                self.fail([MediaFailure.unsupportedMedia, .requiresCompleteFile].contains(error as? MediaFailure ?? .invalidResponse) ? .unsupportedFormat : error as? LocalAudioError ?? .cannotCreateGraph, token: token)
            }
        }
    }

    private func requestFill(token: UUID) {
        guard fillTask == nil, graphGeneration == token, graph != nil, !reachedEnd else { return }
        fillTask = Task { [weak self] in
            guard let self else { return }
            do {
                while !Task.isCancelled, self.graphGeneration == token,
                      self.starvationFrame == nil, !self.decoderEnded,
                      let replay = self.replay, replay.end < self.requiredContentEnd() {
                    let block = try await self.decoder.read(slot: 0, generation: token)
                    guard self.graphGeneration == token, !Task.isCancelled else { return }
                    if self.detectStarvation() {
                        await self.decoder.release(slot: 0, generation: token)
                        break
                    }
                    self.discardPresentedSpans()
                    try replay.append(block.lease.buffer)
                    self.append(block)
                    self.workerAllocatedBytes = block.allocatedBytes
                    if let end = block.fileEndFrame, let info = self.info, info.durationIsEstimated {
                        self.info = LocalAudioFileInfo(sampleRate: info.sampleRate, channels: info.channels, frameCount: end, startFrame: info.startFrame)
                        self.emit(.duration(Double(end) / info.sampleRate))
                        guard self.graphGeneration == token else { return }
                    }
                    self.decoderEnded = block.endOfFile
                    await self.decoder.release(slot: 0, generation: token)
                    guard self.graphGeneration == token, !Task.isCancelled else { return }
                    self.fillBranches(token: token)
                }
                guard self.graphGeneration == token else { return }
                self.fillTask = nil
                self.fillBranches(token: token)
                self.advanceRateTransition()
                if self.ready, self.wantsPlayback, !self.playing { self.startPlayback() }
            } catch {
                self.fail([MediaFailure.unsupportedMedia, .requiresCompleteFile].contains(error as? MediaFailure ?? .invalidResponse) ? .unsupportedFormat : error as? LocalAudioError ?? .cannotDecode, token: token)
            }
        }
    }

    private func requiredContentEnd() -> Int64 {
        guard let graph, let info else { return 0 }
        var target = presentedContentFrame(in: graph)
        let active = graph.branches[Int(graph.handoff.activeInput)]
        target += Double(bufferReserve(for: active, in: graph, info: info))
        target = max(target, Double(active.origin + consumedFrame(in: active) + pullReserve(for: active, in: graph, info: info)))
        if let transition {
            let incoming = graph.branches[transition.incoming]
            let gate = Double(graph.handoff.renderedFrameCount)
            let current = incoming.content(at: max(gate, transition.fadeFrame + Double(transition.fadeFrames)), sourceRate: info.sampleRate, graphRate: graph.pitchFormat.sampleRate)
            target = max(target, current + Double(bufferReserve(for: incoming, in: graph, info: info)), Double(incoming.origin + consumedFrame(in: incoming) + pullReserve(for: incoming, in: graph, info: info)))
        }
        return Int64(ceil(max(0, target)))
    }

    private func pullReserve(for branch: LocalAudioBranch, in graph: LocalAudioGraph, info: LocalAudioFileInfo) -> Int64 {
        let outputFrames: Double
        switch configuration.output {
        case .device: outputFrames = Double(graph.limiter.maximumFramesToRender)
        case .offline(_, _, let maximumFrames): outputFrames = Double(maximumFrames)
        }
        let inputFrames = (2048 / graph.pitchFormat.sampleRate + outputFrames / graph.format.sampleRate * branch.rate) * info.sampleRate
        return min(Int64(configuration.bufferedFrames(at: info.sampleRate)), Int64(ceil(inputFrames)))
    }

    private func bufferReserve(for branch: LocalAudioBranch, in graph: LocalAudioGraph, info: LocalAudioFileInfo) -> Int64 {
        let quantum = Double(graph.handoff.maximumFramesToRender)
        let inputFrames = (2048 * (1 + branch.rate) + quantum * branch.rate) / graph.pitchFormat.sampleRate * info.sampleRate
        let desired = max(inputFrames, info.sampleRate * branch.rate * 0.16)
        return min(Int64(configuration.bufferedFrames(at: info.sampleRate)), Int64(ceil(desired)))
    }

    private func fillBranches(token: UUID) {
        guard graphGeneration == token, let graph, let replay, let info, starvationFrame == nil else { return }
        let active = Int(graph.handoff.activeInput)
        for index in graph.branches.indices where index == active || transition?.incoming == index {
            let branch = graph.branches[index]
            while branch.source.freeFrames > 0 {
                let end = replay.end + (decoderEnded ? Int64(ceil(info.sampleRate * branch.rate * 0.25)) : 0)
                guard branch.cursor < end else { break }
                let frames = Int(min(Int64(branch.scratch.frameCapacity), end - branch.cursor, Int64(branch.source.freeFrames)))
                do { try replay.copy(from: branch.cursor, frames: frames, into: branch.scratch, padding: decoderEnded) }
                catch { fail(.cannotRender, token: token); return }
                guard branch.source.enqueueBuffer(branch.scratch) else { fail(.cannotRender, token: token); return }
                branch.cursor += Int64(frames)
            }
        }
    }

    private func append(_ block: ProcessedAudioBlock) {
        if let packet = block.inspection {
            inspection?.append(packet, spans: block.spans, fileEndFrame: block.fileEndFrame)
        }
        for span in block.spans {
            let next = AudioSourceSpan(sourceStart: span.sourceStart, outputStart: scheduledContentFrames + span.outputStart, frameCount: span.frameCount)
            if let last = sourceSpans.last, last.sourceStart + last.frameCount == next.sourceStart,
               last.outputStart + last.frameCount == next.outputStart {
                sourceSpans[sourceSpans.count - 1].frameCount += next.frameCount
            } else { sourceSpans.append(next) }
            decodedThroughFrame = next.sourceStart + next.frameCount
        }
        scheduledContentFrames += Int64(block.lease.buffer.frameLength)
        if block.applied.revision != (effectBoundaries.last ?? presentedEffects)?.revision {
            effectBoundaries.append(block.applied)
        }
    }

    private func sourceFrame(at outputFrame: Double) -> Double {
        guard let span = sourceSpans.last(where: { Double($0.outputStart) <= outputFrame }) else {
            return Double(info?.startFrame ?? 0)
        }
        return Double(span.sourceStart) + min(Double(span.frameCount), max(0, outputFrame - Double(span.outputStart)))
    }

    private func publishEffects() {
        guard let info else { return }
        let token = graphGeneration
        let sourceFrame = heldPosition * info.sampleRate
        while let boundary = effectBoundaries.first, Double(boundary.sourceFrame) <= sourceFrame {
            presentedEffects = boundary
            effectBoundaries.removeFirst()
            inspection?.record(AudioInspectionEvent(kind: .presented, sourceTime: Double(boundary.sourceFrame) / info.sampleRate, revision: boundary.revision, effects: boundary.effects))
            emit(.effects(.active(boundary.effects)))
            guard graphGeneration == token else { return }
        }
    }

    private func discardPresentedSpans() {
        guard let graph, let info, let replay else { return }
        let earliest = max(0, Int64(presentedContentFrame(in: graph) - info.sampleRate * 0.5))
        replay.discard(before: earliest)
        while sourceSpans.count > 1, sourceSpans[1].outputStart <= replay.start {
            sourceSpans.removeFirst()
        }
    }

    private func beginRateTransition() {
        guard ready, hasStarted, transition == nil, !draining, starvationFrame == nil,
              let graph, let info else { return }
        let active = Int(graph.handoff.activeInput)
        let old = graph.branches[active]
        guard abs(old.rate - rate) > 0.0001 else { return }
        let incoming = 1 - active
        let prime = Double(graph.handoff.renderedFrameCount) + Double(max(1024, graph.handoff.maximumFramesToRender))
        let fade = prime + ceil(graph.pitchFormat.sampleRate * 0.125)
        let content = old.content(at: fade, sourceRate: info.sampleRate, graphRate: graph.pitchFormat.sampleRate)
        let origin = Int64((content - (fade - prime) / graph.pitchFormat.sampleRate * info.sampleRate * rate).rounded())
        guard origin >= (replay?.start ?? 0) || origin < 0 && (replay?.start ?? 0) == 0 else { return }
        let branch = graph.branches[incoming]
        branch.reset(rate: rate, origin: origin, startFrame: prime)
        transition = AudioRateTransition(outgoing: active, incoming: incoming, previous: old.clock, next: branch.clock, fadeFrame: fade, fadeFrames: max(2, UInt32(graph.pitchFormat.sampleRate * 0.008)))
        fillBranches(token: graphGeneration)
        requestFill(token: graphGeneration)
    }

    private func advanceRateTransition() {
        guard let graph, let info else { return }
        guard var change = transition else { beginRateTransition(); return }
        let incoming = graph.branches[change.incoming]
        if !change.scheduled {
            if Double(graph.handoff.renderedFrameCount) >= incoming.startFrame - Double(graph.handoff.maximumFramesToRender) / 2 {
                incoming.retire()
                transition = nil
                beginRateTransition()
                return
            }
            let minimum = bufferReserve(for: incoming, in: graph, info: info)
            let coverage = incoming.content(at: change.fadeFrame + Double(change.fadeFrames), sourceRate: info.sampleRate, graphRate: graph.pitchFormat.sampleRate) + Double(minimum)
            guard decoderEnded || incoming.cursor - incoming.origin >= minimum && Double(replay?.end ?? 0) >= coverage else { return }
            guard graph.handoff.scheduleTransition(toInput: UInt32(change.incoming), primeFrame: UInt64(incoming.startFrame), fadeFrame: UInt64(change.fadeFrame), fadeFrames: change.fadeFrames) else {
                incoming.retire()
                transition = nil
                beginRateTransition()
                return
            }
            change.scheduled = true
            transition = change
        }
        guard !graph.handoff.transitionPending, Int(graph.handoff.activeInput) == change.incoming else { return }
        graph.branches[change.outgoing].retire()
        if audibleGateFrame(in: graph) >= change.fadeFrame + Double(change.fadeFrames) {
            transition = nil
            beginRateTransition()
        }
    }

    private func audibleGateFrame(in graph: LocalAudioGraph, renderedFrame: Double? = nil) -> Double {
        max(0, (renderedFrame ?? Double(graph.limiter.renderedFrameCount)) - latencyFrames(in: graph)) / graph.format.sampleRate * graph.pitchFormat.sampleRate
    }

    private func presentedContentFrame(in graph: LocalAudioGraph, renderedFrame: Double? = nil) -> Double {
        guard let info else { return 0 }
        let frame = audibleGateFrame(in: graph, renderedFrame: renderedFrame)
        if let transition, transition.scheduled {
            let old = transition.previous.content(at: frame, sourceRate: info.sampleRate, graphRate: graph.pitchFormat.sampleRate)
            let new = transition.next.content(at: frame, sourceRate: info.sampleRate, graphRate: graph.pitchFormat.sampleRate)
            let weight = min(1, max(0, (frame - transition.fadeFrame) / Double(transition.fadeFrames - 1)))
            return max(0, old * (1 - weight) + new * weight)
        }
        return max(0, graph.branches[Int(graph.handoff.activeInput)].content(at: frame, sourceRate: info.sampleRate, graphRate: graph.pitchFormat.sampleRate))
    }

    private func startPlayback() {
        guard ready, wantsPlayback, !playing, !reachedEnd, let graph else { return }
        let token = graphGeneration
        do {
            if !hasStarted {
                graph.branches[0].rate = rate
                graph.branches[0].pitch.rate = Float(rate)
                graph.branches[0].pitch.bypass = abs(rate - 1) < 0.0001
            }
            try graph.engine.start()
            hasStarted = true
            playing = true
            inspection?.record(AudioInspectionEvent(kind: .started, sourceTime: position))
            emit(.playback(isPlaying: true))
            guard graphGeneration == token, playing, wantsPlayback else { return }
            if !graph.offline { startTicker() }
        } catch {
            fail(.cannotStart, token: token)
        }
    }

    private func pauseGraph() {
        graph?.engine.pause()
        heldPosition = position
        playing = false
        inspection?.record(AudioInspectionEvent(kind: .paused, sourceTime: heldPosition))
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
        replay = nil
        transition = nil
        playing = false
    }

    private func startTicker() {
        ticker?.cancel()
        let token = graphGeneration
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(20))
                guard let self, self.graphGeneration == token, !Task.isCancelled else { return }
                self.publishPosition()
            }
        }
    }

    private func publishPosition() {
        guard let graph else { return }
        let token = graphGeneration
        if graph.limiter.renderFailureCount > 0 || graph.handoff.renderFailureCount > 0 || graph.branches.contains(where: { $0.source.renderFailureCount > 0 }) {
            fail(.cannotRender, token: token)
            return
        }
        _ = detectStarvation()
        guard graphGeneration == token else { return }
        heldPosition = position
        inspection?.advancePresentation(to: heldPosition)
        publishEffects()
        guard graphGeneration == token else { return }
        discardPresentedSpans()
        advanceRateTransition()
        requestFill(token: token)
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
        guard playing, let graph, let info else { return false }
        let active = graph.branches[Int(graph.handoff.activeInput)]
        guard !decoderEnded || active.cursor < scheduledContentFrames else { return false }
        guard active.source.underrunFrameCount > 0 else { return false }
        starvationFrame = Int64(sourceFrame(at: Double(active.cursor)))
        underruns += 1
        inspection?.record(AudioInspectionEvent(kind: .underrun, sourceTime: Double(starvationFrame ?? 0) / info.sampleRate, value: Double(underruns)))
        let end = active.startFrame + Double(active.cursor - active.origin) / info.sampleRate / active.rate * graph.pitchFormat.sampleRate
        starvationRecoveryOutputFrame = (end / graph.pitchFormat.sampleRate + 0.25) * graph.format.sampleRate + Double(graph.limiter.latencyFrames)
        emit(.playback(isPlaying: false))
        return true
    }

    private func finishOfflineIfNeeded() {
        advanceDrain()
    }

    private func advanceDrain() {
        guard let graph, let info, decoderEnded, transition == nil else { return }
        let branch = graph.branches[Int(graph.handoff.activeInput)]
        let end = branch.startFrame / graph.pitchFormat.sampleRate + Double(scheduledContentFrames - branch.origin) / info.sampleRate / branch.rate + 0.25
        let completion = end * graph.format.sampleRate + Double(graph.limiter.latencyFrames)
        let rendered = Double(graph.limiter.renderedFrameCount)
        if !draining, rendered >= completion {
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
        inspection?.record(AudioInspectionEvent(kind: .failed, sourceTime: position))
        graphGeneration = UUID()
        preparation?.cancel()
        ready = false
        wantsPlayback = false
        preparation = nil
        tearDownGraph()
        Task { await decoder.close(generation: token) }
        emit(.failed)
    }


    private func latencyFrames(in graph: LocalAudioGraph) -> Double {
        Double(graph.limiter.latencyFrames) + graph.limiterNode.outputPresentationLatency * graph.format.sampleRate
    }

    private func configureOutputInspection() {
        guard let graph else { return }
        outputInspectionStartFrame = graph.limiter.renderedFrameCount
        outputInspectionDroppedBaseline = graph.limiter.droppedTelemetryFrames
        graph.limiter.telemetryEnabled = inspectionEnabled
        outputInspectionScratch = inspectionEnabled ? [Float](repeating: 0, count: Int(graph.limiter.maximumFramesToRender) * 2) : []
    }

    private func consumedFrame(in graph: LocalAudioGraph) -> AVAudioFramePosition {
        let branch = graph.branches[Int(graph.handoff.activeInput)]
        return branch.origin + consumedFrame(in: branch)
    }

    private func consumedFrame(in branch: LocalAudioBranch) -> AVAudioFramePosition {
        Int64(branch.source.consumedFrameCount)
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

private struct AudioRateClock {
    let origin: Int64
    let startFrame: Double
    let rate: Double

    func content(at frame: Double, sourceRate: Double, graphRate: Double) -> Double {
        Double(origin) + max(0, frame - startFrame) / graphRate * sourceRate * rate
    }
}

private struct AudioRateTransition {
    let outgoing: Int
    let incoming: Int
    let previous: AudioRateClock
    let next: AudioRateClock
    let fadeFrame: Double
    let fadeFrames: UInt32
    var scheduled = false
}

@MainActor
private final class AudioReplayWindow {
    let channels: Int
    let capacity: Int
    private var samples: [[Float]]
    private(set) var start: Int64 = 0
    private(set) var end: Int64 = 0
    var allocatedBytes: UInt64 { UInt64(channels * capacity * MemoryLayout<Float>.stride) }

    init(channels: Int, capacity: Int) {
        self.channels = channels
        self.capacity = capacity
        samples = Array(repeating: [Float](repeating: 0, count: capacity), count: channels)
    }

    func append(_ buffer: AVAudioPCMBuffer) throws {
        let frames = Int(buffer.frameLength)
        guard end - start + Int64(frames) <= capacity, let data = buffer.floatChannelData else { throw LocalAudioError.cannotDecode }
        for channel in 0..<channels {
            for frame in 0..<frames { samples[channel][Int((end + Int64(frame)) % Int64(capacity))] = data[channel][frame] }
        }
        end += Int64(frames)
    }

    func copy(from first: Int64, frames: Int, into buffer: AVAudioPCMBuffer, padding: Bool) throws {
        guard frames <= buffer.frameCapacity, let output = buffer.floatChannelData,
              first >= start || first < 0 && start == 0,
              first + Int64(frames) <= end || padding else { throw LocalAudioError.cannotRender }
        for channel in 0..<channels {
            for frame in 0..<frames {
                let position = first + Int64(frame)
                output[channel][frame] = position < 0 || position >= end ? 0 : samples[channel][Int(position % Int64(capacity))]
            }
        }
        buffer.frameLength = AVAudioFrameCount(frames)
    }

    func discard(before frame: Int64) {
        start = min(end, max(start, frame))
    }
}

@MainActor
private final class LocalAudioBranch {
    let sourceNode: AVAudioUnit
    let source: PodcstPCMSourceAudioUnit
    let conversion = AVAudioMixerNode()
    let pitch = AVAudioUnitTimePitch()
    let scratch: AVAudioPCMBuffer
    var origin: Int64 = 0
    var cursor: Int64 = 0
    var startFrame: Double = 0
    var rate: Double
    var clock: AudioRateClock { AudioRateClock(origin: origin, startFrame: startFrame, rate: rate) }
    var allocatedBytes: UInt64 { source.allocatedBytes + UInt64(scratch.frameCapacity) * UInt64(scratch.format.channelCount) * 4 }

    init(node: AVAudioUnit, format: AVAudioFormat, configuration: LocalAudioConfiguration, rate: Double) throws {
        guard let source = node.auAudioUnit as? PodcstPCMSourceAudioUnit,
              let scratch = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: configuration.processingFrames(at: format.sampleRate)) else { throw LocalAudioError.cannotCreateGraph }
        try source.configureCapacityFrames(configuration.bufferedFrames(at: format.sampleRate))
        self.sourceNode = node
        self.source = source
        self.scratch = scratch
        self.rate = rate
        pitch.rate = Float(rate)
        pitch.bypass = abs(rate - 1) < 0.0001
    }

    func reset(rate: Double, origin: Int64, startFrame: Double) {
        retire()
        conversion.reset()
        pitch.reset()
        self.rate = rate
        self.origin = origin
        self.cursor = origin
        self.startFrame = startFrame
        pitch.rate = Float(rate)
        pitch.bypass = abs(rate - 1) < 0.0001
    }

    func retire() {
        source.reset()
    }

    func content(at frame: Double, sourceRate: Double, graphRate: Double) -> Double {
        clock.content(at: frame, sourceRate: sourceRate, graphRate: graphRate)
    }
}

@MainActor
private final class LocalAudioGraph {
    let engine: AVAudioEngine
    let branches: [LocalAudioBranch]
    let handoffNode: AVAudioUnit
    let handoff: PodcstHandoffAudioUnit
    let limiterNode: AVAudioUnit
    let limiter: PodcstLimiterAudioUnit
    let format: AVAudioFormat
    let pitchFormat: AVAudioFormat
    let offline: Bool
    var allocatedBytes: UInt64 { branches.reduce(limiter.allocatedBytes + handoff.allocatedBytes) { $0 + $1.allocatedBytes } }

    private init(engine: AVAudioEngine, branches: [LocalAudioBranch], handoffNode: AVAudioUnit, handoff: PodcstHandoffAudioUnit, limiterNode: AVAudioUnit, limiter: PodcstLimiterAudioUnit, format: AVAudioFormat, pitchFormat: AVAudioFormat, offline: Bool) {
        self.engine = engine
        self.branches = branches
        self.handoffNode = handoffNode
        self.handoff = handoff
        self.limiterNode = limiterNode
        self.limiter = limiter
        self.format = format
        self.pitchFormat = pitchFormat
        self.offline = offline
    }

    static func make(info: LocalAudioFileInfo, configuration: LocalAudioConfiguration, rate: Double) async throws -> LocalAudioGraph {
        let engine = AVAudioEngine()
        let format: AVAudioFormat
        let offline: Bool
        switch configuration.output {
        case .device:
            let hardware = engine.outputNode.inputFormat(forBus: 0)
            guard hardware.sampleRate.isFinite, hardware.sampleRate.rounded() == hardware.sampleRate, (8_000...192_000).contains(hardware.sampleRate), hardware.channelCount > 0,
                  let output = AVAudioFormat(standardFormatWithSampleRate: hardware.sampleRate, channels: min(2, hardware.channelCount)) else { throw LocalAudioError.unsupportedFormat }
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
        PodcstHandoffAudioUnit.register()
        PodcstPCMSourceAudioUnit.register()
        let limiterNode = try await instantiate(PodcstLimiterAudioUnit.componentDescription())
        let handoffNode = try await instantiate(PodcstHandoffAudioUnit.componentDescription())
        guard let limiter = limiterNode.auAudioUnit as? PodcstLimiterAudioUnit,
              let handoff = handoffNode.auAudioUnit as? PodcstHandoffAudioUnit,
              let sourceFormat = AVAudioFormat(standardFormatWithSampleRate: info.sampleRate, channels: info.channels),
              let pitchFormat = AVAudioFormat(standardFormatWithSampleRate: max(48_000, info.sampleRate, format.sampleRate), channels: format.channelCount) else { throw LocalAudioError.cannotCreateGraph }
        try limiter.configureLimiterEnabled(configuration.limiterEnabled)
        var branches: [LocalAudioBranch] = []
        for _ in 0..<2 {
            let node = try await instantiate(PodcstPCMSourceAudioUnit.componentDescription())
            branches.append(try LocalAudioBranch(node: node, format: sourceFormat, configuration: configuration, rate: rate))
        }
        engine.attach(limiterNode)
        engine.attach(handoffNode)
        for (index, branch) in branches.enumerated() {
            engine.attach(branch.sourceNode)
            engine.attach(branch.conversion)
            engine.attach(branch.pitch)
            engine.connect(branch.sourceNode, to: branch.conversion, format: sourceFormat)
            engine.connect(branch.conversion, to: branch.pitch, format: pitchFormat)
            engine.connect(branch.pitch, to: handoffNode, fromBus: 0, toBus: AVAudioNodeBus(index), format: pitchFormat)
        }
        engine.connect(handoffNode, to: engine.mainMixerNode, format: pitchFormat)
        engine.disconnectNodeOutput(engine.mainMixerNode)
        engine.connect(engine.mainMixerNode, to: limiterNode, format: format)
        engine.connect(limiterNode, to: engine.outputNode, format: format)
        engine.mainMixerNode.outputVolume = 1
        engine.prepare()
        return LocalAudioGraph(engine: engine, branches: branches, handoffNode: handoffNode, handoff: handoff, limiterNode: limiterNode, limiter: limiter, format: format, pitchFormat: pitchFormat, offline: offline)
    }

    private static func instantiate(_ description: AudioComponentDescription) async throws -> AVAudioUnit {
        try await withCheckedThrowingContinuation { continuation in
            AVAudioUnit.instantiate(with: description, options: []) { node, error in
                if let node { continuation.resume(returning: node) }
                else { continuation.resume(throwing: error ?? LocalAudioError.cannotCreateGraph) }
            }
        }
    }

    func stop() {
        engine.stop()
        for branch in branches { branch.retire() }
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
