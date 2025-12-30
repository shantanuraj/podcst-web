import Foundation

struct Episode: Codable, Sendable, Identifiable, Hashable {
    let id: Int?
    let podcastId: Int?
    let guid: String
    let title: String
    let summary: String?
    let published: Int?
    let cover: String
    let explicit: Bool
    let duration: Int?
    let link: String?
    let file: FileInfo
    let author: String?
    let episodeArt: String?
    let showNotes: String
    let feed: String
    let podcastTitle: String?

    var stableId: String { id.map { String($0) } ?? guid }

    var publishedDate: Date? {
        published.map { Date(timeIntervalSince1970: TimeInterval($0)) }
    }

    var durationSeconds: TimeInterval? {
        duration.map { TimeInterval($0) }
    }

    var artworkURL: URL? {
        URL(string: episodeArt ?? cover)
    }

    var audioURL: URL? {
        URL(string: file.url)
    }
}

struct PaginatedEpisodes: Codable, Sendable {
    let episodes: [Episode]
    let total: Int
    let hasMore: Bool
    let nextCursor: Int?
}

struct PlaybackProgress: Codable, Sendable {
    let episode: Episode
    let position: Int
}
