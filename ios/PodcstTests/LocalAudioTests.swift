import AVFoundation
import XCTest
@testable import Podcst

@MainActor
final class LocalAudioTests: XCTestCase {
    func testOfflineGraphPreservesPCMAndCompletesOnce() async throws {
        let frames = 25_139
        let url = try fixture(frames: frames, channels: 2)
        let transport = makeTransport()
        let generation = UUID()
        var completed: [UUID] = []
        transport.onUpdate = { update in
            if case .ended = update.event { completed.append(update.generation) }
        }
        transport.load(url: url, at: 0, generation: generation)
        try await transport.waitUntilReady()
        transport.play(atRate: 1)
        let rendered = try await capture(transport, channels: 2, slices: [1, 31, 257, 1024, 91])

        XCTAssertEqual(completed, [generation])
        XCTAssertEqual(transport.position, Double(frames) / 48_000, accuracy: 1.0 / 48_000)
        XCTAssertEqual(transport.diagnostics.underruns, 0)
        for channel in 0..<2 {
            XCTAssertGreaterThanOrEqual(rendered.samples[channel].count, frames)
            guard rendered.samples[channel].count >= frames else { continue }
            for frame in 0..<frames {
                XCTAssertEqual(rendered.samples[channel][frame], sample(frame: frame, channel: channel), accuracy: 0.0000002)
            }
            XCTAssertTrue(rendered.samples[channel].dropFirst(frames).allSatisfy { abs($0) < 0.0000002 })
        }
        transport.stop()
        await Task.yield()
        XCTAssertEqual(completed.count, 1)
    }

    func testOfflineGraphLimiterPreservesFinalSamplesAfterStartupLatency() async throws {
        let frames = 9
        let url = try fixture(frames: frames, channels: 2)
        let transport = makeTransport(limiterEnabled: true)
        transport.load(url: url, at: 0, generation: UUID())
        try await transport.waitUntilReady()
        transport.play(atRate: 1)
        let latency = Int(transport.diagnostics.limiterLatencyFrames)
        XCTAssertEqual(latency, 255)
        let rendered = try await capture(transport, channels: 2, slices: [1, 7, 31, 257])

        for channel in 0..<2 {
            XCTAssertGreaterThanOrEqual(rendered.samples[channel].count, frames + latency)
            guard rendered.samples[channel].count >= frames + latency else { continue }
            XCTAssertTrue(rendered.samples[channel].prefix(latency).allSatisfy { $0 == 0 })
            for frame in 0..<frames {
                XCTAssertEqual(rendered.samples[channel][latency + frame], sample(frame: frame, channel: channel), accuracy: 0.0000002)
            }
            XCTAssertTrue(rendered.samples[channel].dropFirst(latency + frames).allSatisfy { abs($0) < 0.0000002 })
        }
        XCTAssertTrue(transport.diagnostics.reachedEnd)
        XCTAssertEqual(transport.position, Double(frames) / 48_000, accuracy: 1.0 / 48_000)
    }

    func testOfflineGraphClockTracksAudibleMarkersAtEveryRate() async throws {
        let markers = [12_000, 24_000, 36_000, 48_000, 59_999]
        let url = try fixture(frames: 60_000, channels: 1, signal: { frame, _ in markers.contains(frame) ? 0.5 : 0 })
        for rate in PlaybackController.supportedRates {
            let transport = makeTransport(channels: 1)
            transport.load(url: url, at: 0, generation: UUID())
            try await transport.waitUntilReady()
            transport.play(atRate: rate)
            let rendered = try await capture(transport, channels: 1, slices: [256])
            let samples = rendered.samples[0]
            for marker in markers {
                let nominal = Double(marker) / rate
                let radius = 2400 / rate
                let lower = max(0, Int(nominal - radius))
                let upper = min(samples.count, Int(nominal + radius) + 1)
                guard lower < upper else {
                    XCTFail("Playback ended before the marker at rate \(rate)")
                    continue
                }
                let peak = try XCTUnwrap((lower..<upper).max { abs(samples[$0]) < abs(samples[$1]) })
                XCTAssertGreaterThan(abs(samples[peak]), 0.02, "Missing marker at rate \(rate)")
                let sourceTime = try rendered.sourceTime(at: peak)
                XCTAssertEqual(sourceTime, Double(marker) / 48_000, accuracy: 0.020, "Audible marker disagrees with source time at rate \(rate)")
            }
            XCTAssertEqual(transport.position, 1.25, accuracy: 1.0 / 48_000)
            XCTAssertEqual(transport.diagnostics.underruns, 0)
            transport.shutdown()
        }
    }

