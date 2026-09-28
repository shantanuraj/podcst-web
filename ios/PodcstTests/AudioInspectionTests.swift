import AVFoundation
import XCTest
@testable import Podcst

@MainActor
final class AudioInspectionTests: XCTestCase {
    func testEnvelopePreservesChannelExtremaAndEnergyOnSourceTimeline() throws {
        let epoch = UUID()
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 8_000, channels: 2))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 80))
        buffer.frameLength = 80
        for frame in 0..<80 {
            buffer.floatChannelData?[0][frame] = -0.25
            buffer.floatChannelData?[1][frame] = 0.5
        }
        let collector = AudioInspectionCollector(epoch: epoch, sampleRate: 8_000)
        collector.consume(buffer, offset: 0, count: 35, sourceStart: 8_000)
        collector.consume(buffer, offset: 35, count: 45, sourceStart: 8_035)
        let packet = collector.take(output: buffer, spans: [AudioSourceSpan(sourceStart: 8_000, outputStart: 0, frameCount: 80)], ended: true)
        let envelope = try XCTUnwrap(packet.original.first)
        XCTAssertEqual(packet.original.count, 1)
        XCTAssertEqual(packet.original, packet.processed)
        XCTAssertEqual(envelope.sourceStart, 1)
        XCTAssertEqual(envelope.sourceEnd, 1.01)
        XCTAssertEqual(envelope.minimum, -0.25)
        XCTAssertEqual(envelope.maximum, 0.5)
        XCTAssertEqual(envelope.rms, Float(sqrt((0.25 * 0.25 + 0.5 * 0.5) / 2)), accuracy: 0.000001)
    }

    func testInspectionGatesSamplesGainAndCutsAtPresentation() {
        let epoch = UUID()
        var store = AudioInspectionStore(epoch: epoch, sampleRate: 100, sourceStart: 0)
        let envelope = AudioInspectionEnvelope(sourceStart: 0, sourceEnd: 0.1, minimum: -0.2, maximum: 0.2, rms: 0.1)
        let packet = AudioInspectionPacket(epoch: epoch, original: [envelope], processed: [envelope], gainReadings: [AudioInspectionGain(sourceTime: 0.1, decibels: 4)], applied: [])
        store.append(packet, spans: [AudioSourceSpan(sourceStart: 0, outputStart: 0, frameCount: 10), AudioSourceSpan(sourceStart: 90, outputStart: 10, frameCount: 10)], fileEndFrame: nil)
        let unheard = store.snapshot(presentedSourceTime: 0)
        XCTAssertTrue(unheard.original.isEmpty)
        XCTAssertTrue(unheard.processed.isEmpty)
        XCTAssertTrue(unheard.gainReadings.isEmpty)
        XCTAssertTrue(unheard.cuts.isEmpty)
        XCTAssertEqual(unheard.removedSourceSeconds, 0)
        let beforeCut = store.snapshot(presentedSourceTime: 0.1)
        XCTAssertEqual(beforeCut.original, [envelope])
        XCTAssertEqual(beforeCut.gainReadings.count, 1)
        XCTAssertTrue(beforeCut.cuts.isEmpty)
        let afterCut = store.snapshot(presentedSourceTime: 0.9)
        XCTAssertEqual(afterCut.cuts, [AudioInspectionCut(sourceStart: 0.1, sourceEnd: 0.9)])
        XCTAssertEqual(afterCut.removedSourceSeconds, 0.8, accuracy: 0.000001)
        XCTAssertEqual(store.snapshot(presentedSourceTime: 1).removedSourceSeconds, 0.8, accuracy: 0.000001)
    }

    func testSeekEpochRejectsOldDataAndDoesNotCreateSilenceCut() {
        let oldEpoch = UUID()
        let epoch = UUID()
        var store = AudioInspectionStore(epoch: epoch, sampleRate: 100, sourceStart: 500)
        let oldPacket = AudioInspectionPacket(epoch: oldEpoch, original: [], processed: [], gainReadings: [], applied: [])
        store.append(oldPacket, spans: [AudioSourceSpan(sourceStart: 0, outputStart: 0, frameCount: 100)], fileEndFrame: nil)
        let packet = AudioInspectionPacket(epoch: epoch, original: [], processed: [], gainReadings: [], applied: [])
        store.append(packet, spans: [AudioSourceSpan(sourceStart: 500, outputStart: 0, frameCount: 100)], fileEndFrame: 600)
        let snapshot = store.snapshot(presentedSourceTime: 6)
        XCTAssertTrue(snapshot.cuts.isEmpty)
        XCTAssertEqual(snapshot.removedSourceSeconds, 0)
    }

    func testInspectionHistoryAndEventsStayBounded() throws {
        let epoch = UUID()
        var store = AudioInspectionStore(epoch: epoch, sampleRate: 100)
        for index in 0..<10_000 {
            let end = Double(index + 1) / 100
            let envelope = AudioInspectionEnvelope(sourceStart: Double(index) / 100, sourceEnd: end, minimum: -0.1, maximum: 0.1, rms: 0.05)
            let packet = AudioInspectionPacket(epoch: epoch, original: [envelope], processed: [envelope], gainReadings: [AudioInspectionGain(sourceTime: end, decibels: 2)], applied: [])
            store.append(packet, spans: [], fileEndFrame: nil)
            store.record(AudioInspectionEvent(kind: .rate, sourceTime: end, value: 1))
        }
        let snapshot = store.snapshot(presentedSourceTime: 100)
        XCTAssertEqual(snapshot.original.count, AudioInspectionStore.envelopeCapacity)
        XCTAssertEqual(snapshot.processed.count, AudioInspectionStore.envelopeCapacity)
        XCTAssertEqual(snapshot.gainReadings.count, AudioInspectionStore.envelopeCapacity)
        XCTAssertEqual(snapshot.events.count, AudioInspectionStore.eventCapacity)
        XCTAssertGreaterThanOrEqual(try XCTUnwrap(snapshot.original.first).sourceStart, 40)
        let data = try JSONEncoder().encode(snapshot)
        XCTAssertEqual(try JSONDecoder().decode(AudioInspectionSnapshot.self, from: data), snapshot)
    }

    func testOptInInspectionPreservesPCMAndReportsActualRemovedFrames() async throws {
        let url = try fixture(sampleRate: 8_000, seconds: 4)
        let baseline = try await decode(url: url, inspection: false)
        let inspected = try await decode(url: url, inspection: true)
        XCTAssertEqual(inspected.samples, baseline.samples)
        XCTAssertNil(baseline.snapshot)
        let snapshot = try XCTUnwrap(inspected.snapshot)
        XCTAssertFalse(snapshot.original.isEmpty)
        XCTAssertFalse(snapshot.processed.isEmpty)
        XCTAssertFalse(snapshot.cuts.isEmpty)
        XCTAssertGreaterThan(snapshot.removedSourceSeconds, 0.5)
        XCTAssertEqual(snapshot.removedSourceSeconds, 4 - Double(inspected.samples.count) / 8_000, accuracy: 1.0 / 8_000)
        XCTAssertEqual(snapshot.original.first?.sourceStart, 0)
        XCTAssertEqual(snapshot.original.last?.sourceEnd, 4)
        XCTAssertEqual(snapshot.processed.last?.sourceEnd, 4)
        XCTAssertTrue(snapshot.gainReadings.allSatisfy { $0.decibels.isFinite && $0.sourceTime <= 4 })
    }

    func testTransportHidesDecodedAheadInspectionAndResetsAfterSeek() async throws {
        let url = try fixture(sampleRate: 48_000, seconds: 4)
        let transport = LocalAudioTransport(configuration: LocalAudioConfiguration(output: .offline(sampleRate: 48_000, channels: 1, maximumFrames: 1024), blockFrames: 1024, bufferCount: 8))
        defer { transport.shutdown() }
        XCTAssertNil(transport.inspectionSnapshot())
        transport.configureInspection(enabled: true)
        transport.load(source: .url(url), at: 0, generation: UUID())
        try await transport.waitUntilReady()
        let initial = try XCTUnwrap(transport.inspectionSnapshot())
        XCTAssertTrue(initial.original.isEmpty)
        XCTAssertTrue(initial.processed.isEmpty)
        XCTAssertGreaterThan(transport.diagnostics.decodedThroughFrame, 0)
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024))
        transport.play(atRate: 1)
        for _ in 0..<4 { _ = try await transport.renderOffline(frames: 1024, into: buffer) }
        let playing = try XCTUnwrap(transport.inspectionSnapshot())
        XCTAssertFalse(playing.original.isEmpty)
        XCTAssertTrue(playing.original.allSatisfy { $0.sourceEnd <= transport.position })
        XCTAssertTrue(playing.processed.allSatisfy { $0.sourceEnd <= transport.position })
        let output = transport.takeOutputInspection()
        XCTAssertFalse(output.isEmpty)
        XCTAssertTrue(output.allSatisfy { $0.epoch == playing.epoch && $0.channels == 1 && $0.sampleRate == 48_000 })
        transport.seek(to: 3, generation: UUID())
        try await transport.waitUntilReady()
        let sought = try XCTUnwrap(transport.inspectionSnapshot())
        XCTAssertNotEqual(sought.epoch, playing.epoch)
        XCTAssertTrue(sought.cuts.isEmpty)
        XCTAssertTrue(sought.original.isEmpty)
        XCTAssertEqual(sought.removedSourceSeconds, 0)
        transport.configureInspection(enabled: false)
        XCTAssertNil(transport.inspectionSnapshot())
        XCTAssertTrue(transport.takeOutputInspection().isEmpty)
    }

    private func decode(url: URL, inspection enabled: Bool) async throws -> (samples: [Float], snapshot: AudioInspectionSnapshot?) {
        let decoder = AudioProcessingDecoder(source: LocalAudioDecoder(blockFrames: 512, bufferCount: 2), blockFrames: 512, bufferCount: 2)
        let generation = UUID()
        let epoch = UUID()
        try await decoder.configure(AudioEffects(volumeBoost: true, trimSilence: true), revision: 1)
        await decoder.configureInspection(epoch: enabled ? epoch : nil)
        let info = try await decoder.open(url: url, at: 0, generation: generation)
        var store = AudioInspectionStore(epoch: epoch, sampleRate: info.sampleRate, sourceStart: 0)
        var samples: [Float] = []
        for _ in 0..<1_000 {
            let block = try await decoder.read(slot: 0, generation: generation)
            let data = try XCTUnwrap(block.lease.buffer.floatChannelData?[0])
            samples.append(contentsOf: UnsafeBufferPointer(start: data, count: Int(block.lease.buffer.frameLength)))
            if let packet = block.inspection {
                store.append(packet, spans: block.spans, fileEndFrame: block.fileEndFrame)
            } else {
                XCTAssertFalse(enabled)
            }
            await decoder.release(slot: 0, generation: generation)
            if block.endOfFile { break }
        }
        await decoder.close(generation: generation)
        return (samples, enabled ? store.snapshot(presentedSourceTime: info.duration) : nil)
    }

    private func fixture(sampleRate: Double, seconds: Int) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("wav")
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1))
        var settings = format.settings
        settings.removeValue(forKey: AVLinearPCMIsNonInterleaved)
        let file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(sampleRate)))
        buffer.frameLength = AVAudioFrameCount(sampleRate)
        for second in 0..<seconds {
            for frame in 0..<Int(sampleRate) {
                buffer.floatChannelData?[0][frame] = second == 0 || second == seconds - 1 ? Float(sin(Double(frame) * 2 * .pi * 397 / sampleRate)) * 0.08 : 0
            }
            try file.write(from: buffer)
        }
        return url
    }
}
