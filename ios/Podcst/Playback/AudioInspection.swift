import AVFoundation
import Foundation

struct AudioInspectionEnvelope: Codable, Equatable, Sendable {
    let sourceStart: TimeInterval
    let sourceEnd: TimeInterval
    let minimum: Float
    let maximum: Float
    let rms: Float

    var peak: Float { max(abs(minimum), abs(maximum)) }
}

struct AudioInspectionCut: Codable, Equatable, Sendable {
    let sourceStart: TimeInterval
    let sourceEnd: TimeInterval

    var duration: TimeInterval { sourceEnd - sourceStart }
}

struct AudioInspectionGain: Codable, Equatable, Sendable {
    let sourceTime: TimeInterval
    let decibels: Float
}

struct AudioInspectionEvent: Codable, Equatable, Sendable {
    enum Kind: String, Codable, Sendable {
        case requested, applied, presented, seek, rate, underrun, started, paused, failed
    }

    let kind: Kind
    let sourceTime: TimeInterval
    var revision: UInt64?
    var effects: AudioEffects?
    var value: Double?
}

struct AudioInspectionSnapshot: Codable, Equatable, Sendable {
    let epoch: UUID
    let sampleRate: Double
    let presentedSourceTime: TimeInterval
    let original: [AudioInspectionEnvelope]
    let processed: [AudioInspectionEnvelope]
    let cuts: [AudioInspectionCut]
    let gainReadings: [AudioInspectionGain]
    let events: [AudioInspectionEvent]
    let removedSourceSeconds: TimeInterval
    let outputTelemetryDroppedFrames: UInt64
}

struct AudioOutputInspectionPacket: Sendable {
    let epoch: UUID
    let interleavedSamples: [Float]
    let outputStartFrame: UInt64
    let channels: Int
    let sampleRate: Double
    let limiterReductionDB: Float

    static func presentedFrame(renderedFrames: UInt64, presentationLatency: TimeInterval, sampleRate: Double) -> UInt64 {
        guard presentationLatency.isFinite, presentationLatency >= 0, sampleRate.isFinite, sampleRate > 0 else { return 0 }
        let frames = ceil(presentationLatency * sampleRate)
        guard frames < Double(renderedFrames) else { return 0 }
        return renderedFrames - UInt64(frames)
    }
}

struct AudioInspectionPacket: Sendable {
    let epoch: UUID
    let original: [AudioInspectionEnvelope]
    let processed: [AudioInspectionEnvelope]
    let gainReadings: [AudioInspectionGain]
    let applied: [AppliedAudioEffects]
}

struct AudioInspectionRing<Element: Sendable>: Sendable {
    private var storage: [Element?]
    private var next = 0
    private(set) var count = 0

    init(capacity: Int) {
        storage = Array(repeating: nil, count: max(1, capacity))
    }

    mutating func append(_ element: Element) {
        storage[next] = element
        next = (next + 1) % storage.count
        count = min(count + 1, storage.count)
    }

    var values: [Element] {
        let first = count == storage.count ? next : 0
        return (0..<count).compactMap { storage[(first + $0) % storage.count] }
    }

    mutating func removeAll() {
        let first = count == storage.count ? next : 0
        for index in 0..<count { storage[(first + index) % storage.count] = nil }
        next = 0
        count = 0
    }
}

struct AudioInspectionStore {
    static let envelopeCapacity = 6_000
    static let eventCapacity = 256
    static let historyDuration: TimeInterval = 60

    let epoch: UUID
    let sampleRate: Double
    private var original = AudioInspectionRing<AudioInspectionEnvelope>(capacity: envelopeCapacity)
    private var processed = AudioInspectionRing<AudioInspectionEnvelope>(capacity: envelopeCapacity)
    private var cuts = AudioInspectionRing<AudioInspectionCut>(capacity: eventCapacity)
    private var gains = AudioInspectionRing<AudioInspectionGain>(capacity: envelopeCapacity)
    private var events = AudioInspectionRing<AudioInspectionEvent>(capacity: eventCapacity)
    private var sourceEnd: Int64?
    private var appliedRevision: UInt64?
    private var pendingCuts: [AudioInspectionCut] = []
    private var presentedRemovedSeconds: TimeInterval = 0

    init(epoch: UUID, sampleRate: Double, sourceStart: Int64? = nil) {
        self.epoch = epoch
        self.sampleRate = sampleRate
        sourceEnd = sourceStart
    }

    mutating func record(_ event: AudioInspectionEvent) {
        events.append(event)
    }

    mutating func append(_ packet: AudioInspectionPacket, spans: [AudioSourceSpan], fileEndFrame: Int64?) {
        guard packet.epoch == epoch else { return }
        for envelope in packet.original { original.append(envelope) }
        for envelope in packet.processed { processed.append(envelope) }
        for gain in packet.gainReadings { gains.append(gain) }
        for boundary in packet.applied where boundary.revision != appliedRevision {
            appliedRevision = boundary.revision
            record(AudioInspectionEvent(kind: .applied, sourceTime: Double(boundary.sourceFrame) / sampleRate, revision: boundary.revision, effects: boundary.effects))
        }
        for span in spans {
            if let sourceEnd, span.sourceStart > sourceEnd { appendCut(from: sourceEnd, to: span.sourceStart) }
            sourceEnd = span.sourceStart + span.frameCount
        }
        if let fileEndFrame, let sourceEnd, fileEndFrame > sourceEnd {
            appendCut(from: sourceEnd, to: fileEndFrame)
            self.sourceEnd = fileEndFrame
        }
    }

