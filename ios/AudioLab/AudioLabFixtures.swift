import AVFoundation
import Foundation

enum AudioLabFixtures {
    static func make() async throws -> URL {
        try await Task.detached(priority: .userInitiated) {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("PodcstAudioLabFixtures", isDirectory: true)
            let url = directory.appendingPathComponent("Quiet and loud tones with pauses.wav")
            if FileManager.default.fileExists(atPath: url.path) { return url }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let temporary = directory.appendingPathComponent(UUID().uuidString).appendingPathExtension("wav")
            defer { try? FileManager.default.removeItem(at: temporary) }
            let rate = 48_000.0
            guard let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2),
                  let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024),
                  let channels = buffer.floatChannelData else { throw LocalAudioError.cannotDecode }
            var file: AVAudioFile? = try AVAudioFile(forWriting: temporary, settings: format.settings)
            let count = Int(rate * 45)
            for start in stride(from: 0, to: count, by: 1024) {
                try Task.checkCancellation()
                let frames = min(1024, count - start)
                buffer.frameLength = AVAudioFrameCount(frames)
                for frame in 0..<frames {
                    let time = Double(start + frame) / rate
                    let cycle = time.truncatingRemainder(dividingBy: 9)
                    let quiet = (3..<5).contains(cycle) || (7.5..<9).contains(cycle)
                    let amplitude = quiet ? 0.0002 : cycle < 3 ? 0.025 : 0.35
                    let envelope = quiet ? 1 : 0.35 + 0.65 * pow(sin(.pi * time * 3), 2)
                    for channel in 0..<2 {
                        let tone = sin(2 * .pi * (channel == 0 ? 180 : 220) * time) + 0.3 * sin(2 * .pi * 540 * time)
                        channels[channel][frame] = Float(amplitude * envelope * tone)
                    }
                }
                try file?.write(from: buffer)
            }
            file = nil
            try FileManager.default.moveItem(at: temporary, to: url)
            return url
        }.value
    }
}
