import Accelerate
import Foundation

enum AudioOutputMeter {
    static func peak(_ samples: [Float]) -> Double {
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
}
