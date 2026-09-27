import AVFoundation
import XCTest
@testable import Podcst

@MainActor
final class EffectsPeakTests: XCTestCase {
    func testWarmedEffectsRespectFinalCeilingAcrossSpeedsChannelsAndConversion() async throws {
        var measurements: [String] = []
        for (sourceRate, outputRate) in [(44_100.0, 48_000.0), (48_000.0, 44_100.0)] {
            for channels: AVAudioChannelCount in [1, 2] {
                let url = try fixture(sampleRate: sourceRate, channels: channels)
                let inputRMS = (0..<Int(channels)).map { channel in
                    let input = (Int(sourceRate * 3.3)..<Int(sourceRate * 3.9)).map {
                        Double(sample(frame: $0, channel: channel, sampleRate: sourceRate))
                    }
                    return sqrt(input.reduce(0) { $0 + $1 * $1 } / Double(input.count))
                }
                for rate in PlaybackController.supportedRates {
                    let context = "\(sourceRate) → \(outputRate), \(channels) channels, \(rate)×"
                    let transport = LocalAudioTransport(configuration: LocalAudioConfiguration(
                        output: .offline(sampleRate: outputRate, channels: channels, maximumFrames: 1024)
                    ))
                    defer { transport.shutdown() }
                    transport.setEffects(AudioEffects(volumeBoost: true, trimSilence: true))
                    transport.load(source: .url(url), at: 0, generation: UUID())
                    try await transport.waitUntilReady()
                    transport.play(atRate: rate)
                    let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: outputRate, channels: channels))
                    let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024))
                    var output = Array(repeating: [Float](), count: Int(channels))
                    var speechEnergy = Array(repeating: 0.0, count: Int(channels))
                    var speechFrames = 0
                    var largestSourceJump = 0.0
                    for _ in 0..<2048 {
                        if transport.diagnostics.reachedEnd { break }
                        let before = transport.position
                        let status = try await transport.renderOffline(frames: 1024, into: buffer)
                        XCTAssertEqual(status, .success, context)
                        guard status == .success else { throw LocalAudioError.cannotRender }
                        let after = transport.position
                        let frames = Int(buffer.frameLength)
                        largestSourceJump = max(largestSourceJump, after - before - Double(frames) / outputRate * rate)
                        let steadySpeech = before >= 3.3 && after <= 3.9
                        for channel in 0..<Int(channels) {
                            let samples = UnsafeBufferPointer(start: buffer.floatChannelData![channel], count: frames)
                            output[channel].append(contentsOf: samples)
                            if steadySpeech {
                                speechEnergy[channel] += samples.reduce(0) { $0 + Double($1) * Double($1) }
                            }
                        }
                        if steadySpeech { speechFrames += frames }
                    }
                    XCTAssertTrue(transport.diagnostics.reachedEnd, context)
                    XCTAssertEqual(transport.diagnostics.underruns, 0, context)
                    XCTAssertGreaterThan(speechFrames, Int(outputRate * 0.1 / rate), context)
                    XCTAssertGreaterThan(largestSourceJump, 0.2, "Trim did not remove the warmed-up pause: \(context)")
                    for channel in 0..<Int(channels) {
                        XCTAssertTrue(output[channel].allSatisfy(\.isFinite), context)
                        let gain = sqrt(speechEnergy[channel] / Double(max(1, speechFrames))) / inputRMS[channel]
                        XCTAssertGreaterThan(gain, 1.5, "Boost did not raise steady speech: \(context), channel \(channel), gain \(gain)")
                        let peak = AudioOutputMeter.peak(output[channel])
                        let decibels = 20 * log10(max(peak, 0.000001))
                        XCTAssertLessThanOrEqual(decibels, -0.8, "\(context), channel \(channel): \(decibels) dBTP")
                        XCTAssertGreaterThan(peak, 0.5, "Transient did not exercise the limiter: \(context), channel \(channel)")
                        measurements.append("\(context), channel \(channel): speech gain \(20 * log10(gain)) dB, peak \(decibels) dBTP, trim jump \(largestSourceJump) s")
                    }
                }
            }
        }
        let attachment = XCTAttachment(string: measurements.joined(separator: "\n"))
        attachment.name = "Warmed Volume Boost and Trim Silence: final output measurements"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func fixture(sampleRate: Double, channels: AVAudioChannelCount) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("wav")
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: channels))
        var settings = format.settings
        settings.removeValue(forKey: AVLinearPCMIsNonInterleaved)
        let file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024))
        let frames = Int(sampleRate * 5) + 16_384
        for start in stride(from: 0, to: frames, by: 1024) {
            buffer.frameLength = AVAudioFrameCount(min(1024, frames - start))
            for channel in 0..<Int(channels) {
                for frame in 0..<Int(buffer.frameLength) {
                    buffer.floatChannelData![channel][frame] = sample(frame: start + frame, channel: channel, sampleRate: sampleRate)
                }
            }
            try file.write(from: buffer)
        }
        return url
    }

    private func sample(frame: Int, channel: Int, sampleRate: Double) -> Float {
        let time = Double(frame) / sampleRate
        if time < 5 {
            let level = time >= 4 || time.truncatingRemainder(dividingBy: 1) < 0.2 ? 0.00001 : 0.05
            let envelope = 0.65 + 0.35 * pow(sin(2 * .pi * 2.3 * time), 2)
            let phase = 2 * .pi * 180 * time
            let speech = sin(phase) + 0.45 * sin(phase * 2) + 0.2 * sin(phase * 4)
            return Float(level * envelope * speech * (channel == 0 ? 1 : -0.75))
        }
        let offset = frame - Int(sampleRate * 5)
        let phase = Double(offset) + Double(channel) * 0.37
        switch offset / 4096 {
        case 0: return Float(1.7 * sin(phase * .pi / 2 + .pi / 4))
        case 1: return Float(1.4 * sin(phase * .pi * 0.81) + 0.5 * sin(phase * 0.03))
        case 2: return offset % 127 < 3 ? (channel == 0 ? 2.4 : -1.8) : 0
        default: return Float(1.9 * sin(phase * .pi * 0.93))
        }
    }
}
