import AVFoundation
import Foundation
import Observation
import SwiftUI
import UniformTypeIdentifiers

struct AudioLabReading: Sendable {
    let signal: AudioInspectionSnapshot
    let output: AudioSignalMetrics?
    let limiterReductionDB: Float?
    let diagnostics: AudioLabDiagnostics?
    let route: AudioLabRoute
    let date: Date
    let options: AudioOptions
    let backend: String
    let sourceKind: String
    let sourceIdentityHash: String?
    let events: [AudioLabEvent]
}

struct AudioLabRoute: Codable, Sendable, Equatable {
    let outputs: [String]
    let sampleRate: Double
    let bufferDuration: Double
    let outputLatency: Double

    @MainActor
    static var current: Self {
        let session = AVAudioSession.sharedInstance()
        return Self(outputs: session.currentRoute.outputs.map { $0.portType.rawValue }, sampleRate: session.sampleRate, bufferDuration: session.ioBufferDuration, outputLatency: session.outputLatency)
    }
}

struct AudioLabDiagnostics: Codable, Sendable {
    let sourceSampleRate: Double
    let outputSampleRate: Double
    let queuedBuffers: Int
    let ownedAudioBytes: UInt64
    let underruns: Int

    init(_ diagnostics: LocalAudioDiagnostics) {
        sourceSampleRate = diagnostics.sourceSampleRate
        outputSampleRate = diagnostics.outputSampleRate
        queuedBuffers = diagnostics.scheduledBuffers
        ownedAudioBytes = diagnostics.allocatedBytes
        underruns = diagnostics.underruns
    }
}

struct AudioLabEvent: Codable, Sendable, Identifiable {
    let id: UUID
    let date: Date
    let sourceTime: Double
    let name: String
    let detail: String
}

struct AudioLabCapture: Codable, Sendable {
    let formatVersion: Int
    let capturedAt: Date
    let exportedAt: Date
    let appVersion: String
    let appBuild: String
    let buildProvenance: AudioLabBuildProvenance?
    let operatingSystem: String
    let backend: String
    let sourceKind: String
    let sourceIdentityHash: String?
    let options: AudioOptions
    let signal: AudioInspectionSnapshot?
    let output: AudioSignalMetrics?
    let limiterReductionDB: Float?
    let diagnostics: AudioLabDiagnostics?
    let route: AudioLabRoute
    let events: [AudioLabEvent]
    let comparison: AudioComparisonReport?
    let view: AudioLabCaptureView
}

struct AudioLabCaptureView: Codable, Sendable {
    let frozen: Bool
    let windowStart: Double
    let windowEnd: Double
    let measurementEnabled: Bool
}

struct AudioLabBuildProvenance: Codable, Sendable {
    let revision: String
    let workingTreeDirty: Bool
    let builtAt: String
    let configuration: String

    static let current: Self? = {
        guard let url = Bundle.main.url(forResource: "AudioLabBuild", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Self.self, from: data)
    }()
}

@MainActor
@Observable
final class AudioLabInspectionSession {
    var isEnabled = true
    var windowDuration: Double = 15
    var frozenEnd: Double = 0
    private(set) var latest: AudioLabReading?
    private(set) var frozen: AudioLabReading?
    private(set) var events: [AudioLabEvent] = []
    var comparison: AudioComparisonReport?
    @ObservationIgnored private let worker = AudioLabMeterWorker()

    var reading: AudioLabReading? { frozen ?? latest }
    var isFrozen: Bool { frozen != nil }
    var end: Double { isFrozen ? frozenEnd : reading?.signal.presentedSourceTime ?? 0 }
    var start: Double { max(0, end - windowDuration) }

    func freeze() {
        guard let latest else { return }
        frozen = latest
        frozenEnd = latest.signal.presentedSourceTime
    }

    func resume() { frozen = nil }

    func reset() {
        latest = nil
        frozen = nil
        events = []
        comparison = nil
    }

    func record(_ name: String, detail: String = "", at position: Double) {
        events.append(AudioLabEvent(id: UUID(), date: Date(), sourceTime: max(0, position), name: name, detail: detail))
        if events.count > 256 { events.removeFirst(events.count - 256) }
    }

