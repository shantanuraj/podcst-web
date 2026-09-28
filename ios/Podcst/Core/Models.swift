import Foundation

public struct EpisodeFile: Codable, Hashable, Sendable {
    public var url: String
    public var length: Int64
    public var type: String

    public init(url: String, length: Int64 = 0, type: String = "audio/mpeg") {
        self.url = url
        self.length = length
        self.type = type
    }
}

public struct Episode: Codable, Hashable, Sendable, Identifiable {
    public var id: Int?
    public var podcastId: Int?
    public var guid: String
    public var feed: String
    public var podcastTitle: String?
    public var title: String
    public var summary: String?
    public var published: Date?
    public var cover: String
    public var explicit: Bool
    public var duration: Double?
    public var link: String?
    public var episodeArt: String?
    public var showNotes: String
    public var author: String?
    public var file: EpisodeFile

    public init(id: Int? = nil, podcastId: Int? = nil, guid: String, feed: String, podcastTitle: String? = nil, title: String, summary: String? = nil, published: Date? = nil, cover: String = "", explicit: Bool = false, duration: Double? = nil, link: String? = nil, episodeArt: String? = nil, showNotes: String = "", author: String? = nil, file: EpisodeFile) {
        self.id = id
        self.podcastId = podcastId
        self.guid = guid
        self.feed = feed
        self.podcastTitle = podcastTitle
        self.title = title
        self.summary = summary
        self.published = published
        self.cover = cover
        self.explicit = explicit
        self.duration = duration
        self.link = link
        self.episodeArt = episodeArt
        self.showNotes = showNotes
        self.author = author
        self.file = file
    }

    public var identity: String { "\(feed)\u{001F}\(guid)" }
    public var audioURL: URL? { URL(string: file.url) }
    public var artworkURL: URL? { URL(string: episodeArt ?? cover) }
    public var shareURL: URL? {
        webpageForSharing(link, excluding: [feed, file.url])
    }
}

public struct Podcast: Codable, Hashable, Sendable, Identifiable {
    public var id: Int?
    public var feed: String
    public var title: String
    public var author: String
    public var cover: String
    public var thumbnail: String
    public var description: String
    public var link: String?
    public var published: Date?
    public var explicit: Bool
    public var keywords: [String]
    public var episodeCount: Int
    public var episodes: [Episode]

    public init(id: Int? = nil, feed: String, title: String, author: String = "", cover: String = "", thumbnail: String = "", description: String = "", link: String? = nil, published: Date? = nil, explicit: Bool = false, keywords: [String] = [], episodeCount: Int = 0, episodes: [Episode] = []) {
        self.id = id
        self.feed = feed
        self.title = title
        self.author = author
        self.cover = cover
        self.thumbnail = thumbnail
        self.description = description
        self.link = link
        self.published = published
        self.explicit = explicit
        self.keywords = keywords
        self.episodeCount = episodeCount
        self.episodes = episodes
    }

    public var identity: String { feed }
    public var artworkURL: URL? { URL(string: cover) }
    public var shareURL: URL? { webpageForSharing(link, excluding: [feed]) }
}

private func webpageForSharing(_ link: String?, excluding sources: [String]) -> URL? {
    guard let link, let url = URL(string: link), let scheme = url.scheme,
          ["https", "http"].contains(scheme.lowercased()),
          url.host?.isEmpty == false, url.user == nil, url.password == nil,
          !sources.compactMap(URL.init(string:)).contains(url) else { return nil }
    return url
}

public struct EpisodePage: Codable, Hashable, Sendable {
    public var episodes: [Episode]
    public var total: Int
    public var hasMore: Bool
    public var nextCursor: Int?

    public init(episodes: [Episode], total: Int, hasMore: Bool, nextCursor: Int? = nil) {
        self.episodes = episodes
        self.total = total
        self.hasMore = hasMore
        self.nextCursor = nextCursor
    }
}

public struct User: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var email: String
    public var name: String?
    public var image: String?
    public var hasPasskey: Bool

    public init(id: String, email: String, name: String? = nil, image: String? = nil, hasPasskey: Bool = false) {
        self.id = id
        self.email = email
        self.name = name
        self.image = image
        self.hasPasskey = hasPasskey
    }
}

public struct PlaybackProgress: Codable, Hashable, Sendable {
    public var episode: Episode
    public var position: Double

    public init(episode: Episode, position: Double) {
        self.episode = episode
        self.position = position
    }
}

public struct ProgressSaveResponse: Codable, Hashable, Sendable {
    public var success: Bool
}

public struct SubscriptionImportResult: Codable, Hashable, Sendable {
    public var succeeded: Int
    public var failed: Int
}

public struct APIError: Error, Codable, LocalizedError, Sendable {
    public var statusCode: Int
    public var message: String

    public init(statusCode: Int, message: String) {
        self.statusCode = statusCode
        self.message = message
    }

    public var errorDescription: String? { message }
}
