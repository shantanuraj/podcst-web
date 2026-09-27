import Accelerate
import AVFoundation
import Darwin
import XCTest
@testable import Podcst

@MainActor
final class AudioValidationTests: XCTestCase {
    func testIndependentPeakMeterDetectsIntersampleOvershoot() {
        let samples = (0..<4096).map { frame -> Float in
            let envelope = min(1, Double(min(frame, 4095 - frame)) / 256)
            let phase = Double(frame) * Double.pi / 2 + Double.pi / 4
            return Float(sin(phase) * envelope)
        }
        XCTAssertEqual(samples.map { abs($0) }.max()!, Float(1 / sqrt(2)), accuracy: 0.00001)
        XCTAssertEqual(oversampledPeak(samples), 1, accuracy: 0.002)
        XCTAssertEqual(oversampledPeak(Array(repeating: 0, count: 1024)), 0)
    }

    func testFinalGraphCeilingAcrossRatesChannelsAndSampleRateConversion() async throws {
        var measurements: [String] = []
        for sourceRate in [44_100.0, 48_000.0] {
            for channels: AVAudioChannelCount in [1, 2] {
                let url = try pcmFile(sampleRate: sourceRate, channels: channels, frames: 16_384) { frame, channel in
                    let phase = Double(frame) + Double(channel) * 0.37
                    switch frame / 4096 {
                    case 0: return Float(1.7 * sin(phase * .pi / 2 + .pi / 4))
                    case 1: return Float(1.4 * sin(phase * .pi * 0.81) + 0.5 * sin(phase * 0.03))
                    case 2: return frame % 127 < 3 ? (channel == 0 ? 2.4 : -1.8) : 0
                    default: return Float(1.9 * sin(phase * .pi * 0.93))
                    }
                }
                for outputRate in [44_100.0, 48_000.0] {
                    for rate in PlaybackController.supportedRates {
                        let transport = makeTransport(sampleRate: outputRate, channels: channels)
                        defer { transport.shutdown() }
                        transport.load(source: .url(url), at: 0, generation: UUID())
                        try await transport.waitUntilReady()
                        transport.play(atRate: rate)
                        try await transport.waitUntilReady()
                        let output = try await render(transport, sampleRate: outputRate, channels: channels)
                        for channel in output {
                            XCTAssertTrue(channel.allSatisfy(\.isFinite))
                            let peak = oversampledPeak(channel)
                            let decibels = 20 * log10(max(peak, 0.000001))
                            measurements.append("\(sourceRate),\(outputRate),\(channels),\(rate),\(decibels)")
                            XCTAssertLessThanOrEqual(decibels, -0.8, "\(sourceRate) → \(outputRate), \(channels) channels, \(rate)×: \(decibels) dBTP")
                            XCTAssertGreaterThan(peak, 0.1)
                        }
                        XCTAssertEqual(transport.diagnostics.underruns, 0)
                    }
                }
            }
        }
        record("Final output peak measurements: source Hz, output Hz, channels, speed, dBTP", lines: measurements)
    }