    func testRateChangeAndRapidSeeksPreserveHeardSourcePosition() async throws {
        let url = try fixture(frames: 96_000, channels: 2)
        let transport = makeTransport()
        let buffer = try outputBuffer(channels: 2)
        var updates: [PlaybackTransportUpdate] = []
        transport.onUpdate = { updates.append($0) }
        transport.load(url: url, at: 0, generation: UUID())
        try await transport.waitUntilReady()
        transport.play(atRate: 1)
        for _ in 0..<4 { _ = try await transport.renderOffline(frames: 1024, into: buffer) }
        let heardPosition = transport.position
        transport.setRate(2)
        try await transport.waitUntilReady()
        XCTAssertEqual(transport.position, heardPosition, accuracy: 1.0 / 48_000)
        _ = try await transport.renderOffline(frames: 512, into: buffer)
        XCTAssertEqual(transport.position, heardPosition + 1024.0 / 48_000, accuracy: 0.020)
        transport.pause()
        let pausedPosition = transport.position
        await Task.yield()
        XCTAssertEqual(transport.position, pausedPosition)
        XCTAssertFalse(transport.diagnostics.isPlaying)
        transport.play(atRate: 2)
        try await transport.waitUntilReady()
        XCTAssertEqual(transport.position, pausedPosition, accuracy: 1.0 / 48_000)

        transport.setRate(1)
        transport.seek(to: 0.7, generation: UUID())
        let finalGeneration = UUID()
        transport.seek(to: 0.2, generation: finalGeneration)
        updates.removeAll()
        try await transport.waitUntilReady()
        XCTAssertEqual(transport.position, 0.2, accuracy: 1.0 / 48_000)
        let seekStatus = try await transport.renderOffline(frames: 512, into: buffer)
        XCTAssertEqual(seekStatus, .success)
        for channel in 0..<2 {
            let samples = try XCTUnwrap(buffer.floatChannelData?[channel])
            for frame in 0..<512 {
                XCTAssertEqual(samples[frame], sample(frame: 9600 + frame, channel: channel), accuracy: 0.0000002)
            }
        }
        XCTAssertTrue(updates.allSatisfy { $0.generation == finalGeneration })
        transport.stop()
        await Task.yield()
        XCTAssertFalse(updates.contains { if case .ended = $0.event { true } else { false } })
        XCTAssertFalse(transport.hasSource)
    }

    func testOfflineSchedulingMemoryStaysBounded() async throws {
        let url = try fixture(frames: 480_000, channels: 2)
        let transport = makeTransport()
        let buffer = try outputBuffer(channels: 2)
        transport.load(url: url, at: 0, generation: UUID())
        try await transport.waitUntilReady()
        let allocated = transport.diagnostics.allocatedBytes
        XCTAssertLessThan(allocated, 8 * 1024 * 1024)
        XCTAssertEqual(transport.diagnostics.bufferCapacityFrames, 16_384)
        transport.play(atRate: 1)
        for _ in 0..<1024 {
            if transport.diagnostics.reachedEnd { break }
            let status = try await transport.renderOffline(frames: 1024, into: buffer)
            XCTAssertEqual(status, .success)
            XCTAssertEqual(transport.diagnostics.allocatedBytes, allocated)
            XCTAssertLessThanOrEqual(transport.diagnostics.scheduledBuffers, 8)
        }
        XCTAssertTrue(transport.diagnostics.reachedEnd)
        XCTAssertEqual(transport.diagnostics.underruns, 0)
    }

