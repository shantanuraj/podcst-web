import AVFoundation
import Darwin
import XCTest
@testable import Podcst

@MainActor
final class AudioSchedulingTests: XCTestCase {
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
