import AudioToolbox
import AVFoundation
import Foundation

actor ProgressiveAudioDecoder: PCMDecoder {
    private let source: HTTPMediaByteSource
    private let worker: ProgressiveAudioWorker
    private var active: (generation: UUID, cancellation: MediaReadCancellation)?

    init(source: HTTPMediaByteSource, blockFrames: AVAudioFrameCount = 2048, bufferCount: Int = 8) {
        self.source = source
        worker = ProgressiveAudioWorker(source: source, blockFrames: blockFrames, bufferCount: bufferCount)
    }

    func open(url: URL, at position: TimeInterval, generation: UUID) async throws -> LocalAudioFileInfo {
        active?.cancellation.cancel()
        let cancellation = MediaReadCancellation()
        active = (generation, cancellation)
        let metadata = try await source.metadata()
        guard active?.generation == generation else { throw MediaFailure.cancelled }
        let complete = await source.completeFileURL()
        guard active?.generation == generation else { throw MediaFailure.cancelled }
        guard metadata.capability == .randomAccess || complete != nil else { throw MediaFailure.requiresCompleteFile }
        guard let bytes = metadata.totalBytes else { throw MediaFailure.requiresCompleteFile }
        let info = try await worker.perform { try $0.open(position: position, generation: generation, totalBytes: bytes, contentType: metadata.contentType, cancellation: cancellation) }
        guard active?.generation == generation else { throw MediaFailure.cancelled }
        return info
    }

    func read(slot: Int, generation: UUID) async throws -> LocalAudioDecodedBlock {
        try await worker.perform { try $0.read(slot: slot, generation: generation) }
    }

    func allocatedBytes() async -> UInt64 {
        (try? await worker.perform { $0.allocatedBytes }) ?? 0
    }

    func release(slot: Int, generation: UUID) async {
        _ = try? await worker.perform(checkingCancellation: false) { $0.release(slot: slot, generation: generation) }
    }

    func silence(slot: Int, frames: AVAudioFrameCount, generation: UUID) async throws -> LocalAudioBufferLease {
        try await worker.perform { try $0.silence(slot: slot, frames: frames, generation: generation) }
    }

    func close(generation: UUID) async {
        guard active?.generation == generation else { return }
        active?.cancellation.cancel()
        active = nil
        _ = try? await worker.perform(checkingCancellation: false) { $0.close(generation: generation) }
    }
}

private final class ProgressiveAudioWorker: @unchecked Sendable {
    private let queue = DispatchQueue(label: "app.podcst.media.decode", qos: .userInitiated)
    private let source: HTTPMediaByteSource
    private let blockFrames: AVAudioFrameCount
    private let bufferCount: Int
    private var generation = UUID()
    private var audioFile: AudioFileID?
    private var extendedFile: ExtAudioFileRef?
    private var reader: ProgressiveByteReader?
    private var buffers: [AVAudioPCMBuffer] = []
    private var leased: Set<Int> = []
    private var frameCount: Int64 = 0

    init(source: HTTPMediaByteSource, blockFrames: AVAudioFrameCount, bufferCount: Int) {
        self.source = source
        self.blockFrames = blockFrames
        self.bufferCount = bufferCount
    }

    var allocatedBytes: UInt64 {
        buffers.reduce(0) { $0 + UInt64($1.frameCapacity) * UInt64($1.format.channelCount) * 4 } + UInt64(reader?.cachedBytes ?? 0)
    }

    deinit {
        if let extendedFile { ExtAudioFileDispose(extendedFile) }
        if let audioFile { AudioFileClose(audioFile) }
    }

    func perform<T: Sendable>(checkingCancellation: Bool = true, _ operation: @escaping @Sendable (ProgressiveAudioWorker) throws -> T) async throws -> T {
        if checkingCancellation { try Task.checkCancellation() }
        let value = try await withCheckedThrowingContinuation { continuation in
            queue.async {
                do { continuation.resume(returning: try operation(self)) }
                catch { continuation.resume(throwing: error) }
            }
        }
        if checkingCancellation { try Task.checkCancellation() }
        return value
    }