    func testStarvationFreezesSourceTimeAndRecoversWithoutLosingSamples() async throws {
        let url = try fixture(frames: 512, channels: 2)
        let configuration = LocalAudioConfiguration(output: .offline(sampleRate: 48_000, channels: 2, maximumFrames: 1024), blockFrames: 128, bufferCount: 2, limiterEnabled: false)
        let transport = LocalAudioTransport(configuration: configuration)
        defer { transport.shutdown() }
        let buffer = try outputBuffer(channels: 2)
        var readinessCount = 0
        var completionCount = 0
        transport.onUpdate = { update in
            switch update.event {
            case .ready: readinessCount += 1
            case .ended: completionCount += 1
            default: break
            }
        }
        transport.load(url: url, at: 0, generation: UUID())
        try await transport.waitUntilReady()
        transport.play(atRate: 1)
        let firstStatus = try await transport.renderOffline(frames: 1024, into: buffer, awaitingDecodedBuffers: false)
        XCTAssertEqual(firstStatus, .success)
        for channel in 0..<2 {
            let samples = try XCTUnwrap(buffer.floatChannelData?[channel])
            for frame in 0..<256 {
                XCTAssertEqual(samples[frame], sample(frame: frame, channel: channel), accuracy: 0.0000002)
            }
            XCTAssertTrue((256..<1024).allSatisfy { samples[$0] == 0 })
        }
        XCTAssertEqual(transport.position, 256.0 / 48_000, accuracy: 1.0 / 48_000)
        XCTAssertEqual(transport.diagnostics.underruns, 1)
        XCTAssertEqual(completionCount, 0)

        for _ in 0..<32 {
            try await transport.waitUntilReady()
            if readinessCount == 2 { break }
            _ = try await transport.renderOffline(frames: 1024, into: buffer, awaitingDecodedBuffers: false)
            XCTAssertEqual(transport.position, 256.0 / 48_000, accuracy: 1.0 / 48_000)
            XCTAssertEqual(completionCount, 0)
        }
        XCTAssertEqual(readinessCount, 2)
        XCTAssertEqual(transport.diagnostics.underruns, 1)
        let recoveredStatus = try await transport.renderOffline(frames: 1024, into: buffer, awaitingDecodedBuffers: false)
        XCTAssertEqual(recoveredStatus, .success)
        for channel in 0..<2 {
            let samples = try XCTUnwrap(buffer.floatChannelData?[channel])
            for frame in 0..<256 {
                XCTAssertEqual(samples[frame], sample(frame: 256 + frame, channel: channel), accuracy: 0.0000002)
            }
        }
        XCTAssertEqual(transport.diagnostics.underruns, 1)
        XCTAssertEqual(completionCount, 0)
    }

    func testCompletionCallbackCannotFinishAReentrantReplacement() async throws {
        let first = try fixture(frames: 9, channels: 2)
        let replacement = try fixture(frames: 48_000, channels: 2)
        let transport = makeTransport()
        let buffer = try outputBuffer(channels: 2)
        let replacementGeneration = UUID()
        var replaced = false
        var completions: [UUID] = []
        transport.onUpdate = { update in
            switch update.event {
            case .position where transport.diagnostics.reachedEnd && !replaced:
                replaced = true
                transport.load(url: replacement, at: 0, generation: replacementGeneration)
            case .ended:
                completions.append(update.generation)
            default:
                break
            }
        }
        transport.load(url: first, at: 0, generation: UUID())
        try await transport.waitUntilReady()
        transport.play(atRate: 1)
        for _ in 0..<128 {
            if replaced { break }
            do {
                _ = try await transport.renderOffline(frames: 1024, into: buffer)
            } catch LocalAudioError.cancelled where replaced {
                break
            }
        }
        XCTAssertTrue(replaced)
        try await transport.waitUntilReady()
        XCTAssertTrue(completions.isEmpty)
        XCTAssertEqual(transport.diagnostics.sourceFrameCount, 48_000)
        XCTAssertFalse(transport.diagnostics.reachedEnd)
        XCTAssertEqual(transport.position, 0)
    }