    mutating func snapshot(presentedSourceTime: TimeInterval, outputTelemetryDroppedFrames: UInt64 = 0) -> AudioInspectionSnapshot {
        let presented = max(0, presentedSourceTime)
        let oldest = max(0, presented - Self.historyDuration)
        advancePresentation(to: presented)
        return AudioInspectionSnapshot(
            epoch: epoch,
            sampleRate: sampleRate,
            presentedSourceTime: presented,
            original: original.values.filter { $0.sourceEnd <= presented && $0.sourceEnd >= oldest },
            processed: processed.values.filter { $0.sourceEnd <= presented && $0.sourceEnd >= oldest },
            cuts: cuts.values.filter { $0.sourceEnd <= presented && $0.sourceEnd >= oldest },
            gainReadings: gains.values.filter { $0.sourceTime <= presented && $0.sourceTime >= oldest },
            events: events.values,
            removedSourceSeconds: presentedRemovedSeconds,
            outputTelemetryDroppedFrames: outputTelemetryDroppedFrames
        )
    }

    mutating func advancePresentation(to sourceTime: TimeInterval) {
        while let cut = pendingCuts.first, cut.sourceEnd <= sourceTime {
            presentedRemovedSeconds += cut.duration
            pendingCuts.removeFirst()
        }
    }

    private mutating func appendCut(from start: Int64, to end: Int64) {
        let cut = AudioInspectionCut(sourceStart: Double(start) / sampleRate, sourceEnd: Double(end) / sampleRate)
        cuts.append(cut)
        pendingCuts.append(cut)
        if pendingCuts.count > Self.eventCapacity { pendingCuts.removeFirst(pendingCuts.count - Self.eventCapacity) }
    }
}

final class AudioInspectionCollector {
    let epoch: UUID
    private let sampleRate: Double
    private var original: AudioEnvelopeAccumulator
    private var processed: AudioEnvelopeAccumulator
    private var gains = AudioInspectionRing<AudioInspectionGain>(capacity: 256)
    private var applied: [AppliedAudioEffects] = []
    private var lastRevision: UInt64?
    private var lastGainFrame: Int64?

    init(epoch: UUID, sampleRate: Double) {
        self.epoch = epoch
        self.sampleRate = sampleRate
        original = AudioEnvelopeAccumulator(sampleRate: sampleRate)
        processed = AudioEnvelopeAccumulator(sampleRate: sampleRate)
    }

    func consume(_ buffer: AVAudioPCMBuffer, offset: Int, count: Int, sourceStart: Int64) {
        original.append(buffer, offset: offset, count: count, sourceStart: sourceStart)
    }

    func measure(gain: Float, at sourceFrame: Int64, applied boundary: AppliedAudioEffects) {
        if boundary.revision != lastRevision {
            lastRevision = boundary.revision
            applied.append(boundary)
        }
        if lastGainFrame == nil || Double(sourceFrame - (lastGainFrame ?? 0)) >= sampleRate / 100 {
            gains.append(AudioInspectionGain(sourceTime: Double(sourceFrame) / sampleRate, decibels: gain))
            lastGainFrame = sourceFrame
        }
    }

    func take(output: AVAudioPCMBuffer, spans: [AudioSourceSpan], ended: Bool) -> AudioInspectionPacket {
        for span in spans {
            processed.append(output, offset: Int(span.outputStart), count: Int(span.frameCount), sourceStart: span.sourceStart)
        }
        if ended {
            original.finish()
            processed.finish()
        }
        let packet = AudioInspectionPacket(epoch: epoch, original: original.take(), processed: processed.take(), gainReadings: gains.values, applied: applied)
        gains.removeAll()
        applied.removeAll(keepingCapacity: true)
        return packet
    }
}

private struct AudioEnvelopeAccumulator {
    private let sampleRate: Double
    private let binFrames: Int64
    private var start: Int64?
    private var end: Int64 = 0
    private var minimum = Float.infinity
    private var maximum = -Float.infinity
    private var energy: Double = 0
    private var samples = 0
    private var completed = AudioInspectionRing<AudioInspectionEnvelope>(capacity: AudioInspectionStore.envelopeCapacity)

    init(sampleRate: Double) {
        self.sampleRate = sampleRate
        binFrames = max(1, Int64(sampleRate / 100))
    }

    mutating func append(_ buffer: AVAudioPCMBuffer, offset: Int, count: Int, sourceStart: Int64) {
        guard count > 0, let channels = buffer.floatChannelData else { return }
        if start != nil, end != sourceStart { finish() }
        for frame in 0..<count {
            let sourceFrame = sourceStart + Int64(frame)
            if start == nil { start = sourceFrame }
            for channel in 0..<Int(buffer.format.channelCount) {
                let value = channels[channel][offset + frame]
                minimum = min(minimum, value)
                maximum = max(maximum, value)
                energy += Double(value) * Double(value)
                samples += 1
            }
            end = sourceFrame + 1
            if end % binFrames == 0 { finish() }
        }
    }

    mutating func finish() {
        guard let start, samples > 0 else { return }
        completed.append(AudioInspectionEnvelope(sourceStart: Double(start) / sampleRate, sourceEnd: Double(end) / sampleRate, minimum: minimum, maximum: maximum, rms: Float(sqrt(energy / Double(samples)))))
        self.start = nil
        minimum = .infinity
        maximum = -.infinity
        energy = 0
        samples = 0
    }

    mutating func take() -> [AudioInspectionEnvelope] {
        let values = completed.values
        completed.removeAll()
        return values
    }
}
