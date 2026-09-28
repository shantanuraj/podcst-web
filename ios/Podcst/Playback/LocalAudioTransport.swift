import AVFoundation
import Foundation

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
    var hasSource: Bool { snapshot.hasSource }
    var position: TimeInterval { snapshot.position }
    var diagnostics: LocalAudioDiagnostics { snapshot.diagnostics }
    var activeInspectionEpoch: UUID? { snapshot.inspectionEpoch }

    private let mailbox: LocalAudioMailbox
    private let worker: LocalAudioWorker
    private var pendingCommand: Task<Void, Never>?
    private var commandRevision: UInt64 = 0
    private var isShutdown = false
    private var placeholder = LocalAudioSnapshot.empty(generation: UUID())
    private var delivery: LocalAudioSnapshot?

    private var snapshot: LocalAudioSnapshot {
        if let delivery, delivery.generation == placeholder.generation { return delivery }
        if let latest = mailbox.snapshot, latest.generation == placeholder.generation { return latest }
        return placeholder
    }

    init(configuration: LocalAudioConfiguration = LocalAudioConfiguration(), sourceDecoder: (any PCMDecoder)? = nil) {
        let mailbox = LocalAudioMailbox()
        self.mailbox = mailbox
        worker = LocalAudioWorker(configuration: configuration, sourceDecoder: sourceDecoder, mailbox: mailbox)
        mailbox.setNotification { [weak self] in
            Task { @MainActor [weak self] in self?.deliverUpdates() }
        }
    }

    deinit {
        let pending = pendingCommand
        let worker = worker
        Task { @LocalAudioActor in
            await pending?.value
            await worker.shutdown()
        }
    }

    func load(source: PlaybackSource, at position: TimeInterval, generation: UUID) {
        guard !isShutdown else { return }
        placeholder = .empty(generation: generation, hasSource: source.url != nil, position: position.isFinite ? max(0, position) : 0)
        enqueue { $0.load(source: source, at: position, generation: generation) }
    }

    func play(atRate rate: Double) {
        guard !isShutdown else { return }
        enqueue { $0.play(atRate: rate) }
    }

    func pause() {
        guard !isShutdown else { return }
        enqueue { $0.pause() }
    }

    func seek(to position: TimeInterval, generation: UUID) {
        guard !isShutdown, hasSource else { return }
        placeholder = .empty(generation: generation, hasSource: true, position: position.isFinite ? max(0, position) : 0)
        enqueue { $0.seek(to: position, generation: generation) }
    }

    func setRate(_ rate: Double) {
        guard !isShutdown else { return }
        enqueue { $0.setRate(rate) }
    }

    func setEffects(_ effects: AudioEffects) {
        guard !isShutdown else { return }
        enqueue { $0.setEffects(effects) }
    }

    func configureInspection(enabled: Bool) {
        guard !isShutdown else { return }
        enqueue { $0.configureInspection(enabled: enabled) }
    }

    func inspectionSnapshot() async -> AudioInspectionSnapshot? {
        await waitForCommands()
        return await worker.inspectionSnapshot()
    }

    func takeOutputInspection(epoch: UUID) async -> [AudioOutputInspectionPacket] {
        await waitForCommands()
        return await worker.takeOutputInspection(epoch: epoch)
    }

    func sourcePosition(forRenderedOutputFrame frame: UInt64) -> TimeInterval? {
        snapshot.timeline?.sourcePosition(forRenderedOutputFrame: frame)
    }

    func stop() {
        guard !isShutdown else { return }
        placeholder = .empty(generation: UUID())
        enqueue { $0.stop() }
    }

    func shutdown() {
        guard !isShutdown else { return }
        isShutdown = true
        onUpdate = nil
        placeholder = .empty(generation: UUID())
        enqueue { await $0.shutdown() }
    }

    func shutdownAndWait() async {
        shutdown()
        await pendingCommand?.value
        deliverUpdates()
    }

    func waitUntilReady() async throws {
        while true {
            await waitForCommands()
            let revision = commandRevision
            do {
                try await worker.waitUntilReady()
            } catch {
                await worker.publishSnapshot()
                deliverUpdates()
                if revision != commandRevision { continue }
                throw error
            }
            await worker.publishSnapshot()
            deliverUpdates()
            if revision == commandRevision { return }
        }
    }

    func renderOffline(frames: AVAudioFrameCount, into buffer: AVAudioPCMBuffer, awaitingDecodedBuffers: Bool = true) async throws -> AVAudioEngineManualRenderingStatus {
        try await waitUntilReady()
        let generation = placeholder.generation
        let request = LocalAudioRenderRequest(buffer: buffer, frames: frames, awaitingDecodedBuffers: awaitingDecodedBuffers)
        do {
            let status = try await worker.renderOffline(request)
            await worker.publishSnapshot()
            deliverUpdates()
            guard placeholder.generation == generation else { throw LocalAudioError.cancelled }
            return status
        } catch {
            await worker.publishSnapshot()
            deliverUpdates()
            throw error
        }
    }

    private func enqueue(_ operation: @escaping @LocalAudioActor @Sendable (LocalAudioWorker) async -> Void) {
        commandRevision &+= 1
        let previous = pendingCommand
        pendingCommand = Task { @LocalAudioActor [worker] in
            await previous?.value
            await operation(worker)
            worker.publishSnapshot()
        }
    }

    private func waitForCommands() async {
        while true {
            let revision = commandRevision
            await pendingCommand?.value
            deliverUpdates()
            if revision == commandRevision { return }
        }
    }

    private func deliverUpdates() {
        for delivery in mailbox.takeUpdates() where delivery.update.generation == placeholder.generation {
            self.delivery = delivery.snapshot
            onUpdate?(delivery.update)
            self.delivery = nil
        }
    }
}
