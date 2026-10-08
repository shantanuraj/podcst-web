import Foundation

// The old unsequenced file is migration input only. DurableStateStore owns all writes.
enum PlaybackProgressWriter {
    struct Update: Codable, Equatable, Sendable {
        let episodeID: Int
        let position: TimeInterval
        let completed: Bool
    }

}
