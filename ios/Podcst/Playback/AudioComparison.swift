import AVFoundation
import Foundation
import Observation

enum AudioComparisonPreset: String, CaseIterable, Codable, Sendable, Identifiable {
    case off
    case boost
    case trim
    case both

    var id: Self { self }
    var title: String {
        switch self {
        case .off: "Off"
        case .boost: "Boost"
        case .trim: "Trim"
        case .both: "Both"
        }
    }
    var effects: AudioEffects {
        AudioEffects(volumeBoost: self == .boost || self == .both, trimSilence: self == .trim || self == .both)
    }
}

enum AudioComparisonLevel: String, CaseIterable, Identifiable {
    case fixed
    case matched

    var id: Self { self }
    var title: String { self == .fixed ? "Fixed level" : "Loudness matched" }
}

struct AudioComparisonPassage: Codable, Equatable, Sendable {
    let start: TimeInterval
    let end: TimeInterval
    var duration: TimeInterval { end - start }
    var warmUpStart: TimeInterval { max(0, start - 3) }
    var warmUpDuration: TimeInterval { start - warmUpStart }

    init(start: TimeInterval, end: TimeInterval) throws {
        guard start.isFinite, end.isFinite, start >= 0, (0.4...30).contains(end - start) else {
            throw AudioComparisonError.invalidPassage
        }
        self.start = start
        self.end = end
    }

    static func around(_ position: TimeInterval, duration: TimeInterval, length: TimeInterval = 20) -> Self? {
        guard position.isFinite, duration.isFinite, duration >= 0.4, length.isFinite else { return nil }
        let length = min(duration, max(10, min(30, length)))
        let start = min(max(0, position), duration - length)
        return try? Self(start: start, end: start + length)
    }
}

struct AudioComparisonMeasurement: Codable, Sendable {
    let preset: AudioComparisonPreset
    let duration: TimeInterval
    let metrics: AudioSignalMetrics
}

struct AudioComparisonReport: Codable, Sendable {
    static let defaultEdgeFadeSeconds = 0.005
    let passage: AudioComparisonPassage
    let speed: Double
    let sampleRate: Double
    let measurements: [AudioComparisonMeasurement]
    let auditionEdgeFadeSeconds: Double

    init(passage: AudioComparisonPassage, speed: Double, sampleRate: Double, measurements: [AudioComparisonMeasurement], auditionEdgeFadeSeconds: Double = AudioComparisonReport.defaultEdgeFadeSeconds) {
        self.passage = passage
        self.speed = speed
        self.sampleRate = sampleRate
        self.measurements = measurements
        self.auditionEdgeFadeSeconds = auditionEdgeFadeSeconds
    }

    var matchedTargetLUFS: Double? {
        guard measurements.count == AudioComparisonPreset.allCases.count,
              measurements.allSatisfy({ $0.metrics.integratedLUFS?.isFinite == true }) else { return nil }
        return measurements.compactMap(\.metrics.integratedLUFS).min()
    }

    func attenuation(for preset: AudioComparisonPreset) -> Float? {
        guard let target = matchedTargetLUFS,
              let loudness = measurements.first(where: { $0.preset == preset })?.metrics.integratedLUFS else { return nil }
        return Self.attenuation(loudness: loudness, target: target)
    }

    static func attenuation(loudness: Double, target: Double) -> Float? {
        guard loudness.isFinite, target.isFinite else { return nil }
        return Float(pow(10, min(0, target - loudness) / 20))
    }
}

enum AudioComparisonError: Error {
    case invalidPassage
    case unavailableSource
    case renderFailed
    case emptyOutput
    case playbackFailed
}

struct AudioComparisonRender: Sendable {
    let report: AudioComparisonReport
    let directory: URL
    let files: [AudioComparisonPreset: URL]
}

@MainActor
enum AudioComparisonRenderer {
    static let sampleRate = 48_000.0
    private static let maximumFrames: AVAudioFrameCount = 256

