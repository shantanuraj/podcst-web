import Foundation

enum PlaybackProgressWriter {
    struct Update: Codable, Equatable, Sendable {
        let episodeID: Int
        let position: TimeInterval
        let completed: Bool
    }

}
