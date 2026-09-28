import Accelerate
import Foundation

struct AudioSignalMetrics: Codable, Equatable, Sendable {
    var samplePeakDBFS: Double?
    var rmsDBFS: Double?
    var estimatedTruePeakDBTP: Double?
    var maximumSamplePeakDBFS: Double?
    var maximumEstimatedTruePeakDBTP: Double?
    var momentaryLUFS: Double?
    var shortTermLUFS: Double?
    var integratedLUFS: Double?
    var measuredFrames: UInt64 = 0
    var clippedSampleCount: UInt64 = 0
    var nonFiniteSampleCount: UInt64 = 0
    var discontinuityCount: UInt64 = 0
}

struct AudioSignalMeter: Sendable {
    let sampleRate: Double
    let channels: Int
    private var filters: [KWeighting]
    private var peakEstimator: OversampledPeak
    private var hopFrames: Int
    private var hopCount = 0
    private var hopEnergy = 0.0
    private var hopPowers = [Double](repeating: 0, count: 30)
    private var hopCursor = 0
    private var completedHops = 0
    private var histogramEnergy = [Double](repeating: 0, count: 13_001)
    private var histogramCount = [UInt64](repeating: 0, count: 13_001)
    private var expectedOutputFrame: UInt64?
    private var maximumPeak = 0.0
    private var maximumTruePeak = 0.0
    private var snapshot = AudioSignalMetrics()

    init(sampleRate: Double, channels: Int) {
        precondition(sampleRate.isFinite && sampleRate >= 8_000 && sampleRate <= 192_000)
        precondition((1...2).contains(channels))
        self.sampleRate = sampleRate
        self.channels = channels
        filters = (0..<channels).map { _ in KWeighting(sampleRate: sampleRate) }
        peakEstimator = OversampledPeak(channels: channels)
        hopFrames = max(1, Int((sampleRate * 0.1).rounded()))
    }

    var metrics: AudioSignalMetrics { snapshot }

    @discardableResult
    mutating func process(_ samples: [Float], outputStartFrame: UInt64? = nil) -> AudioSignalMetrics {
        precondition(samples.count.isMultiple(of: channels))
        if let outputStartFrame, let expectedOutputFrame, outputStartFrame != expectedOutputFrame {
            let discontinuities = snapshot.discontinuityCount + 1
            self = AudioSignalMeter(sampleRate: sampleRate, channels: channels)
            snapshot.discontinuityCount = discontinuities
        }
        let frames = samples.count / channels
        guard frames > 0 else { return metrics }
        expectedOutputFrame = outputStartFrame.map { $0 + UInt64(frames) }
        var clean = [Double](repeating: 0, count: samples.count)
        var peak = 0.0
        var energy = 0.0
        for frame in 0..<frames {
            var weightedEnergy = 0.0
            for channel in 0..<channels {
                let index = frame * channels + channel
                let raw = Double(samples[index])
                let value = raw.isFinite ? raw : 0
                if !raw.isFinite { snapshot.nonFiniteSampleCount += 1 }
                if abs(value) >= 1 { snapshot.clippedSampleCount += 1 }
                clean[index] = value
                peak = max(peak, abs(value))
                energy += value * value
                let weighted = filters[channel].process(value)
                weightedEnergy += weighted * weighted
            }
            hopEnergy += weightedEnergy
            hopCount += 1
            if hopCount == hopFrames { completeHop() }
        }
        let truePeak = max(peak, peakEstimator.process(clean))
        maximumPeak = max(maximumPeak, peak)
        maximumTruePeak = max(maximumTruePeak, truePeak)
        snapshot.samplePeakDBFS = Self.amplitudeDB(peak)
        snapshot.rmsDBFS = Self.powerDB(energy / Double(samples.count))
        snapshot.estimatedTruePeakDBTP = Self.amplitudeDB(truePeak)
        snapshot.maximumSamplePeakDBFS = Self.amplitudeDB(maximumPeak)
        snapshot.maximumEstimatedTruePeakDBTP = Self.amplitudeDB(maximumTruePeak)
        snapshot.measuredFrames += UInt64(frames)
        return metrics
    }

    @discardableResult
    mutating func finish() -> AudioSignalMetrics {
        maximumTruePeak = max(maximumTruePeak, peakEstimator.process([Double](repeating: 0, count: 32 * channels)))
        snapshot.maximumEstimatedTruePeakDBTP = Self.amplitudeDB(maximumTruePeak)
        return metrics
    }

    private mutating func completeHop() {
        hopPowers[hopCursor] = hopEnergy / Double(hopFrames)
        hopCursor = (hopCursor + 1) % hopPowers.count
        completedHops += 1
        hopCount = 0
        hopEnergy = 0
        if completedHops >= 4 {
            let power = (1...4).reduce(0.0) { $0 + hopPowers[(hopCursor - $1 + hopPowers.count) % hopPowers.count] } / 4
            snapshot.momentaryLUFS = Self.loudness(power)
            if let loudness = snapshot.momentaryLUFS, loudness > -70 {
                let index = min(histogramEnergy.count - 1, max(0, Int((loudness + 70) * 100)))
                histogramEnergy[index] += power
                histogramCount[index] += 1
                snapshot.integratedLUFS = integratedLoudness()
            }
        }
        if completedHops >= 30 {
            snapshot.shortTermLUFS = Self.loudness(hopPowers.reduce(0, +) / 30)
        }
    }

