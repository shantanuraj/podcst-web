import AVFoundation
import Foundation

struct LocalAudioFileInfo: Sendable {
    let sampleRate: Double
    let channels: AVAudioChannelCount
    let frameCount: AVAudioFramePosition
    let startFrame: AVAudioFramePosition

    var duration: TimeInterval { Double(frameCount) / sampleRate }
}

final class LocalAudioBufferLease: @unchecked Sendable {
    let slot: Int
    let buffer: AVAudioPCMBuffer

    init(slot: Int, buffer: AVAudioPCMBuffer) {
        self.slot = slot
        self.buffer = buffer
    }
}

struct LocalAudioDecodedBlock: Sendable {
    let lease: LocalAudioBufferLease
    let sourceStart: AVAudioFramePosition
    let endOfFile: Bool
}

enum LocalAudioError: Error, Equatable, Sendable {
    case invalidConfiguration
    case invalidSource
    case unsupportedFormat
    case cannotDecode
    case cannotCreateGraph
    case cannotStart
    case cannotRender
    case notReady
    case cancelled
}

actor LocalAudioDecoder {
    private let blockFrames: AVAudioFrameCount
    private let bufferCount: Int
    private var generation = UUID()
    private var file: AVAudioFile?
    private var buffers: [AVAudioPCMBuffer] = []
    private var leasedSlots: Set<Int> = []

    init(blockFrames: AVAudioFrameCount, bufferCount: Int) {
        self.blockFrames = blockFrames
        self.bufferCount = bufferCount
    }

    func open(url: URL, at position: TimeInterval, generation: UUID) throws -> LocalAudioFileInfo {
        guard !Task.isCancelled else { throw LocalAudioError.cancelled }
        guard position.isFinite else { throw LocalAudioError.invalidSource }
        guard url.isFileURL else { throw LocalAudioError.invalidSource }
        guard blockFrames > 0, blockFrames <= 8192, (2...16).contains(bufferCount) else { throw LocalAudioError.invalidConfiguration }
        let file: AVAudioFile
        do {
            file = try AVAudioFile(forReading: url, commonFormat: .pcmFormatFloat32, interleaved: false)
        } catch {
            throw LocalAudioError.cannotDecode
        }
        guard file.length >= 0 else { throw LocalAudioError.cannotDecode }
        let format = file.processingFormat
        guard (1...2).contains(format.channelCount), format.sampleRate.isFinite, (8_000...192_000).contains(format.sampleRate) else {
            throw LocalAudioError.unsupportedFormat
        }
        let requestedFrame = max(0, position) * format.sampleRate
        let start = requestedFrame >= Double(file.length) ? file.length : AVAudioFramePosition(requestedFrame)
        file.framePosition = start
        var buffers: [AVAudioPCMBuffer] = []
        for _ in 0..<bufferCount {
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: blockFrames) else { throw LocalAudioError.cannotDecode }
            buffers.append(buffer)
        }
        guard !Task.isCancelled else { throw LocalAudioError.cancelled }
        self.generation = generation
        self.file = file
        self.buffers = buffers
        leasedSlots.removeAll(keepingCapacity: true)
        return LocalAudioFileInfo(sampleRate: format.sampleRate, channels: format.channelCount, frameCount: file.length, startFrame: start)
    }

    func read(slot: Int, generation: UUID) throws -> LocalAudioDecodedBlock {
        guard !Task.isCancelled, self.generation == generation else { throw LocalAudioError.cancelled }
        guard let file, buffers.indices.contains(slot), !leasedSlots.contains(slot) else { throw LocalAudioError.notReady }
        let buffer = buffers[slot]
        let sourceStart = file.framePosition
        buffer.frameLength = 0
        if sourceStart < file.length {
            do {
                try file.read(into: buffer, frameCount: blockFrames)
            } catch {
                throw LocalAudioError.cannotDecode
            }
        }
        guard !Task.isCancelled else { throw LocalAudioError.cancelled }
        leasedSlots.insert(slot)
        return LocalAudioDecodedBlock(lease: LocalAudioBufferLease(slot: slot, buffer: buffer), sourceStart: sourceStart, endOfFile: buffer.frameLength == 0 || file.framePosition >= file.length)
    }

    func release(slot: Int, generation: UUID) {
        guard self.generation == generation else { return }
        leasedSlots.remove(slot)
    }

    func close(generation: UUID) {
        guard self.generation == generation else { return }
        file = nil
        buffers = []
        leasedSlots.removeAll(keepingCapacity: true)
        self.generation = UUID()
    }
}

extension LocalAudioDecoder {
    func silence(slot: Int, frames: AVAudioFrameCount, generation: UUID) throws -> LocalAudioBufferLease {
        guard !Task.isCancelled, self.generation == generation else { throw LocalAudioError.cancelled }
        guard buffers.indices.contains(slot), !leasedSlots.contains(slot), frames <= blockFrames else { throw LocalAudioError.invalidConfiguration }
        let buffer = buffers[slot]
        buffer.frameLength = frames
        guard let channels = buffer.floatChannelData else { throw LocalAudioError.unsupportedFormat }
        for channel in 0..<Int(buffer.format.channelCount) {
            channels[channel].update(repeating: 0, count: Int(frames))
        }
        leasedSlots.insert(slot)
        return LocalAudioBufferLease(slot: slot, buffer: buffer)
    }
}