    func testLoadingCallbackCannotReplaceTheNewPreparationTask() async throws {
        let first = try fixture(frames: 9, channels: 2)
        let replacement = try fixture(frames: 48_000, channels: 2)
        let transport = makeTransport()
        let replacementGeneration = UUID()
        var replaced = false
        var readyGenerations: [UUID] = []
        transport.onUpdate = { update in
            switch update.event {
            case .playback(false) where !replaced:
                replaced = true
                transport.load(url: replacement, at: 0, generation: replacementGeneration)
            case .ready:
                readyGenerations.append(update.generation)
            default:
                break
            }
        }
        transport.load(url: first, at: 0, generation: UUID())
        for _ in 0..<300 {
            if transport.diagnostics.isReady || transport.diagnostics.failure != nil { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(replaced)
        XCTAssertEqual(readyGenerations, [replacementGeneration])
        XCTAssertEqual(transport.diagnostics.sourceFrameCount, 48_000)
        XCTAssertGreaterThan(transport.diagnostics.decodedThroughFrame, 0)
        XCTAssertNil(transport.diagnostics.failure)
    }

    func testDecoderPreservesPCMAndReusesBoundedBuffers() async throws {
        let frames = 25_139
        let url = try fixture(frames: frames, channels: 2)
        let decoder = LocalAudioDecoder(blockFrames: 257, bufferCount: 3)
        let generation = UUID()
        let info = try await decoder.open(url: url, at: 0, generation: generation)
        XCTAssertEqual(info.frameCount, AVAudioFramePosition(frames))
        XCTAssertEqual(info.sampleRate, 48_000)
        XCTAssertEqual(info.channels, 2)
        var readFrames = 0
        var slots: [Int: ObjectIdentifier] = [:]
        var index = 0

        while readFrames < frames {
            let slot = index % 3
            let block = try await decoder.read(slot: slot, generation: generation)
            let identity = ObjectIdentifier(block.lease.buffer)
            if let previous = slots[slot] { XCTAssertEqual(identity, previous) }
            slots[slot] = identity
            XCTAssertEqual(block.sourceStart, AVAudioFramePosition(readFrames))
            XCTAssertLessThanOrEqual(block.lease.buffer.frameCapacity, 257)
            guard block.lease.buffer.frameLength > 0 else {
                XCTFail("The decoder stopped before the final source frame")
                break
            }
            for channel in 0..<2 {
                let samples = try XCTUnwrap(block.lease.buffer.floatChannelData?[channel])
                for frame in 0..<Int(block.lease.buffer.frameLength) {
                    XCTAssertEqual(samples[frame], sample(frame: readFrames + frame, channel: channel), accuracy: 0.0000001)
                }
            }
            readFrames += Int(block.lease.buffer.frameLength)
            XCTAssertEqual(block.endOfFile, readFrames == frames)
            await decoder.release(slot: slot, generation: generation)
            index += 1
        }

        XCTAssertEqual(slots.count, 3)
        let end = try await decoder.read(slot: 0, generation: generation)
        XCTAssertEqual(end.lease.buffer.frameLength, 0)
        XCTAssertTrue(end.endOfFile)
        await decoder.close(generation: generation)
    }

    func testDecoderRejectsPreviousGenerationAndSeeksOnSourceFrames() async throws {
        let url = try fixture(frames: 48_000, channels: 1)
        let decoder = LocalAudioDecoder(blockFrames: 128, bufferCount: 2)
        let previous = UUID()
        _ = try await decoder.open(url: url, at: 0, generation: previous)
        _ = try await decoder.read(slot: 0, generation: previous)
        let current = UUID()
        let info = try await decoder.open(url: url, at: 0.25, generation: current)
        XCTAssertEqual(info.startFrame, 12_000)
        await decoder.close(generation: previous)

        do {
            _ = try await decoder.read(slot: 1, generation: previous)
            XCTFail("An obsolete generation decoded audio")
        } catch let error as LocalAudioError {
            XCTAssertEqual(error, .cancelled)
        }

        let block = try await decoder.read(slot: 0, generation: current)
        XCTAssertEqual(block.sourceStart, 12_000)
        let samples = try XCTUnwrap(block.lease.buffer.floatChannelData?[0])
        for frame in 0..<Int(block.lease.buffer.frameLength) {
            XCTAssertEqual(samples[frame], sample(frame: 12_000 + frame, channel: 0), accuracy: 0.0000001)
        }
        await decoder.close(generation: current)
    }

    func testDecoderReadsGeneratedAACInBoundedChunks() async throws {
        let frames = 48_000
        let url = try fixture(frames: frames, channels: 1, compressed: true)
        let decoder = LocalAudioDecoder(blockFrames: 512, bufferCount: 2)
        let generation = UUID()
        let info = try await decoder.open(url: url, at: 0, generation: generation)
        XCTAssertEqual(info.sampleRate, 48_000)
        XCTAssertEqual(info.channels, 1)
        XCTAssertEqual(info.duration, 1, accuracy: 0.05)
        var count = 0
        var energy: Double = 0

        while count < Int(info.frameCount) {
            let block = try await decoder.read(slot: count / 512 % 2, generation: generation)
            XCTAssertGreaterThan(block.lease.buffer.frameLength, 0)
            guard block.lease.buffer.frameLength > 0 else { break }
            XCTAssertLessThanOrEqual(block.lease.buffer.frameLength, 512)
            let samples = try XCTUnwrap(block.lease.buffer.floatChannelData?[0])
            for frame in 0..<Int(block.lease.buffer.frameLength) {
                XCTAssertTrue(samples[frame].isFinite)
                energy += Double(samples[frame]) * Double(samples[frame])
            }
            count += Int(block.lease.buffer.frameLength)
            await decoder.release(slot: block.lease.slot, generation: generation)
        }

        XCTAssertEqual(count, Int(info.frameCount))
        XCTAssertGreaterThan(energy / Double(count), 0.005)
        XCTAssertLessThan(energy / Double(count), 0.1)
        await decoder.close(generation: generation)
    }

    private func makeTransport(channels: AVAudioChannelCount = 2, limiterEnabled: Bool = false) -> LocalAudioTransport {
        let configuration = LocalAudioConfiguration(output: .offline(sampleRate: 48_000, channels: channels, maximumFrames: 1024), blockFrames: 2048, bufferCount: 8, limiterEnabled: limiterEnabled)
        let transport = LocalAudioTransport(configuration: configuration)
        addTeardownBlock { await MainActor.run { transport.shutdown() } }
        return transport
    }

    private func outputBuffer(channels: AVAudioChannelCount) throws -> AVAudioPCMBuffer {
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: channels))
        return try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024))
    }

    private func capture(_ transport: LocalAudioTransport, channels: AVAudioChannelCount, slices: [AVAudioFrameCount]) async throws -> RenderedAudio {
        let buffer = try outputBuffer(channels: channels)
        var samples = Array(repeating: [Float](), count: Int(channels))
        var clock = [(frame: 0, position: transport.position)]
        for index in 0..<2048 {
            if transport.diagnostics.reachedEnd { break }
            let status = try await transport.renderOffline(frames: slices[index % slices.count], into: buffer)
            XCTAssertEqual(status, .success)
            guard status == .success else { throw LocalAudioError.cannotRender }
            for channel in 0..<Int(channels) {
                samples[channel].append(contentsOf: UnsafeBufferPointer(start: buffer.floatChannelData![channel], count: Int(buffer.frameLength)))
            }
            clock.append((frame: samples[0].count, position: transport.position))
        }
        XCTAssertTrue(transport.diagnostics.reachedEnd)
        return RenderedAudio(samples: samples, clock: clock)
    }

    private func fixture(frames: Int, channels: AVAudioChannelCount, compressed: Bool = false, signal: ((Int, Int) -> Float)? = nil) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(compressed ? "m4a" : "wav")
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: channels))
        var settings: [String: Any] = compressed ? [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 48_000,
            AVNumberOfChannelsKey: channels,
            AVEncoderBitRateKey: 128_000,
        ] : format.settings
        settings.removeValue(forKey: AVLinearPCMIsNonInterleaved)
        let file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512))
        for start in stride(from: 0, to: frames, by: 512) {
            buffer.frameLength = AVAudioFrameCount(min(512, frames - start))
            for channel in 0..<Int(channels) {
                let samples = try XCTUnwrap(buffer.floatChannelData?[channel])
                for frame in 0..<Int(buffer.frameLength) {
                    samples[frame] = signal?(start + frame, channel) ?? sample(frame: start + frame, channel: channel)
                }
            }
            try file.write(from: buffer)
        }
        return url
    }

    private func sample(frame: Int, channel: Int) -> Float {
        Float(sin(Double(frame) * (channel == 0 ? 0.071 : 0.113))) * (channel == 0 ? 0.25 : 0.4)
    }
}

private struct RenderedAudio {
    let samples: [[Float]]
    let clock: [(frame: Int, position: TimeInterval)]

    func sourceTime(at frame: Int) throws -> TimeInterval {
        let index = try XCTUnwrap(clock.indices.dropFirst().first { clock[$0].frame >= frame })
        let before = clock[index - 1]
        let after = clock[index]
        let fraction = Double(frame - before.frame) / Double(after.frame - before.frame)
        return before.position + (after.position - before.position) * fraction
    }
}