    static func render(
        sourceURL: URL,
        passage: AudioComparisonPassage,
        rate: Double,
        progress: (Int) -> Void = { _ in }
    ) async throws -> AudioComparisonRender {
        guard sourceURL.isFileURL, (0.5...2).contains(rate), rate.isFinite else { throw AudioComparisonError.unavailableSource }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("AudioComparison-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        do {
            var measurements: [AudioComparisonMeasurement] = []
            var files: [AudioComparisonPreset: URL] = [:]
            for preset in AudioComparisonPreset.allCases {
                try Task.checkCancellation()
                progress(measurements.count)
                let url = directory.appendingPathComponent(preset.rawValue).appendingPathExtension("caf")
                let measurement = try await renderPreset(preset, sourceURL: sourceURL, passage: passage, rate: rate, outputURL: url)
                measurements.append(measurement)
                files[preset] = url
            }
            try Task.checkCancellation()
            return AudioComparisonRender(
                report: AudioComparisonReport(passage: passage, speed: rate, sampleRate: sampleRate, measurements: measurements),
                directory: directory,
                files: files
            )
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }

    private static func renderPreset(
        _ preset: AudioComparisonPreset,
        sourceURL: URL,
        passage: AudioComparisonPassage,
        rate: Double,
        outputURL: URL
    ) async throws -> AudioComparisonMeasurement {
        let transport = LocalAudioTransport(configuration: LocalAudioConfiguration(
            output: .offline(sampleRate: sampleRate, channels: 2, maximumFrames: maximumFrames)
        ))
        defer { transport.shutdown() }
        transport.setEffects(preset.effects)
        transport.load(source: .url(sourceURL), at: passage.warmUpStart, generation: UUID())
        try await transport.waitUntilReady()
        try Task.checkCancellation()
        guard Double(transport.diagnostics.sourceFrameCount) / transport.diagnostics.sourceSampleRate >= passage.end else {
            throw AudioComparisonError.invalidPassage
        }
        transport.play(atRate: rate)
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: maximumFrames) else {
            throw AudioComparisonError.renderFailed
        }
        let writer = try AudioComparisonWriter(url: outputURL, sampleRate: sampleRate, capacity: maximumFrames)
        let maximumBlocks = Int(ceil(((passage.end - passage.warmUpStart) / rate + 3) * sampleRate / Double(maximumFrames)))
        var reachedBoundary = false
        for _ in 0..<maximumBlocks {
            try Task.checkCancellation()
            let outputStartFrame = transport.diagnostics.renderedFrames
            let status = try await transport.renderOffline(frames: maximumFrames, into: buffer)
            guard status == .success, let data = buffer.floatChannelData else { throw AudioComparisonError.renderFailed }
            let frames = Int(buffer.frameLength)
            let first = boundary(passage.start, transport: transport, outputStartFrame: outputStartFrame, count: frames)
            let last = boundary(passage.end, transport: transport, outputStartFrame: outputStartFrame, count: frames)
            if last > first {
                var samples: [Float] = []
                samples.reserveCapacity((last - first) * 2)
                for frame in first..<last {
                    samples.append(data[0][frame])
                    samples.append(data[1][frame])
                }
                try await writer.append(samples)
            }
            if transport.position >= passage.end || transport.diagnostics.reachedEnd {
                reachedBoundary = true
                break
            }
        }
        guard reachedBoundary else { throw AudioComparisonError.renderFailed }
        return try await writer.finish(preset: preset)
    }

    private static func boundary(_ sourceTime: Double, transport: LocalAudioTransport, outputStartFrame: UInt64, count: Int) -> Int {
        var lower = 0
        var upper = count
        while lower < upper {
            let middle = lower + (upper - lower) / 2
            let time = transport.sourcePosition(forRenderedOutputFrame: outputStartFrame + UInt64(middle)) ?? -.infinity
            if time < sourceTime { lower = middle + 1 }
            else { upper = middle }
        }
        return lower
    }
}

