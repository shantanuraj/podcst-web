import AVFoundation
import Foundation
import PodcstAudioEngine

struct AudioSourceSpan: Sendable {
    let sourceStart: Int64
    let outputStart: Int64
    var frameCount: Int64
}

struct AppliedAudioEffects: Equatable, Sendable {
    let effects: AudioEffects
    let sourceFrame: Int64
    let revision: UInt64
}

struct ProcessedAudioBlock: Sendable {
    let lease: LocalAudioBufferLease
    let spans: [AudioSourceSpan]
    let endOfFile: Bool
    let applied: AppliedAudioEffects
    let allocatedBytes: UInt64
    let fileEndFrame: Int64?
}

actor AudioProcessingDecoder {
    private let source: any PCMDecoder
    private let blockFrames: AVAudioFrameCount
    private let bufferCount: Int
    private let outputBlockDuration: TimeInterval?
    private var generation = UUID()
    private var buffers: [AVAudioPCMBuffer] = []
    private var leased: Set<Int> = []
    private var processor: EffectsWorker?
    private var input: LocalAudioDecodedBlock?
    private var inputOffset = 0
    private var ended = false
    private var drained = false
    private var finishing = false
    private var sourceEndFrame: Int64 = 0
    private var revision: UInt64 = 0
    private var requested = AudioEffects()

    init(source: any PCMDecoder, blockFrames: AVAudioFrameCount, bufferCount: Int, outputBlockDuration: TimeInterval? = nil) {
        self.source = source
        self.blockFrames = blockFrames
        self.bufferCount = bufferCount
        self.outputBlockDuration = outputBlockDuration
    }

    func open(url: URL, at position: TimeInterval, generation: UUID) async throws -> LocalAudioFileInfo {
        guard !Task.isCancelled else { throw LocalAudioError.cancelled }
        guard (1...8192).contains(blockFrames), (2...16).contains(bufferCount),
              outputBlockDuration.map({ $0.isFinite && $0 > 0 && $0 <= 1 }) ?? true else { throw LocalAudioError.invalidConfiguration }
        self.generation = generation
        let info = try await source.open(url: url, at: position, generation: generation)
        guard self.generation == generation, !Task.isCancelled else { throw LocalAudioError.cancelled }
        guard info.sampleRate.isFinite, (8_000...192_000).contains(info.sampleRate), info.sampleRate.rounded() == info.sampleRate,
              (1...2).contains(info.channels), info.frameCount >= 0, info.startFrame >= 0,
              let format = AVAudioFormat(standardFormatWithSampleRate: info.sampleRate, channels: info.channels) else {
            throw LocalAudioError.unsupportedFormat
        }
        let outputFrames = outputBlockDuration.map { min(blockFrames, AVAudioFrameCount(max(1, floor(info.sampleRate * $0)))) } ?? blockFrames
        processor = try EffectsWorker(info: info, effects: requested, capacity: Int(blockFrames), revision: revision)
        buffers = try (0..<bufferCount).map { _ in
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: outputFrames) else { throw LocalAudioError.cannotDecode }
            return buffer
        }
        leased.removeAll(keepingCapacity: true)
        input = nil
        inputOffset = 0
        ended = false
        drained = false
        finishing = false
        sourceEndFrame = info.startFrame
        return info
    }

    func configure(_ effects: AudioEffects, revision: UInt64) throws {
        guard revision >= self.revision else { return }
        requested = effects
        self.revision = revision
        guard !finishing else { return }
        try processor?.configure(effects, revision: revision)
    }

    func read(slot: Int, generation: UUID) async throws -> ProcessedAudioBlock {
        guard self.generation == generation, !Task.isCancelled,
              let processor, buffers.indices.contains(slot), !leased.contains(slot) else { throw LocalAudioError.notReady }
        let output = buffers[slot]
        output.frameLength = 0
        var spans: [AudioSourceSpan] = []
        while output.frameLength < output.frameCapacity, !drained {
            if input == nil, !ended {
                let next = try await source.read(slot: 0, generation: generation)
                guard self.generation == generation, !Task.isCancelled else { throw LocalAudioError.cancelled }
                input = next
                sourceEndFrame = next.sourceStart + Int64(next.lease.buffer.frameLength)
                inputOffset = 0
                try processor.copyInput(next.lease.buffer)
            }
            finishing = ended && input == nil
            let report = try processor.process(
                inputOffset: inputOffset,
                inputFrames: input.map { Int($0.lease.buffer.frameLength) - inputOffset } ?? 0,
                finishing: finishing,
                output: output,
                spans: &spans
            )
            inputOffset += report.consumed
            drained = report.finished
            if let input, inputOffset == Int(input.lease.buffer.frameLength) {
                ended = input.endOfFile
                self.input = nil
                await source.release(slot: input.lease.slot, generation: generation)
                guard self.generation == generation, !Task.isCancelled else { throw LocalAudioError.cancelled }
            }
            if report.consumed == 0, report.emitted == 0, !report.finished, input != nil {
                throw LocalAudioError.cannotDecode
            }
        }
        let sourceBytes = await source.allocatedBytes()
        guard self.generation == generation, !Task.isCancelled else { throw LocalAudioError.cancelled }
        leased.insert(slot)
        return ProcessedAudioBlock(
            lease: LocalAudioBufferLease(slot: slot, buffer: output),
            spans: spans,
            endOfFile: drained,
            applied: try processor.applied(),
            allocatedBytes: try sourceBytes + processor.allocatedBytes() + UInt64(bufferCount) * UInt64(output.frameCapacity) * UInt64(output.format.channelCount) * 4,
            fileEndFrame: drained ? sourceEndFrame : nil
        )
    }

    func release(slot: Int, generation: UUID) {
        guard self.generation == generation else { return }
        leased.remove(slot)
    }

    func silence(slot: Int, frames: AVAudioFrameCount, generation: UUID) throws -> LocalAudioBufferLease {
        guard self.generation == generation, buffers.indices.contains(slot), !leased.contains(slot), frames <= buffers[slot].frameCapacity,
              let channels = buffers[slot].floatChannelData else { throw LocalAudioError.notReady }
        let buffer = buffers[slot]
        buffer.frameLength = frames
        for channel in 0..<Int(buffer.format.channelCount) { channels[channel].update(repeating: 0, count: Int(frames)) }
        leased.insert(slot)
        return LocalAudioBufferLease(slot: slot, buffer: buffer)
    }

    func close(generation: UUID) async {
        guard self.generation == generation else { return }
        self.generation = UUID()
        processor = nil
        input = nil
        buffers = []
        leased = []
        await source.close(generation: generation)
    }
}