    func open(position: TimeInterval, generation: UUID, totalBytes: Int64, contentType: String?, cancellation: MediaReadCancellation) throws -> LocalAudioFileInfo {
        guard !cancellation.isCancelled else { throw MediaFailure.cancelled }
        guard position.isFinite, position >= 0, totalBytes > 0,
              blockFrames > 0, blockFrames <= 8192, (2...16).contains(bufferCount) else { throw LocalAudioError.invalidConfiguration }
        close(generation: self.generation)
        self.generation = generation
        let reader = ProgressiveByteReader(source: source, totalBytes: totalBytes, cancellation: cancellation)
        self.reader = reader
        let type: AudioFileTypeID
        switch contentType?.lowercased() {
        case "audio/mpeg", "audio/mp3": type = kAudioFileMP3Type
        case "audio/aac", "audio/aacp": type = kAudioFileAAC_ADTSType
        case "audio/mp4", "audio/x-m4a": type = kAudioFileM4AType
        default: type = 0
        }
        do {
            var file: AudioFileID?
            try check(AudioFileOpenWithCallbacks(Unmanaged.passUnretained(reader).toOpaque(), progressiveRead, nil, progressiveSize, nil, type, &file))
            guard let file else { throw MediaFailure.unsupportedMedia }
            audioFile = file
            var extended: ExtAudioFileRef?
            try check(ExtAudioFileWrapAudioFileID(file, false, &extended))
            guard let extended else { throw MediaFailure.unsupportedMedia }
            extendedFile = extended
            var sourceFormat = AudioStreamBasicDescription()
            var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
            try check(ExtAudioFileGetProperty(extended, kExtAudioFileProperty_FileDataFormat, &size, &sourceFormat))
            guard sourceFormat.mSampleRate.isFinite, (8_000...192_000).contains(sourceFormat.mSampleRate), (1...2).contains(sourceFormat.mChannelsPerFrame),
                  let format = AVAudioFormat(standardFormatWithSampleRate: sourceFormat.mSampleRate, channels: sourceFormat.mChannelsPerFrame) else { throw MediaFailure.unsupportedMedia }
            var client = format.streamDescription.pointee
            try check(ExtAudioFileSetProperty(extended, kExtAudioFileProperty_ClientDataFormat, UInt32(MemoryLayout<AudioStreamBasicDescription>.size), &client))
            var duration: Float64 = 0
            size = UInt32(MemoryLayout<Float64>.size)
            try check(AudioFileGetProperty(file, kAudioFilePropertyEstimatedDuration, &size, &duration))
            guard duration.isFinite, duration > 0, duration * format.sampleRate < Double(Int64.max) else { throw MediaFailure.unsupportedMedia }
            frameCount = Int64((duration * format.sampleRate).rounded())
            var fileType: AudioFileTypeID = 0
            size = UInt32(MemoryLayout<AudioFileTypeID>.size)
            try check(AudioFileGetProperty(file, kAudioFilePropertyFileFormat, &size, &fileType))
            let estimated = fileType == kAudioFileMP3Type || fileType == kAudioFileAAC_ADTSType
            let requested = position * format.sampleRate
            guard requested.isFinite, requested < Double(Int64.max) else { throw LocalAudioError.invalidConfiguration }
            let start = estimated ? Int64(requested) : min(frameCount, Int64(requested))
            try check(ExtAudioFileSeek(extended, start))
            buffers = try (0..<bufferCount).map { _ in
                guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: blockFrames) else { throw LocalAudioError.cannotDecode }
                return buffer
            }
            return LocalAudioFileInfo(sampleRate: format.sampleRate, channels: format.channelCount, frameCount: frameCount, startFrame: start, durationIsEstimated: estimated)
        } catch {
            close(generation: generation)
            throw error
        }
    }

    func read(slot: Int, generation: UUID) throws -> LocalAudioDecodedBlock {
        guard self.generation == generation, let extendedFile, buffers.indices.contains(slot), !leased.contains(slot) else { throw LocalAudioError.notReady }
        var start: Int64 = 0
        try check(ExtAudioFileTell(extendedFile, &start))
        let buffer = buffers[slot]
        var frames = blockFrames
        buffer.frameLength = frames
        if frames > 0 { try check(ExtAudioFileRead(extendedFile, &frames, buffer.mutableAudioBufferList)) }
        buffer.frameLength = frames
        leased.insert(slot)
        return LocalAudioDecodedBlock(lease: LocalAudioBufferLease(slot: slot, buffer: buffer), sourceStart: start, endOfFile: frames == 0)
    }

    func silence(slot: Int, frames: AVAudioFrameCount, generation: UUID) throws -> LocalAudioBufferLease {
        guard self.generation == generation, buffers.indices.contains(slot), !leased.contains(slot), frames <= blockFrames else { throw LocalAudioError.notReady }
        let buffer = buffers[slot]
        buffer.frameLength = frames
        guard let channels = buffer.floatChannelData else { throw LocalAudioError.unsupportedFormat }
        for channel in 0..<Int(buffer.format.channelCount) { channels[channel].update(repeating: 0, count: Int(frames)) }
        leased.insert(slot)
        return LocalAudioBufferLease(slot: slot, buffer: buffer)
    }

    func release(slot: Int, generation: UUID) {
        if self.generation == generation { leased.remove(slot) }
    }

    func close(generation: UUID) {
        guard self.generation == generation else { return }
        if let extendedFile { ExtAudioFileDispose(extendedFile) }
        if let audioFile { AudioFileClose(audioFile) }
        extendedFile = nil
        audioFile = nil
        reader = nil
        buffers = []
        leased = []
        frameCount = 0
        self.generation = UUID()
    }

    private func check(_ status: OSStatus) throws {
        guard status == noErr else { throw reader?.failure ?? MediaFailure.unsupportedMedia }
    }
}