private actor AudioComparisonWriter {
    private var file: AVAudioFile?
    private let buffer: AVAudioPCMBuffer
    private var meter: AudioSignalMeter
    private var frames: UInt64 = 0
    private var writtenFrames: UInt64 = 0
    private var pending: [Float] = []
    private let edgeFrames: Int
    private let sampleRate: Double

    init(url: URL, sampleRate: Double, capacity: AVAudioFrameCount) throws {
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { throw AudioComparisonError.renderFailed }
        var settings = format.settings
        settings.removeValue(forKey: AVLinearPCMIsNonInterleaved)
        file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        self.buffer = buffer
        self.sampleRate = sampleRate
        edgeFrames = Int(sampleRate * AudioComparisonReport.defaultEdgeFadeSeconds)
        meter = AudioSignalMeter(sampleRate: sampleRate, channels: 2)
    }

    func append(_ samples: [Float]) throws {
        guard !samples.isEmpty else { return }
        guard samples.count.isMultiple(of: 2) else { throw AudioComparisonError.renderFailed }
        _ = meter.process(samples)
        frames += UInt64(samples.count / 2)
        pending.append(contentsOf: samples)
        let count = max(0, pending.count - edgeFrames * 2)
        if count > 0 {
            try write(Array(pending.prefix(count)), ending: false)
            pending.removeFirst(count)
        }
    }

    func finish(preset: AudioComparisonPreset) throws -> AudioComparisonMeasurement {
        try write(pending, ending: true)
        pending.removeAll()
        file = nil
        guard frames > 0 else { throw AudioComparisonError.emptyOutput }
        return AudioComparisonMeasurement(preset: preset, duration: Double(frames) / sampleRate, metrics: meter.finish())
    }

    private func write(_ samples: [Float], ending: Bool) throws {
        guard !samples.isEmpty else { return }
        guard let file, let output = buffer.floatChannelData,
              samples.count / 2 <= buffer.frameCapacity else { throw AudioComparisonError.renderFailed }
        let count = samples.count / 2
        for index in 0..<count {
            let first = min(1, Double(writtenFrames + UInt64(index)) / Double(edgeFrames - 1))
            let last = ending ? Double(count - 1 - index) / Double(edgeFrames - 1) : 1
            let gain = Float(min(first, last))
            output[0][index] = samples[index * 2] * gain
            output[1][index] = samples[index * 2 + 1] * gain
        }
        buffer.frameLength = AVAudioFrameCount(count)
        try file.write(from: buffer)
        writtenFrames += UInt64(count)
    }
}

@MainActor
@Observable
final class AudioComparisonSession: NSObject, AVAudioPlayerDelegate {
    private(set) var report: AudioComparisonReport?
    private(set) var renderingPreset: AudioComparisonPreset?
    private(set) var failure: String?
    private(set) var isPlaying = false
    private(set) var isStarting = false
    private(set) var selectedPreset = AudioComparisonPreset.off
    private(set) var level = AudioComparisonLevel.fixed
    private(set) var cyclesPresets = false
    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var render: AudioComparisonRender?
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var activationTask: Task<Void, Never>?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private let observers = AudioComparisonObservers()

    var isRendering: Bool { renderingPreset != nil }
    var isPlaybackRequested: Bool { isPlaying || isStarting }

    override init() {
        super.init()
        observers.tokens.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { [weak self] notification in
            let began = (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue == AVAudioSession.InterruptionType.began.rawValue
            guard began else { return }
            Task { @MainActor [weak self] in self?.pause() }
        })
        observers.tokens.append(NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil) { [weak self] notification in
            let reason = (notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue
            guard reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue || reason == AVAudioSession.RouteChangeReason.noSuitableRouteForCategory.rawValue else { return }
            Task { @MainActor [weak self] in self?.pause() }
        })
    }

