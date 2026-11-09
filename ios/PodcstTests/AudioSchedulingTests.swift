import AVFoundation
import Darwin
import XCTest
@testable import Podcst

@MainActor
final class AudioSchedulingTests: XCTestCase {
    func testProgressivePlaybackCoversRangeLatencyAtNormalSpeed() async throws {
        try await delayedProgressivePlayback(rate: 1, effects: AudioEffects())
    }

    func testProgressivePlaybackCoversRangeLatencyAtDoubleSpeedWithEffects() async throws {
        try await delayedProgressivePlayback(rate: 2, effects: AudioEffects(volumeBoost: true, trimSilence: true))
    }

    func testProgressiveResumeNearRangeBoundaryWaitsForColdReadAhead() async throws {
        try await delayedProgressivePlayback(rate: 1, effects: AudioEffects(), position: 6, delay: 1.4)
    }

    func testDevicePlaybackSurvivesRepeatedMainThreadStallsWithBothEffects() async throws {
        let url = try fixture()
        defer { try? FileManager.default.removeItem(at: url) }
        try await PlaybackAudioSession.prepare(forPlayback: true)
        let transport = LocalAudioTransport()
        defer { transport.shutdown() }
        var preparations = 0
        transport.onUpdate = { update in
            if case .ready = update.event { preparations += 1 }
        }
        transport.setEffects(AudioEffects(volumeBoost: true, trimSilence: true))
        transport.load(source: .url(url), at: 0, generation: UUID())
        try await transport.waitUntilReady()
        transport.play(atRate: 1)
        try await Task.sleep(for: .milliseconds(400))
        XCTAssertTrue(transport.diagnostics.isPlaying)
        let start = transport.position
        for _ in 0..<3 {
            usleep(600_000)
            try await Task.sleep(for: .milliseconds(400))
        }
        XCTAssertEqual(transport.diagnostics.underruns, 0)
        XCTAssertEqual(preparations, 1)
        XCTAssertNil(transport.diagnostics.failure)
        XCTAssertTrue(transport.diagnostics.isPlaying)
        XCTAssertGreaterThan(transport.position - start, 2.7)
    }

    private func delayedProgressivePlayback(rate: Double, effects: AudioEffects, position: Double = 0, delay: TimeInterval = 0.3) async throws {
        let fixture = try XCTUnwrap(Bundle(for: AudioSchedulingTests.self).url(forResource: "progressive-cbr", withExtension: "mp3"))
        let data = try Data(contentsOf: fixture)
        let server = try MediaHTTPServer(data: data, delay: delay)
        let url = try await server.start()
        defer { server.stop() }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("streaming-regression-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        let trace = try await PlaybackTraceRecorder.shared.start(directory: directory.appendingPathComponent("trace"))
        let source = try HTTPMediaByteSource(url: url, directory: directory)
        let configuration = LocalAudioConfiguration(output: .offline(sampleRate: 48_000, channels: 2, maximumFrames: 480))
        let decoder = ProgressiveAudioDecoder(source: source, blockFrames: configuration.blockFrames, bufferCount: configuration.bufferCount)
        let transport = LocalAudioTransport(configuration: configuration, sourceDecoder: decoder)
        defer { transport.shutdown() }
        var preparations = 0
        transport.onUpdate = { update in
            if case .ready = update.event { preparations += 1 }
        }
        transport.setEffects(effects)
        transport.setRate(rate)
        transport.load(source: .url(url), at: position, generation: UUID())
        try await transport.waitUntilReady()
        transport.play(atRate: rate)
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 2))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 480))
        let clock = ContinuousClock()
        let started = clock.now
        var deadline = started
        var rendered: UInt64 = 0
        let duration = (35 - position) / rate
        let target = UInt64(ceil(duration * 48_000))
        while rendered < target {
            let status = try await transport.renderOffline(frames: 480, into: buffer, awaitingDecodedBuffers: false)
            XCTAssertNotEqual(status, .error)
            if status == .success { rendered += UInt64(buffer.frameLength) }
            if transport.diagnostics.underruns > 0 || transport.diagnostics.failure != nil { break }
            deadline = max(deadline + .milliseconds(10), clock.now)
            try await clock.sleep(until: deadline)
        }
        let state = transport.diagnostics
        let finalPosition = transport.position
        await transport.shutdownAndWait()
        await source.cancel()
        _ = await PlaybackTraceRecorder.shared.stop()
        if state.underruns > 0 || state.failure != nil {
            let attachment = XCTAttachment(data: try Data(contentsOf: trace), uniformTypeIdentifier: "public.jsonl")
            attachment.name = "Progressive playback trace"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        XCTAssertNil(state.failure)
        XCTAssertEqual(state.underruns, 0, "Rendering must continue while delayed ranges are fetched")
        XCTAssertEqual(preparations, 1, "Streaming must not rebuild the graph at range boundaries")
        XCTAssertGreaterThan(finalPosition, 34)
        XCTAssertEqual(rendered, target)
        XCTAssertLessThan(started.duration(to: clock.now), .seconds(duration + 3), "The driver must not hide network waits by pausing rendering")
        for index in 1...5 {
            let first = index * HTTPMediaByteSource.blockSize
            let range = "bytes=\(first)-\(first + HTTPMediaByteSource.blockSize - 1)"
            XCTAssertEqual(server.requests.filter { $0["range"] == range }.count, 1, "Each crossed range must be fetched once")
        }
    }

    private func fixture() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("wav")
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 48_000))
        buffer.frameLength = buffer.frameCapacity
        for frame in 0..<Int(buffer.frameLength) {
            buffer.floatChannelData![0][frame] = Float(0.015 * sin(Double(frame) * 2 * .pi * 317 / 48_000))
        }
        let file = try AVAudioFile(forWriting: url, settings: format.settings)
        for _ in 0..<12 { try file.write(from: buffer) }
        return url
    }
}
