import Foundation

enum PlaybackSource: Sendable {
    case url(URL, contentType: String? = nil)
    case episode(Episode)

    var url: URL? {
        switch self {
        case .url(let url, _): url
        case .episode(let episode): episode.audioURL
        }
    }

    var contentType: String? {
        let value: String?
        switch self {
        case .url(_, let contentType): value = contentType
        case .episode(let episode): value = episode.file.type
        }
        guard let value, !value.isEmpty, value.lowercased() != "application/octet-stream" else { return nil }
        return value
    }
}

struct PlaybackTransportUpdate: Sendable {
    let generation: UUID
    let event: PlaybackTransportEvent
}

enum PlaybackTransportEvent: Sendable {
    case ready(duration: TimeInterval)
    case duration(TimeInterval)
    case position(TimeInterval)
    case playback(isPlaying: Bool)
    case seeked(TimeInterval)
    case ended
    case failed
    case effects(AudioEffectState)
}

@MainActor
protocol PlaybackTransport: AnyObject, Sendable {
    var onUpdate: (@MainActor (PlaybackTransportUpdate) -> Void)? { get set }
    var hasSource: Bool { get }
    var position: TimeInterval { get }
    func load(source: PlaybackSource, at position: TimeInterval, generation: UUID)
    func play(atRate rate: Double)
    func pause()
    func seek(to position: TimeInterval, generation: UUID)
    func setRate(_ rate: Double)
    func setEffects(_ effects: AudioEffects)
    func stop()
    func shutdown()
}