private final class EffectsWorker {
    private var handle: OpaquePointer?
    private let channels: Int
    private let capacity: Int
    private var input: [Float]
    private var output: [Float]
    private var spans: [PodcstSourceSpan]

    init(info: LocalAudioFileInfo, effects: AudioEffects, capacity: Int, revision: UInt64) throws {
        channels = Int(info.channels)
        self.capacity = capacity
        input = [Float](repeating: 0, count: capacity * channels)
        output = [Float](repeating: 0, count: capacity * channels)
        spans = [PodcstSourceSpan](repeating: PodcstSourceSpan(), count: capacity)
        guard info.sampleRate.rounded() == info.sampleRate else { throw LocalAudioError.unsupportedFormat }
        var config = PodcstEffectsConfig(sample_rate: UInt32(info.sampleRate), channels: info.channels, boost_enabled: effects.volumeBoost ? 1 : 0, trim_enabled: effects.trimSilence ? 1 : 0)
        try check(podcst_effects_create(&config, &handle))
        try check(podcst_effects_reset(handle, UInt64(info.startFrame)))
        try configure(effects, revision: revision)
    }

    deinit { podcst_effects_destroy(&handle) }

    func configure(_ effects: AudioEffects, revision: UInt64) throws {
        try check(podcst_effects_configure(handle, effects.volumeBoost ? 1 : 0, effects.trimSilence ? 1 : 0, revision))
    }

    func copyInput(_ buffer: AVAudioPCMBuffer) throws {
        guard buffer.format.commonFormat == .pcmFormatFloat32, !buffer.format.isInterleaved,
              buffer.format.channelCount == channels, buffer.frameLength <= capacity,
              let data = buffer.floatChannelData else { throw LocalAudioError.unsupportedFormat }
        for frame in 0..<Int(buffer.frameLength) {
            for channel in 0..<channels { input[frame * channels + channel] = data[channel][frame] }
        }
    }

    func process(inputOffset: Int, inputFrames: Int, finishing: Bool, output buffer: AVAudioPCMBuffer, spans mapped: inout [AudioSourceSpan]) throws -> (consumed: Int, emitted: Int, finished: Bool) {
        var report = PodcstEffectsReport()
        let offset = Int(buffer.frameLength)
        let available = UInt32(min(capacity, Int(buffer.frameCapacity)) - offset)
        let status = input.withUnsafeBufferPointer { source in
            output.withUnsafeMutableBufferPointer { destination in
                spans.withUnsafeMutableBufferPointer { spans in
                    if finishing {
                        return podcst_effects_finish(handle, destination.baseAddress, available, spans.baseAddress, UInt32(spans.count), &report)
                    }
                    return podcst_effects_process(handle, source.baseAddress?.advanced(by: inputOffset * channels), UInt32(inputFrames), destination.baseAddress, available, spans.baseAddress, UInt32(spans.count), &report)
                }
            }
        }
        guard status == PODCST_AUDIO_OK || status == PODCST_AUDIO_OUTPUT_FULL || status == PODCST_AUDIO_FINISHED,
              let data = buffer.floatChannelData else { throw LocalAudioError.cannotDecode }
        for frame in 0..<Int(report.emitted_frames) {
            for channel in 0..<channels { data[channel][offset + frame] = output[frame * channels + channel] }
        }
        for span in spans.prefix(Int(report.span_count)) {
            let next = AudioSourceSpan(sourceStart: Int64(span.source_start_frame), outputStart: Int64(offset) + Int64(span.output_start_frame), frameCount: Int64(span.frame_count))
            if let last = mapped.last, last.sourceStart + last.frameCount == next.sourceStart,
               last.outputStart + last.frameCount == next.outputStart {
                mapped[mapped.count - 1].frameCount += next.frameCount
            } else { mapped.append(next) }
        }
        buffer.frameLength += report.emitted_frames
        return (Int(report.consumed_frames), Int(report.emitted_frames), status == PODCST_AUDIO_FINISHED)
    }

    func applied() throws -> AppliedAudioEffects {
        let info = try information()
        return AppliedAudioEffects(effects: AudioEffects(volumeBoost: info.boost_enabled != 0, trimSilence: info.trim_enabled != 0), sourceFrame: Int64(info.applied_source_frame), revision: info.applied_revision)
    }

    func allocatedBytes() throws -> UInt64 {
        try information().allocated_bytes + UInt64((input.count + output.count) * MemoryLayout<Float>.stride + spans.count * MemoryLayout<PodcstSourceSpan>.stride)
    }

    private func information() throws -> PodcstEffectsInfo {
        var info = PodcstEffectsInfo()
        try check(podcst_effects_get_info(handle, &info))
        return info
    }

    private func check(_ status: UInt32) throws {
        guard status == PODCST_AUDIO_OK else { throw LocalAudioError.cannotDecode }
    }
}