    func testConvertedClockAndFinalMarkerSurviveEveryRate() async throws {
        for sourceRate in [44_100.0, 48_000.0] {
            let frames = Int(sourceRate)
            let markers = [frames / 4, frames / 2, frames * 3 / 4, frames - 1]
            let url = try pcmFile(sampleRate: sourceRate, channels: 1, frames: frames) { frame, _ in
                markers.contains(frame) ? 0.5 : 0
            }
            let outputRate = sourceRate == 48_000 ? 44_100.0 : 48_000.0
            for rate in PlaybackController.supportedRates {
                let transport = makeTransport(sampleRate: outputRate, channels: 1)
                defer { transport.shutdown() }
                transport.load(source: .url(url), at: 0, generation: UUID())
                try await transport.waitUntilReady()
                transport.play(atRate: rate)
                try await transport.waitUntilReady()
                let latency = Double(transport.diagnostics.limiterLatencyFrames)
                var clocks = [(frame: 0, source: 0.0)]
                let output = try await render(transport, sampleRate: outputRate, channels: 1, slice: 256) { frame in
                    clocks.append((frame, transport.position))
                }[0]
                for marker in markers {
                    let expected = Double(marker) / sourceRate * outputRate / rate + latency
                    let radius = outputRate * 0.05 / rate
                    let lower = max(0, Int(expected - radius))
                    let upper = min(output.count, Int(expected + radius) + 1)
                    guard lower < upper else { XCTFail("Missing final output at \(rate)×"); continue }
                    let peak = try XCTUnwrap((lower..<upper).max { abs(output[$0]) < abs(output[$1]) })
                    XCTAssertGreaterThan(abs(output[peak]), 0.01)
                    let index = try XCTUnwrap(clocks.indices.dropFirst().first { clocks[$0].frame >= peak })
                    let previous = clocks[index - 1]
                    let next = clocks[index]
                    let fraction = Double(peak - previous.frame) / Double(next.frame - previous.frame)
                    let observed = previous.source + (next.source - previous.source) * fraction
                    XCTAssertEqual(observed, Double(marker) / sourceRate, accuracy: 0.020, "\(sourceRate) → \(outputRate), \(rate)×")
                }
                XCTAssertEqual(transport.position, 1, accuracy: 1 / sourceRate)
                XCTAssertEqual(transport.diagnostics.underruns, 0)
            }
        }
    }

    func testGeneratedAACAndMP3DecodeThroughFinalGraph() async throws {
        for sampleRate in [44_100.0, 48_000.0] {
            for channels: AVAudioChannelCount in [1, 2] {
                let aac = try pcmFile(sampleRate: sampleRate, channels: channels, frames: Int(sampleRate / 2), compressed: true) { frame, channel in
                    Float(0.3 * sin(Double(frame) * (channel == 0 ? 0.07 : 0.11)))
                }
                let mp3 = temporaryURL(extension: "mp3")
                let bitrates = [(index: 9, kbps: 128), (index: 10, kbps: 160), (index: 7, kbps: 96), (index: 12, kbps: 224)]
                var bytes = Data()
                for frame in 0..<24 {
                    let bitrate = bitrates[frame % bitrates.count]
                    let frameBytes = 144_000 * bitrate.kbps / Int(sampleRate)
                    let header = UInt8(bitrate.index << 4 | (sampleRate == 44_100 ? 0 : 4))
                    bytes.append(contentsOf: [0xff, 0xfb, header, channels == 1 ? 0xc0 : 0])
                    bytes.append(Data(count: frameBytes - 4))
                }
                try bytes.write(to: mp3)
                for url in [aac, mp3] {
                    let transport = makeTransport(sampleRate: 48_000, channels: channels)
                    defer { transport.shutdown() }
                    transport.load(source: .url(url), at: 0, generation: UUID())
                    try await transport.waitUntilReady()
                    transport.play(atRate: 1)
                    let output = try await render(transport, sampleRate: 48_000, channels: channels)
                    XCTAssertEqual(transport.diagnostics.sourceSampleRate, sampleRate)
                    XCTAssertEqual(transport.diagnostics.underruns, 0)
                    XCTAssertGreaterThan(output[0].count, 20_000)
                    XCTAssertTrue(output.joined().allSatisfy(\.isFinite))
                    if url.pathExtension == "m4a" {
                        XCTAssertGreaterThan(output[0].map { abs($0) }.max() ?? 0, 0.1)
                    } else {
                        XCTAssertTrue(output.joined().allSatisfy { $0 == 0 })
                    }
                }
            }
        }
    }