private final class ProgressiveByteReader {
    let source: HTTPMediaByteSource
    let totalBytes: Int64
    var failure: MediaFailure?
    private let cancellation: MediaReadCancellation
    private var cached = Data()
    private var cachedOffset: Int64 = 0
    var cachedBytes: Int { cached.count }

    init(source: HTTPMediaByteSource, totalBytes: Int64, cancellation: MediaReadCancellation) {
        self.source = source
        self.totalBytes = totalBytes
        self.cancellation = cancellation
    }

    func read(position: Int64, count: UInt32, buffer: UnsafeMutableRawPointer, actual: UnsafeMutablePointer<UInt32>) -> OSStatus {
        actual.pointee = 0
        guard !cancellation.isCancelled else { failure = .cancelled; return kAudioFileUnspecifiedError }
        guard position >= 0 else { return kAudioFilePositionError }
        let available = max(0, min(Int64(count), totalBytes - min(position, totalBytes)))
        var copied = 0
        while copied < Int(available) {
            let position = position + Int64(copied)
            if position < cachedOffset || position >= cachedOffset + Int64(cached.count) {
                let box = MediaReadResult()
                cancellation.install(box)
                let source = source
                let offset = position / Int64(HTTPMediaByteSource.blockSize) * Int64(HTTPMediaByteSource.blockSize)
                let count = Int(min(Int64(HTTPMediaByteSource.blockSize), totalBytes - offset))
                let task = Task.detached(priority: .userInitiated) {
                    do { box.finish(.success(try await source.read(offset: offset, count: count))) }
                    catch { box.finish(.failure(error as? MediaFailure ?? .invalidResponse)) }
                }
                guard box.semaphore.wait(timeout: .now() + 45) == .success else {
                    task.cancel()
                    failure = .invalidResponse
                    return kAudioFileUnspecifiedError
                }
                switch box.take() {
                case .success(let data):
                    guard data.count == count else { failure = .invalidResponse; return kAudioFileUnspecifiedError }
                    cached = data
                    cachedOffset = offset
                case .failure(let error):
                    task.cancel()
                    failure = error
                    return kAudioFileUnspecifiedError
                }
            }
            let offset = Int(position - cachedOffset)
            let count = min(Int(available) - copied, cached.count - offset)
            cached.withUnsafeBytes { bytes in
                if let address = bytes.baseAddress { buffer.advanced(by: copied).copyMemory(from: address.advanced(by: offset), byteCount: count) }
            }
            copied += count
        }
        actual.pointee = UInt32(copied)
        return noErr
    }
}

private final class MediaReadResult: @unchecked Sendable {
    let semaphore = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var result: Result<Data, MediaFailure>?

    func finish(_ result: Result<Data, MediaFailure>) {
        lock.lock()
        guard self.result == nil else { lock.unlock(); return }
        self.result = result
        lock.unlock()
        semaphore.signal()
    }

    func take() -> Result<Data, MediaFailure> {
        lock.lock()
        defer { lock.unlock() }
        return result ?? .failure(.cancelled)
    }
}

private final class MediaReadCancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false
    private var pending: MediaReadResult?

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    func install(_ result: MediaReadResult) {
        lock.lock()
        pending = result
        let cancelled = cancelled
        lock.unlock()
        if cancelled { result.finish(.failure(.cancelled)) }
    }

    func cancel() {
        lock.lock()
        cancelled = true
        let pending = pending
        lock.unlock()
        pending?.finish(.failure(.cancelled))
    }
}

private let progressiveRead: AudioFile_ReadProc = { context, position, count, buffer, actual in
    Unmanaged<ProgressiveByteReader>.fromOpaque(context).takeUnretainedValue().read(position: position, count: count, buffer: buffer, actual: actual)
}

private let progressiveSize: AudioFile_GetSizeProc = { context in
    Unmanaged<ProgressiveByteReader>.fromOpaque(context).takeUnretainedValue().totalBytes
}
