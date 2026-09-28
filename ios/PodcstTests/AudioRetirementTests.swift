import AVFoundation
import XCTest
@testable import Podcst

@MainActor
final class AudioRetirementTests: XCTestCase {
    func testShutdownWaitsForTheCloseAlreadyStartedByASeek() async throws {
        let url = try fixture()
        defer { try? FileManager.default.removeItem(at: url) }
        let decoder = RetirementDecoder()
        let transport = makeTransport(decoder: decoder)
        transport.load(source: .url(url), at: 0, generation: UUID())
        try await transport.waitUntilReady()
        await decoder.holdNextClose()
        transport.seek(to: 0.25, generation: UUID())
        await decoder.waitForHeldClose()

        let returnedBeforeClose = expectation(description: "Shutdown must retain the in-flight close")
        returnedBeforeClose.isInverted = true
        transport.shutdown()
        let shutdown = Task {
            await transport.shutdownAndWait()
            if !(await decoder.heldCloseFinished) { returnedBeforeClose.fulfill() }
        }
        await fulfillment(of: [returnedBeforeClose], timeout: 0.25)
        await decoder.releaseHeldClose()
        await shutdown.value

        let state = await decoder.state
        XCTAssertTrue(state.heldCloseFinished)
        XCTAssertEqual(state.opens, 1)
        XCTAssertEqual(state.closes, 1)
        XCTAssertFalse(transport.hasSource)
        XCTAssertFalse(transport.diagnostics.isPlaying)
    }

    func testShutdownRejectsSubsequentPlaybackCommands() async throws {
        let url = try fixture()
        defer { try? FileManager.default.removeItem(at: url) }
        let decoder = RetirementDecoder()
        let transport = makeTransport(decoder: decoder)
        transport.load(source: .url(url), at: 0, generation: UUID())
        try await transport.waitUntilReady()
        await transport.shutdownAndWait()

        transport.load(source: .url(url), at: 0, generation: UUID())
        transport.play(atRate: 1)
        transport.seek(to: 0.25, generation: UUID())
        transport.setEffects(AudioEffects(volumeBoost: true, trimSilence: true))
        await transport.shutdownAndWait()

        let state = await decoder.state
        XCTAssertEqual(state.opens, 1)
        XCTAssertEqual(state.closes, 1)
        XCTAssertFalse(transport.hasSource)
        XCTAssertFalse(transport.diagnostics.isReady)
        XCTAssertFalse(transport.diagnostics.isPlaying)
    }

    private func makeTransport(decoder: RetirementDecoder) -> LocalAudioTransport {
        LocalAudioTransport(configuration: LocalAudioConfiguration(output: .offline(sampleRate: 48_000, channels: 1, maximumFrames: 1024)), sourceDecoder: decoder)
    }

    private func fixture() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("wav")
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 48_000))
        buffer.frameLength = buffer.frameCapacity
        buffer.floatChannelData![0].update(repeating: 0.1, count: Int(buffer.frameLength))
        let file = try AVAudioFile(forWriting: url, settings: format.settings)
        try file.write(from: buffer)
        return url
    }
}

private actor RetirementDecoder: PCMDecoder {
    struct State: Sendable {
        var opens = 0
        var closes = 0
        var heldCloseFinished = false
    }

    private let decoder = LocalAudioDecoder(blockFrames: 1024, bufferCount: 2)
    private var holdClose = false
    private var closeStarted = false
    private var closeWaiter: CheckedContinuation<Void, Never>?
    private var closeRelease: CheckedContinuation<Void, Never>?
    private(set) var state = State()
    var heldCloseFinished: Bool { state.heldCloseFinished }

    func holdNextClose() { holdClose = true }

    func waitForHeldClose() async {
        if closeStarted { return }
        await withCheckedContinuation { closeWaiter = $0 }
    }

    func releaseHeldClose() {
        closeRelease?.resume()
        closeRelease = nil
    }

    func open(url: URL, at position: TimeInterval, generation: UUID) async throws -> LocalAudioFileInfo {
        state.opens += 1
        return try await decoder.open(url: url, at: position, generation: generation)
    }

    func read(slot: Int, generation: UUID) async throws -> LocalAudioDecodedBlock {
        try await decoder.read(slot: slot, generation: generation)
    }

    func release(slot: Int, generation: UUID) async {
        await decoder.release(slot: slot, generation: generation)
    }

    func silence(slot: Int, frames: AVAudioFrameCount, generation: UUID) async throws -> LocalAudioBufferLease {
        try await decoder.silence(slot: slot, frames: frames, generation: generation)
    }

    func close(generation: UUID) async {
        state.closes += 1
        if holdClose {
            holdClose = false
            closeStarted = true
            closeWaiter?.resume()
            closeWaiter = nil
            await withCheckedContinuation { closeRelease = $0 }
            await decoder.close(generation: generation)
            state.heldCloseFinished = true
        } else {
            await decoder.close(generation: generation)
        }
    }

    func allocatedBytes() async -> UInt64 {
        await decoder.allocatedBytes()
    }
}