    func run(transport: RoutingAudioTransport, playback: PlaybackController) async {
        while !Task.isCancelled, isEnabled {
            if let signal = transport.inspectionSnapshot() {
                let packets = transport.takeOutputInspection()
                let date = Date()
                let route = AudioLabRoute.current
                let diagnostics = transport.diagnostics.map(AudioLabDiagnostics.init)
                let episode = playback.currentEpisode
                let options = playback.audioPreferences.options(for: episode?.feed)
                let backend = transport.activeBackend?.rawValue ?? "none"
                let events = events
                let result = await worker.measure(packets, epoch: signal.epoch)
                guard !Task.isCancelled, isEnabled else { return }
                guard transport.activeInspectionEpoch == signal.epoch else { continue }
                if latest?.signal != signal || !packets.isEmpty || latest?.options != options || latest?.events.last?.id != events.last?.id || latest?.backend != backend || latest?.route != route {
                    latest = AudioLabReading(signal: signal, output: result.metrics, limiterReductionDB: result.reduction, diagnostics: diagnostics, route: route, date: date, options: options, backend: backend, sourceKind: episode?.audioURL?.isFileURL == true ? "Local file" : "Podcast episode", sourceIdentityHash: episode.map { MediaKey(accountID: nil, episode: $0).rawValue }, events: events)
                }
            } else {
                latest = nil
            }
            do { try await Task.sleep(for: .milliseconds(50)) }
            catch { return }
        }
    }

    func capture(backend: String, episode: Episode?, options: AudioOptions) throws -> AudioLabCaptureDocument {
        let reading = reading
        let capture = AudioLabCapture(
            formatVersion: 1,
            capturedAt: reading?.date ?? Date(),
            exportedAt: Date(),
            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unknown",
            appBuild: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "Unknown",
            buildProvenance: .current,
            operatingSystem: ProcessInfo.processInfo.operatingSystemVersionString,
            backend: reading?.backend ?? backend,
            sourceKind: reading?.sourceKind ?? (episode?.audioURL?.isFileURL == true ? "Local file" : "Podcast episode"),
            sourceIdentityHash: reading?.sourceIdentityHash ?? episode.map { MediaKey(accountID: nil, episode: $0).rawValue },
            options: reading?.options ?? options,
            signal: reading?.signal,
            output: reading?.output,
            limiterReductionDB: reading?.limiterReductionDB,
            diagnostics: reading?.diagnostics,
            route: reading?.route ?? .current,
            events: reading?.events ?? events,
            comparison: comparison,
            view: AudioLabCaptureView(frozen: isFrozen, windowStart: start, windowEnd: end, measurementEnabled: isEnabled)
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return AudioLabCaptureDocument(data: try encoder.encode(capture))
    }
}

private actor AudioLabMeterWorker {
    private var epoch: UUID?
    private var meter: AudioSignalMeter?
    private var reduction: Float?

    func measure(_ packets: [AudioOutputInspectionPacket], epoch: UUID) -> (metrics: AudioSignalMetrics?, reduction: Float?) {
        if self.epoch != epoch {
            self.epoch = epoch
            meter = nil
            reduction = nil
        }
        for packet in packets where packet.epoch == epoch {
            guard packet.sampleRate.isFinite, (8_000...192_000).contains(packet.sampleRate), (1...2).contains(packet.channels), packet.interleavedSamples.count.isMultiple(of: packet.channels) else { continue }
            if meter?.sampleRate != packet.sampleRate || meter?.channels != packet.channels {
                meter = AudioSignalMeter(sampleRate: packet.sampleRate, channels: packet.channels)
            }
            meter?.process(packet.interleavedSamples, outputStartFrame: packet.outputStartFrame)
            reduction = packet.limiterReductionDB.isFinite ? packet.limiterReductionDB : nil
        }
        return (meter?.metrics, reduction)
    }
}

struct AudioLabCaptureDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data: Data

    init(data: Data = Data()) { self.data = data }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else { throw CocoaError(.fileReadCorruptFile) }
        self.data = data
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}