    deinit {
        task?.cancel()
        activationTask?.cancel()
    }

    func prepare(sourceURL: URL, passage: AudioComparisonPassage, rate: Double, onReport: @escaping (AudioComparisonReport) -> Void) {
        reset()
        let token = generation
        renderingPreset = .off
        task = Task { [weak self] in
            do {
                let result = try await AudioComparisonRenderer.render(sourceURL: sourceURL, passage: passage, rate: rate) { [weak self] index in
                    guard let self, self.generation == token else { return }
                    self.renderingPreset = AudioComparisonPreset.allCases[index]
                }
                guard let self, self.generation == token, !Task.isCancelled else {
                    try? FileManager.default.removeItem(at: result.directory)
                    return
                }
                self.render = result
                self.report = result.report
                self.renderingPreset = nil
                self.task = nil
                onReport(result.report)
            } catch {
                guard let self, self.generation == token, !Task.isCancelled else { return }
                self.renderingPreset = nil
                self.task = nil
                self.failure = "The passage could not be rendered. Try another passage or a downloaded file."
            }
        }
    }

    func select(_ preset: AudioComparisonPreset) {
        guard selectedPreset != preset else { return }
        let resume = isPlaybackRequested
        pause()
        selectedPreset = preset
        player = nil
        if resume { play() }
    }

    func setLevel(_ level: AudioComparisonLevel) {
        guard level == .fixed || report?.matchedTargetLUFS != nil else { return }
        self.level = level
        applyLevel()
    }

    func setCyclesPresets(_ enabled: Bool) {
        cyclesPresets = enabled
        player?.numberOfLoops = enabled ? 0 : -1
    }

    func toggle() {
        if isPlaybackRequested { pause() }
        else { play() }
    }

    func play() {
        guard let url = render?.files[selectedPreset], !isStarting else { return }
        let token = generation
        isStarting = true
        failure = nil
        activationTask = Task { [weak self] in
            do {
                try await PlaybackAudioSession.prepare(forPlayback: true)
                guard !Task.isCancelled, let self, self.generation == token else { return }
                self.activationTask = nil
                self.isStarting = false
                if self.player == nil {
                    self.player = try AVAudioPlayer(contentsOf: url)
                    self.player?.delegate = self
                }
                self.player?.numberOfLoops = self.cyclesPresets ? 0 : -1
                self.applyLevel()
                guard self.player?.play() == true else { throw AudioComparisonError.playbackFailed }
                self.isPlaying = true
            } catch {
                guard !Task.isCancelled, let self, self.generation == token else { return }
                self.activationTask = nil
                self.isStarting = false
                self.failure = "The comparison could not play. Try playback again."
                self.isPlaying = false
            }
        }
    }

    func pause() {
        activationTask?.cancel()
        activationTask = nil
        isStarting = false
        player?.pause()
        isPlaying = false
    }

    func reset() {
        generation = UUID()
        task?.cancel()
        task = nil
        pause()
        player?.stop()
        player = nil
        report = nil
        renderingPreset = nil
        failure = nil
        level = .fixed
        if let directory = render?.directory {
            Task.detached { try? FileManager.default.removeItem(at: directory) }
        }
        render = nil
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let identifier = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard let self, self.player.map(ObjectIdentifier.init) == identifier, self.isPlaying else { return }
            self.isPlaying = false
            guard flag, self.cyclesPresets else { return }
            let presets = AudioComparisonPreset.allCases
            let index = presets.firstIndex(of: self.selectedPreset) ?? 0
            self.selectedPreset = presets[(index + 1) % presets.count]
            self.player = nil
            self.play()
        }
    }

    private func applyLevel() {
        player?.volume = level == .matched ? report?.attenuation(for: selectedPreset) ?? 1 : 1
    }
}

private final class AudioComparisonObservers {
    var tokens: [NSObjectProtocol] = []

    deinit {
        for token in tokens { NotificationCenter.default.removeObserver(token) }
    }
}
