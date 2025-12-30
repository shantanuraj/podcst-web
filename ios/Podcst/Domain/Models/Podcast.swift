import Foundation

enum ExplicitState: String, Codable, Sendable {
    case explicit
    case cleaned
    case notExplicit
}

struct FileInfo: Codable, Sendable, Hashable {
    let url: String
    let length: Int
    let type: String
}

struct Podcast: Codable, Sendable, Identifiable, Hashable {
    let id: Int
    let itunesId: Int?
    let author: String
    let feed: String
    let title: String
    let cover: String
    let thumbnail: String
    let categories: [Int]
    let explicit: ExplicitState
    let count: Int

    enum CodingKeys: String, CodingKey {
        case id
        case itunesId = "itunes_id"
        case author
        case feed
        case title
        case cover
        case thumbnail
        case categories
        case explicit
        case count
    }
}

struct PodcastInfo: Codable, Sendable, Identifiable, Hashable {
    let id: Int
    let feed: String
    let title: String
    let author: String
    let cover: String
    let description: String
    let link: String?
    let published: Int?
    let explicit: Bool
    let keywords: [String]
    let episodeCount: Int
}

struct PodcastSearchResult: Codable, Sendable, Identifiable, Hashable {
    let id: Int?
    let author: String
    let feed: String
    let thumbnail: String
    let title: String

    var stableId: String { id.map { String($0) } ?? feed }
}

struct PodcastWithEpisodes: Codable, Sendable, Identifiable {
    let id: Int?
    let feed: String
    let title: String
    let link: String?
    let published: Int?
    let description: String
    let author: String
    let cover: String
    let keywords: [String]
    let explicit: Bool
    let episodes: [Episode]

    var stableId: String { id.map { String($0) } ?? feed }
}