    private func integratedLoudness() -> Double? {
        let count = histogramCount.reduce(0, +)
        guard count > 0, let absoluteLoudness = Self.loudness(histogramEnergy.reduce(0, +) / Double(count)) else { return nil }
        let gate = max(-70, absoluteLoudness - 10)
        var gatedEnergy = 0.0
        var gatedCount: UInt64 = 0
        for index in histogramEnergy.indices where histogramCount[index] > 0 {
            let energy = histogramEnergy[index]
            let count = histogramCount[index]
            if let loudness = Self.loudness(energy / Double(count)), loudness > gate {
                gatedEnergy += energy
                gatedCount += count
            }
        }
        return gatedCount > 0 ? Self.loudness(gatedEnergy / Double(gatedCount)) : nil
    }

    private static func powerDB(_ value: Double) -> Double? {
        value > 0 && value.isFinite ? 10 * log10(value) : nil
    }

    private static func amplitudeDB(_ value: Double) -> Double? {
        value > 0 && value.isFinite ? 20 * log10(value) : nil
    }

    private static func loudness(_ value: Double) -> Double? {
        powerDB(value).map { $0 - 0.691 }
    }
}

private struct KWeighting: Sendable {
    var shelf: Biquad
    var highPass: Biquad

    init(sampleRate: Double) {
        let shelfK = tan(.pi * 1_681.974450955533 / sampleRate)
        let shelfQ = 0.7071752369554196
        let highGain = pow(10, 3.999843853973347 / 20)
        let middleGain = pow(highGain, 0.4996667741545416)
        let shelfDenominator = 1 + shelfK / shelfQ + shelfK * shelfK
        shelf = Biquad(
            b0: (highGain + middleGain * shelfK / shelfQ + shelfK * shelfK) / shelfDenominator,
            b1: 2 * (shelfK * shelfK - highGain) / shelfDenominator,
            b2: (highGain - middleGain * shelfK / shelfQ + shelfK * shelfK) / shelfDenominator,
            a1: 2 * (shelfK * shelfK - 1) / shelfDenominator,
            a2: (1 - shelfK / shelfQ + shelfK * shelfK) / shelfDenominator
        )
        let highPassK = tan(.pi * 38.13547087602444 / sampleRate)
        let highPassQ = 0.5003270373238773
        let highPassDenominator = 1 + highPassK / highPassQ + highPassK * highPassK
        highPass = Biquad(
            b0: 1, b1: -2, b2: 1,
            a1: 2 * (highPassK * highPassK - 1) / highPassDenominator,
            a2: (1 - highPassK / highPassQ + highPassK * highPassK) / highPassDenominator
        )
    }

    mutating func process(_ value: Double) -> Double {
        highPass.process(shelf.process(value))
    }
}

private struct Biquad: Sendable {
    let b0: Double
    let b1: Double
    let b2: Double
    let a1: Double
    let a2: Double
    private var z1 = 0.0
    private var z2 = 0.0

    init(b0: Double, b1: Double, b2: Double, a1: Double, a2: Double) {
        self.b0 = b0
        self.b1 = b1
        self.b2 = b2
        self.a1 = a1
        self.a2 = a2
    }

    mutating func process(_ value: Double) -> Double {
        let output = b0 * value + z1
        z1 = b1 * value - a1 * output + z2
        z2 = b2 * value - a2 * output
        return output
    }
}

private struct OversampledPeak: Sendable {
    let channels: Int
    private var history: [[Double]]
    private let phases: [[Double]]

    init(channels: Int) {
        self.channels = channels
        history = .init(repeating: .init(repeating: 0, count: 31), count: channels)
        phases = (1...3).map { phase in
            let coefficients = (0..<32).map { tap -> Double in
                let distance = Double(tap) - 15 - Double(phase) / 4
                let sinc = sin(.pi * distance) / (.pi * distance)
                let window = 0.42 - 0.5 * cos(2 * .pi * Double(tap) / 31) + 0.08 * cos(4 * .pi * Double(tap) / 31)
                return sinc * window
            }
            let sum = coefficients.reduce(0, +)
            return coefficients.map { $0 / sum }
        }
    }

    mutating func process(_ samples: [Double]) -> Double {
        let frames = samples.count / channels
        guard frames > 0 else { return 0 }
        var peak = 0.0
        var interpolated = [Double](repeating: 0, count: frames)
        for channel in 0..<channels {
            var input = history[channel]
            input.reserveCapacity(31 + frames)
            for frame in 0..<frames { input.append(samples[frame * channels + channel]) }
            for phase in phases {
                vDSP_convD(input, 1, phase, 1, &interpolated, 1, vDSP_Length(frames), 32)
                var magnitude = 0.0
                vDSP_maxmgvD(interpolated, 1, &magnitude, vDSP_Length(frames))
                peak = max(peak, magnitude)
            }
            history[channel] = Array(input.suffix(31))
        }
        return peak
    }
}
