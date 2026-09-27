import AVFoundation
import Foundation

protocol PCMDecoder: Actor {
    func open(url: URL, at position: TimeInterval, generation: UUID) async throws -> LocalAudioFileInfo
    func read(slot: Int, generation: UUID) async throws -> LocalAudioDecodedBlock
    func release(slot: Int, generation: UUID) async
    func silence(slot: Int, frames: AVAudioFrameCount, generation: UUID) async throws -> LocalAudioBufferLease
    func close(generation: UUID) async
    func allocatedBytes() async -> UInt64
}

extension LocalAudioDecoder: PCMDecoder {}
