import AVFoundation
import XCTest
@testable import Podcst

@MainActor
final class EffectsIntegrationTests: XCTestCase {
    func testBothEffectsPreserveRenderedSamplesAndOriginalSourceTime() async throws {
        let frames = 48_000 * 20 + 13
        let url = try fixture(frames: frames, pauses: true)
        let effects = AudioEffects(volumeBoost: true, trimSilence: true)
        let reference = try await processedReference(url, effects: effects)
        XCTAssertLessThan(reference.samples.count, frames - 24_000)
        XCTAssertGreaterThanOrEqual(reference.samples.count, frames - 72_000)
        let transport = makeTransport()
        defer { transport.shutdown() }
        transport.setEffects(effects)
        var completions = 0
        transport.onUpdate = { if case .ended = $0.event { completions += 1 } }
        transport.load(source: .url(url), at: 0, generation: UUID())
        try await transport.waitUntilReady()
        transport.play(atRate: 1)
        let buffer = try outputBuffer()
        let latency = Int(transport.diagnostics.limiterLatencyFrames)
        var rendered = 0
        var maximumError: Float = 0
        var maximumBytes: UInt64 = 0
        for _ in 0..<5000 {
            if transport.diagnostics.reachedEnd { break }
            let status = try await transport.renderOffline(frames: 997, into: buffer)
            XCTAssertEqual(status, .success)
            let samples = try XCTUnwrap(buffer.floatChannelData?[0])
            for frame in 0..<Int(buffer.frameLength) {
                let index = rendered + frame - latency
                let expected: Float = reference.samples.indices.contains(index) ? reference.samples[index] : 0
                maximumError = max(maximumError, abs(samples[frame] - expected))
            }
            rendered += Int(buffer.frameLength)
            let expectedSource = reference.source(at: max(0, rendered - latency))
            XCTAssertEqual(transport.position, Double(expectedSource) / 48_000, accuracy: 0.010)
            maximumBytes = max(maximumBytes, transport.diagnostics.allocatedBytes)
        }
        XCTAssertTrue(transport.diagnostics.reachedEnd)
        XCTAssertEqual(completions, 1)
        XCTAssertLessThan(maximumError, 0.000001)
        XCTAssertEqual(transport.position, Double(frames) / 48_000, accuracy: 1 / 48_000)
        XCTAssertEqual(transport.diagnostics.underruns, 0)
        XCTAssertLessThan(maximumBytes, 8 * 1024 * 1024)
    }

    func testEffectsReachPresentedTimelineWithinBudgetAtEveryRate() async throws {
        let url = try fixture(frames: 48_000 * 8, pauses: false)
        let requests = [
            AudioEffects(volumeBoost: true),
            AudioEffects(volumeBoost: true, trimSilence: true),
            AudioEffects(trimSilence: true),
            AudioEffects()
        ]
        for rate in PlaybackController.supportedRates {
            let transport = makeTransport()
            defer { transport.shutdown() }
            transport.load(source: .url(url), at: 0, generation: UUID())
            try await transport.waitUntilReady()
            transport.play(atRate: rate)
            try await transport.waitUntilReady()
            let buffer = try outputBuffer()
            for _ in 0..<24 { _ = try await transport.renderOffline(frames: 1024, into: buffer) }
            var heard: AudioEffects?
            var appliedAt: UInt64 = 0
            transport.onUpdate = { update in
                if case .effects(.active(let effects)) = update.event {
                    heard = effects
                    appliedAt = transport.diagnostics.renderedFrames
                }
            }
            for request in requests {
                heard = nil
                let requestedAt = transport.diagnostics.renderedFrames
                transport.setEffects(request)
                for _ in 0..<100 {
                    _ = try await transport.renderOffline(frames: 256, into: buffer)
                    if heard == request { break }
                }
                XCTAssertEqual(heard, request, "Effects never became active at \(rate)×")
                if heard == request {
                    XCTAssertLessThanOrEqual(Double(appliedAt - requestedAt) / 48_000, 0.300, "Setting application at \(rate)×")
                }
                XCTAssertNil(transport.diagnostics.failure)
                XCTAssertEqual(transport.diagnostics.underruns, 0)
            }
        }
    }