    func testRepeatedGraphReplacementRejectsStaleEventsAndBoundsResidency() async throws {
        let url = try pcmFile(sampleRate: 48_000, channels: 2, frames: 96_000) { frame, _ in
            Float(0.25 * sin(Double(frame) * 0.09))
        }
        let transport = makeTransport(sampleRate: 48_000, channels: 2)
        defer { transport.shutdown() }
        let buffer = try outputBuffer(sampleRate: 48_000, channels: 2)
        var expectedGeneration = UUID()
        var accepted: [PlaybackTransportUpdate] = []
        transport.onUpdate = { accepted.append($0) }
        var residency: [UInt64] = []
        var maximumOwnedBytes: UInt64 = 0
        for iteration in 0..<72 {
            expectedGeneration = UUID()
            transport.load(source: .url(url), at: 0.1, generation: expectedGeneration)
            transport.seek(to: 0.2, generation: UUID())
            expectedGeneration = UUID()
            transport.seek(to: Double(iteration % 8) / 10, generation: expectedGeneration)
            accepted.removeAll(keepingCapacity: true)
            try await transport.waitUntilReady()
            transport.play(atRate: PlaybackController.supportedRates[iteration % PlaybackController.supportedRates.count])
            try await transport.waitUntilReady()
            for _ in 0..<4 { _ = try await transport.renderOffline(frames: 1024, into: buffer) }
            XCTAssertTrue(accepted.allSatisfy { $0.generation == expectedGeneration })
            XCTAssertFalse(accepted.contains { if case .ended = $0.event { true } else { false } })
            XCTAssertNil(transport.diagnostics.failure)
            maximumOwnedBytes = max(maximumOwnedBytes, transport.diagnostics.allocatedBytes)
            transport.pause()
            let paused = transport.position
            await Task.yield()
            XCTAssertEqual(transport.position, paused)
            transport.stop()
            XCTAssertFalse(transport.hasSource)
            XCTAssertEqual(transport.diagnostics.allocatedBytes, 0)
            try await Task.sleep(for: .milliseconds(2))
            if iteration >= 24 { residency.append(try residentBytes()) }
        }
        XCTAssertLessThan(maximumOwnedBytes, 8 * 1024 * 1024)
        let first = residency.prefix(12).max() ?? 0
        let last = residency.suffix(12).max() ?? 0
        XCTAssertLessThanOrEqual(last, first + 16 * 1024 * 1024)
        record("Graph replacement resident bytes after warm-up", lines: residency.map(String.init))
    }

    func testMalformedMediaFailsWithoutCompletionOrRetainingBuffers() async throws {
        let url = temporaryURL(extension: "mp3")
        try Data(repeating: 0xa5, count: 257).write(to: url)
        let transport = makeTransport(sampleRate: 48_000, channels: 2)
        defer { transport.shutdown() }
        var completions = 0
        var failures = 0
        transport.onUpdate = { update in
            switch update.event {
            case .failed: failures += 1
            case .ended: completions += 1
            default: break
            }
        }
        transport.load(source: .url(url), at: 0, generation: UUID())
        do {
            try await transport.waitUntilReady()
            XCTFail("Malformed compressed data became playable")
        } catch let error as LocalAudioError {
            XCTAssertEqual(error, .cannotDecode)
        }
        XCTAssertEqual(failures, 1)
        XCTAssertEqual(completions, 0)
        XCTAssertFalse(transport.diagnostics.isReady)
        XCTAssertEqual(transport.diagnostics.allocatedBytes, 0)
    }

    func testPauseResumePreservesRenderedPCMAtEveryRate() async throws {
        let url = try pcmFile(sampleRate: 48_000, channels: 2, frames: 96_000) { frame, channel in
            Float(0.3 * sin(Double(frame) * (channel == 0 ? 0.071 : 0.053)) + 0.1 * sin(Double(frame) * 0.003))
        }
        for rate in PlaybackController.supportedRates {
            var captures: [[[Float]]] = []
            for pauses in [false, true] {
                let transport = makeTransport(sampleRate: 48_000, channels: 2)
                defer { transport.shutdown() }
                transport.load(source: .url(url), at: 0, generation: UUID())
                try await transport.waitUntilReady()
                transport.play(atRate: rate)
                try await transport.waitUntilReady()
                captures.append(try await render(transport, sampleRate: 48_000, channels: 2, pauseRate: pauses ? rate : nil))
                XCTAssertEqual(transport.diagnostics.underruns, 0)
            }
            for channel in 0..<2 {
                let uninterrupted = captures[0][channel]
                let resumed = captures[1][channel]
                XCTAssertEqual(uninterrupted.count, resumed.count, "Pause/resume changed duration at \(rate)×")
                let difference = zip(uninterrupted, resumed).enumerated().first { $0.element.0 != $0.element.1 }
                XCTAssertNil(difference, "Pause/resume changed rendered audio at \(rate)×, channel \(channel)")
            }
        }
    }

