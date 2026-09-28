import AVFoundation
import XCTest
@testable import Podcst

@MainActor
final class AudioComparisonTests: XCTestCase {
    func testPassageBoundsAndIdenticalWarmUp() throws {
        let middle = try XCTUnwrap(AudioComparisonPassage.around(12, duration: 120))
        XCTAssertEqual(middle.start, 12)
        XCTAssertEqual(middle.end, 32)
        XCTAssertEqual(middle.warmUpStart, 9)
        XCTAssertEqual(middle.warmUpDuration, 3)
        let beginning = try XCTUnwrap(AudioComparisonPassage.around(1, duration: 120, length: 30))
        XCTAssertEqual(beginning.warmUpStart, 0)
        XCTAssertEqual(beginning.warmUpDuration, 1)
        let ending = try XCTUnwrap(AudioComparisonPassage.around(119, duration: 120, length: 30))
        XCTAssertEqual(ending.start, 90)
        XCTAssertEqual(ending.end, 120)
        let short = try XCTUnwrap(AudioComparisonPassage.around(0, duration: 4))
        XCTAssertEqual(short.duration, 4)
        XCTAssertNil(AudioComparisonPassage.around(.nan, duration: 120))
        XCTAssertNil(AudioComparisonPassage.around(0, duration: .infinity))
        XCTAssertThrowsError(try AudioComparisonPassage(start: 0, end: 31))
        XCTAssertThrowsError(try AudioComparisonPassage(start: 0, end: 0.1))
        XCTAssertThrowsError(try AudioComparisonPassage(start: -1, end: 10))
    }

    func testMatchingOnlyAttenuatesAndRequiresEveryMeasurement() throws {
        XCTAssertEqual(try XCTUnwrap(AudioComparisonReport.attenuation(loudness: -12, target: -18)), Float(pow(10, -6.0 / 20)), accuracy: 0.00001)
        XCTAssertEqual(AudioComparisonReport.attenuation(loudness: -18, target: -12), 1)
        XCTAssertNil(AudioComparisonReport.attenuation(loudness: .nan, target: -18))
        XCTAssertNil(AudioComparisonReport.attenuation(loudness: -18, target: .infinity))
        let passage = try AudioComparisonPassage(start: 0, end: 10)
        let measurements = AudioComparisonPreset.allCases.map { preset in
            AudioComparisonMeasurement(preset: preset, duration: 10, metrics: AudioSignalMetrics(integratedLUFS: preset == .off ? -24 : -16))
        }
        let report = AudioComparisonReport(passage: passage, speed: 1, sampleRate: 48_000, measurements: measurements)
        XCTAssertEqual(report.matchedTargetLUFS, -24)
        XCTAssertEqual(report.attenuation(for: .off), 1)
        XCTAssertLessThan(try XCTUnwrap(report.attenuation(for: .both)), 0.4)
        let partial = AudioComparisonReport(passage: passage, speed: 1, sampleRate: 48_000, measurements: Array(measurements.dropLast()))
        XCTAssertNil(partial.matchedTargetLUFS)
        XCTAssertNil(partial.attenuation(for: .off))
    }

    func testSilenceCannotBePresentedAsLoudnessMatched() throws {
        let report = AudioComparisonReport(
            passage: try AudioComparisonPassage(start: 0, end: 10),
            speed: 1,
            sampleRate: 48_000,
            measurements: AudioComparisonPreset.allCases.map { AudioComparisonMeasurement(preset: $0, duration: 10, metrics: AudioSignalMetrics()) }
        )
        XCTAssertNil(report.matchedTargetLUFS)
        XCTAssertNil(report.attenuation(for: .both))
        let data = try JSONEncoder().encode(report)
        let decoded = try JSONDecoder().decode(AudioComparisonReport.self, from: data)
        XCTAssertEqual(decoded.passage, report.passage)
        XCTAssertEqual(decoded.measurements.count, 4)
    }

    func testRendererRejectsNetworkAndInvalidRateBeforeOpeningSource() async throws {
        let passage = try AudioComparisonPassage(start: 0, end: 10)
        for (url, rate) in [(URL(string: "https://example.invalid/private-token.mp3")!, 1.0), (URL(fileURLWithPath: "/not-used.wav"), Double.nan)] {
            do {
                _ = try await AudioComparisonRenderer.render(sourceURL: url, passage: passage, rate: rate)
                XCTFail("Expected unavailable source")
            } catch AudioComparisonError.unavailableSource {
            }
        }
    }

    func testProductionRendersMeasureBoostTrimAndPreserveSourcePassage() async throws {
        let sourceURL = try fixture()
        let passage = try AudioComparisonPassage(start: 3, end: 13)
        let rendered = try await AudioComparisonRenderer.render(sourceURL: sourceURL, passage: passage, rate: 1.5)
        defer { try? FileManager.default.removeItem(at: rendered.directory) }
        let measurements = rendered.report.measurements
        let off = try XCTUnwrap(measurements.first(where: { $0.preset == .off }))
        let boost = try XCTUnwrap(measurements.first(where: { $0.preset == .boost }))
        let trim = try XCTUnwrap(measurements.first(where: { $0.preset == .trim }))
        XCTAssertEqual(measurements.count, 4)
        XCTAssertEqual(off.duration, passage.duration / 1.5, accuracy: 0.025)
        XCTAssertGreaterThan(try XCTUnwrap(boost.metrics.integratedLUFS), try XCTUnwrap(off.metrics.integratedLUFS) + 3)
        XCTAssertLessThan(trim.duration, off.duration - 0.1)
        let target = try XCTUnwrap(rendered.report.matchedTargetLUFS)
        for measurement in measurements {
            let attenuation = try XCTUnwrap(rendered.report.attenuation(for: measurement.preset))
            let loudness = try XCTUnwrap(measurement.metrics.integratedLUFS)
            XCTAssertEqual(loudness + 20 * log10(Double(attenuation)), target, accuracy: 0.0001)
            XCTAssertLessThanOrEqual(attenuation, 1)
            XCTAssertEqual(measurement.metrics.nonFiniteSampleCount, 0)
            let file = try AVAudioFile(forReading: XCTUnwrap(rendered.files[measurement.preset]))
            XCTAssertEqual(Double(file.length) / file.processingFormat.sampleRate, measurement.duration, accuracy: 1 / 48_000)
        }
        let json = try XCTUnwrap(String(data: JSONEncoder().encode(rendered.report), encoding: .utf8))
        XCTAssertFalse(json.contains(sourceURL.path))
        XCTAssertFalse(json.contains("file:"))
    }

    private func fixture() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("wav")
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1))
        var settings = format.settings
        settings.removeValue(forKey: AVLinearPCMIsNonInterleaved)
        let file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024))
        for start in stride(from: 0, to: 16_000 * 15, by: 1024) {
            buffer.frameLength = AVAudioFrameCount(min(1024, 16_000 * 15 - start))
            for frame in 0..<Int(buffer.frameLength) {
                let time = Double(start + frame) / 16_000
                let phase = 2 * Double.pi * 180 * time
                let level = time.truncatingRemainder(dividingBy: 3) < 1 ? 0.00001 : 0.045
                buffer.floatChannelData![0][frame] = Float(level * (sin(phase) + 0.4 * sin(phase * 2) + 0.15 * sin(phase * 4)))
            }
            try file.write(from: buffer)
        }
        return url
    }
}