    func testSeekIntoTrimmedPauseReopensOriginalSourceAndCompletesOnce() async throws {
        let frames = 48_000 * 20
        let url = try fixture(frames: frames, pauses: true)
        let transport = makeTransport()
        defer { transport.shutdown() }
        transport.setEffects(AudioEffects(volumeBoost: true, trimSilence: true))
        transport.load(source: .url(url), at: 0, generation: UUID())
        try await transport.waitUntilReady()
        transport.play(atRate: 1)
        let buffer = try outputBuffer()
        for _ in 0..<300 { _ = try await transport.renderOffline(frames: 1024, into: buffer) }
        let generation = UUID()
        transport.seek(to: 8, generation: generation)
        var completions: [UUID] = []
        transport.onUpdate = { if case .ended = $0.event { completions.append($0.generation) } }
        try await transport.waitUntilReady()
        XCTAssertEqual(transport.position, 8, accuracy: 1 / 48_000)
        for _ in 0..<1000 {
            if transport.diagnostics.reachedEnd { break }
            _ = try await transport.renderOffline(frames: 1024, into: buffer)
        }
        XCTAssertEqual(completions, [generation])
        XCTAssertEqual(transport.position, 20, accuracy: 1 / 48_000)
        XCTAssertEqual(transport.diagnostics.underruns, 0)
    }

    private func makeTransport() -> LocalAudioTransport {
        LocalAudioTransport(configuration: LocalAudioConfiguration(output: .offline(sampleRate: 48_000, channels: 1, maximumFrames: 1024)))
    }

    private func outputBuffer() throws -> AVAudioPCMBuffer {
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1))
        return try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024))
    }

    private func fixture(frames: Int, pauses: Bool) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("wav")
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        let buffer = try outputBuffer()
        let file = try AVAudioFile(forWriting: url, settings: buffer.format.settings)
        for start in stride(from: 0, to: frames, by: 1024) {
            buffer.frameLength = AVAudioFrameCount(min(1024, frames - start))
            for frame in 0..<Int(buffer.frameLength) {
                let source = start + frame
                let time = Double(source) / 48_000
                let level: Double = pauses && (5..<15).contains(time) ? 0.00001 : pauses && source % 48_000 < 12_000 ? 0.0001 : 0.06
                buffer.floatChannelData![0][frame] = Float(level * sin(2 * .pi * 317 * time))
            }
            try file.write(from: buffer)
        }
        return url
    }

    private func processedReference(_ url: URL, effects: AudioEffects) async throws -> ProcessedReference {
        let decoder = AudioProcessingDecoder(source: LocalAudioDecoder(blockFrames: 257, bufferCount: 2), blockFrames: 257, bufferCount: 2)
        let generation = UUID()
        try await decoder.configure(effects, revision: 1)
        let info = try await decoder.open(url: url, at: 0, generation: generation)
        var samples: [Float] = []
        var spans: [AudioSourceSpan] = []
        for _ in 0..<5000 {
            let block = try await decoder.read(slot: 0, generation: generation)
            let offset = Int64(samples.count)
            spans.append(contentsOf: block.spans.map { AudioSourceSpan(sourceStart: $0.sourceStart, outputStart: offset + $0.outputStart, frameCount: $0.frameCount) })
            samples.append(contentsOf: UnsafeBufferPointer(start: block.lease.buffer.floatChannelData![0], count: Int(block.lease.buffer.frameLength)))
            await decoder.release(slot: 0, generation: generation)
            if block.endOfFile { break }
        }
        await decoder.close(generation: generation)
        return ProcessedReference(samples: samples, spans: spans, sourceEnd: Int(info.frameCount))
    }
}

private struct ProcessedReference {
    let samples: [Float]
    let spans: [AudioSourceSpan]
    let sourceEnd: Int

    func source(at frame: Int) -> Int {
        guard frame < samples.count, let span = spans.first(where: { $0.outputStart + $0.frameCount > frame }) else { return sourceEnd }
        return Int(span.sourceStart) + max(0, frame - Int(span.outputStart))
    }
}