    private func record(_ name: String, lines: [String]) {
        let attachment = XCTAttachment(string: lines.joined(separator: "\n"))
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func makeTransport(sampleRate: Double, channels: AVAudioChannelCount) -> LocalAudioTransport {
        LocalAudioTransport(configuration: LocalAudioConfiguration(output: .offline(sampleRate: sampleRate, channels: channels, maximumFrames: 1024)))
    }

    private func outputBuffer(sampleRate: Double, channels: AVAudioChannelCount) throws -> AVAudioPCMBuffer {
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: channels))
        return try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024))
    }

    private func render(_ transport: LocalAudioTransport, sampleRate: Double, channels: AVAudioChannelCount, slice: AVAudioFrameCount = 1024, pauseRate: Double? = nil, observe: ((Int) -> Void)? = nil) async throws -> [[Float]] {
        let buffer = try outputBuffer(sampleRate: sampleRate, channels: channels)
        var output = Array(repeating: [Float](), count: Int(channels))
        for block in 0..<2048 {
            if transport.diagnostics.reachedEnd { break }
            if let pauseRate, [17, 33, 65, 129].contains(block) {
                transport.pause()
                let position = transport.position
                await Task.yield()
                XCTAssertEqual(transport.position, position)
                transport.play(atRate: pauseRate)
                try await transport.waitUntilReady()
            }
            let status = try await transport.renderOffline(frames: slice, into: buffer)
            XCTAssertEqual(status, .success)
            guard status == .success else { throw LocalAudioError.cannotRender }
            for channel in 0..<Int(channels) {
                output[channel].append(contentsOf: UnsafeBufferPointer(start: buffer.floatChannelData![channel], count: Int(buffer.frameLength)))
            }
            observe?(output[0].count)
        }
        XCTAssertTrue(transport.diagnostics.reachedEnd)
        return output
    }

    private func pcmFile(sampleRate: Double, channels: AVAudioChannelCount, frames: Int, compressed: Bool = false, signal: (Int, Int) -> Float) throws -> URL {
        let url = temporaryURL(extension: compressed ? "m4a" : "wav")
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: channels))
        var settings: [String: Any] = compressed ? [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: sampleRate, AVNumberOfChannelsKey: channels, AVEncoderBitRateKey: 128_000] : format.settings
        settings.removeValue(forKey: AVLinearPCMIsNonInterleaved)
        let file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024))
        for start in stride(from: 0, to: frames, by: 1024) {
            buffer.frameLength = AVAudioFrameCount(min(1024, frames - start))
            for channel in 0..<Int(channels) {
                for frame in 0..<Int(buffer.frameLength) { buffer.floatChannelData![channel][frame] = signal(start + frame, channel) }
            }
            try file.write(from: buffer)
        }
        return url
    }

    private func temporaryURL(extension suffix: String) -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(suffix)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    private func oversampledPeak(_ samples: [Float]) -> Double {
        let taps = 64
        let padding = taps / 2
        let input = Array(repeating: Float(0), count: padding) + samples + Array(repeating: Float(0), count: padding)
        var output = Array(repeating: Float(0), count: samples.count)
        var peak = samples.map { abs($0) }.max() ?? 0
        for phase in 1..<16 {
            let offset = Double(phase) / 16
            var filter = (0..<taps).map { index -> Float in
                let t = Double(index - padding) - offset
                let sinc = abs(t) < 0.00000001 ? 1 : sin(.pi * t) / (.pi * t)
                let window = abs(t) >= 32 ? 0 : 0.42 + 0.5 * cos(.pi * t / 32) + 0.08 * cos(2 * .pi * t / 32)
                return Float(sinc * window)
            }
            let normalization = filter.reduce(0, +)
            for index in filter.indices { filter[index] /= normalization }
            vDSP_conv(input, 1, filter, 1, &output, 1, vDSP_Length(output.count), vDSP_Length(taps))
            var phasePeak: Float = 0
            vDSP_maxmgv(output, 1, &phasePeak, vDSP_Length(output.count))
            peak = max(peak, phasePeak)
        }
        return Double(peak)
    }

    private func residentBytes() throws -> UInt64 {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }
        XCTAssertEqual(result, KERN_SUCCESS)
        return info.resident_size
    }
}
