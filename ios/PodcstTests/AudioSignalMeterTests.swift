import Foundation
import XCTest
@testable import Podcst

final class AudioSignalMeterTests: XCTestCase {
    func testCalibratedMonoAndStereoLoudnessAcrossSampleRates() throws {
        for rate in [44_100.0, 48_000.0, 96_000.0] {
            for channels in [1, 2] {
                var meter = AudioSignalMeter(sampleRate: rate, channels: channels)
                meter.process(sine(rate: rate, channels: channels, seconds: 4, amplitude: 0.1))
                let result = meter.finish()
                let expected = -23.0036 + (channels == 2 ? 3.0103 : 0)
                XCTAssertEqual(try XCTUnwrap(result.integratedLUFS), expected, accuracy: 0.03)
                XCTAssertEqual(try XCTUnwrap(result.momentaryLUFS), expected, accuracy: 0.03)
                XCTAssertEqual(try XCTUnwrap(result.shortTermLUFS), expected, accuracy: 0.03)
                XCTAssertEqual(try XCTUnwrap(result.rmsDBFS), -23.0103, accuracy: 0.001)
                XCTAssertEqual(try XCTUnwrap(result.samplePeakDBFS), -20, accuracy: 0.001)
            }
        }
    }

    func testLoudnessAndTruePeakAreIndependentOfChunkBoundaries() throws {
        let samples = sine(rate: 48_000, channels: 2, seconds: 4, amplitude: 0.73, frequency: 11_123)
        var whole = AudioSignalMeter(sampleRate: 48_000, channels: 2)
        whole.process(samples)
        let expected = whole.finish()
        var split = AudioSignalMeter(sampleRate: 48_000, channels: 2)
        for start in stride(from: 0, to: samples.count, by: 514) {
            split.process(Array(samples[start..<min(start + 514, samples.count)]), outputStartFrame: UInt64(start / 2))
        }
        let result = split.finish()
        XCTAssertEqual(try XCTUnwrap(result.integratedLUFS), try XCTUnwrap(expected.integratedLUFS), accuracy: 0.000_001)
        XCTAssertEqual(try XCTUnwrap(result.maximumEstimatedTruePeakDBTP), try XCTUnwrap(expected.maximumEstimatedTruePeakDBTP), accuracy: 0.000_001)
        XCTAssertEqual(result.measuredFrames, expected.measuredFrames)
        XCTAssertEqual(result.discontinuityCount, 0)
    }

    func testAbsoluteAndRelativeGatesRejectSilenceAndLowLevelProgramme() throws {
        let audible = sine(rate: 48_000, channels: 1, seconds: 4, amplitude: 0.1)
        var reference = AudioSignalMeter(sampleRate: 48_000, channels: 1)
        reference.process(audible)
        var gated = AudioSignalMeter(sampleRate: 48_000, channels: 1)
        gated.process(audible)
        gated.process(sine(rate: 48_000, channels: 1, seconds: 12, amplitude: 0.0001))
        gated.process([Float](repeating: 0, count: 480_000))
        XCTAssertEqual(try XCTUnwrap(gated.metrics.integratedLUFS), try XCTUnwrap(reference.metrics.integratedLUFS), accuracy: 0.2)
        var belowGate = AudioSignalMeter(sampleRate: 48_000, channels: 1)
        belowGate.process(sine(rate: 48_000, channels: 1, seconds: 1, amplitude: 0.00001))
        XCTAssertNil(belowGate.metrics.integratedLUFS)
    }

    func testOversampledPeakFindsIntersampleMaximum() throws {
        var meter = AudioSignalMeter(sampleRate: 48_000, channels: 1)
        let samples = (0..<48_000).map { frame -> Float in
            let envelope = min(1.0, Double(min(frame, 47_999 - frame)) / 480)
            return Float(0.95 * envelope * sin(2 * .pi * Double(frame) / 4 + .pi / 4))
        }
        meter.process(samples)
        let result = meter.finish()
        XCTAssertEqual(try XCTUnwrap(result.maximumSamplePeakDBFS), 20 * log10(0.95 / sqrt(2)), accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(result.maximumEstimatedTruePeakDBTP), 20 * log10(0.95), accuracy: 0.03)
    }

    func testSilenceShortWindowsAndNonfiniteSamplesExportSafely() throws {
        var meter = AudioSignalMeter(sampleRate: 48_000, channels: 1)
        let silent = meter.process([Float](repeating: 0, count: 4_800))
        XCTAssertNil(silent.rmsDBFS)
        XCTAssertNil(silent.samplePeakDBFS)
        XCTAssertNil(silent.integratedLUFS)
        XCTAssertNil(silent.shortTermLUFS)
        let invalid = meter.process([.nan, .infinity, -.infinity, 1, -1, 1.1])
        XCTAssertEqual(invalid.nonFiniteSampleCount, 3)
        XCTAssertEqual(invalid.clippedSampleCount, 3)
        XCTAssertNoThrow(try JSONEncoder().encode(invalid))
        XCTAssertNoThrow(try JSONEncoder().encode(silent))
    }

    func testDroppedCaptureStartsNewContiguousMeasurement() {
        var meter = AudioSignalMeter(sampleRate: 48_000, channels: 1)
        let samples = sine(rate: 48_000, channels: 1, seconds: 1, amplitude: 0.1)
        meter.process(samples, outputStartFrame: 0)
        meter.process(samples, outputStartFrame: 48_000)
        XCTAssertEqual(meter.metrics.measuredFrames, 96_000)
        meter.process(Array(samples.prefix(48)), outputStartFrame: 144_000)
        XCTAssertEqual(meter.metrics.measuredFrames, 48)
        XCTAssertEqual(meter.metrics.discontinuityCount, 1)
        XCTAssertNil(meter.metrics.integratedLUFS)
    }

    private func sine(rate: Double, channels: Int, seconds: Double, amplitude: Double, frequency: Double = 1_000) -> [Float] {
        (0..<Int(rate * seconds)).flatMap { frame in
            [Float](repeating: Float(amplitude * sin(2 * .pi * frequency * Double(frame) / rate)), count: channels)
        }
    }
}
