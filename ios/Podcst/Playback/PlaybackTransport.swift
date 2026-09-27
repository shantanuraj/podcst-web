import Foundation

struct PlaybackTransportUpdate: Sendable {
    let generation: UUID
    let event: PlaybackTransportEvent
}

enum PlaybackTransportEvent: Sendable {
    case ready(duration: TimeInterval)
    case position(TimeInterval)
    case playback(isPlaying: Bool)
    case seeked(TimeInterval)
    case ended
    case failed
}

@MainActor
protocol PlaybackTransport: AnyObject, Sendable {
    var onUpdate: (@MainActor (PlaybackTransportUpdate) -> Void)? { get set }
    var hasSource: Bool { get }
    var position: TimeInterval { get }
    func load(url: URL, at position: TimeInterval, generation: UUID)
    func play(atRate rate: Double)
    func pause()
    func seek(to position: TimeInterval, generation: UUID)
    func setRate(_ rate: Double)
    func stop()
    func shutdown()
}
