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
    public var isPrivate: Bool?
    @StoredCatalogueID public var id: Int?
    @StoredCatalogueID public var podcastId: Int?
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

    public init(id: Int? = nil, podcastId: Int? = nil, guid: String, feed: String, podcastTitle: String? = nil, title: String, summary: String? = nil, published: Date? = nil, cover: String = "", explicit: Bool = false, duration: Double? = nil, link: String? = nil, episodeArt: String? = nil, showNotes: String = "", author: String? = nil, file: EpisodeFile, isPrivate: Bool = false) {
        self.isPrivate = isPrivate
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

    public var identity: String { id.map { "episode:\($0)" } ?? podcastId.map { "local:podcast:\($0)\u{001F}\(guid)" } ?? "local:\(feed)\u{001F}\(guid)" }
    var retainedMediaIdentity: String {
        if let value = id ?? _id.unresolved.map(Int.init) { return "episode:\(value)" }
        if let value = podcastId ?? _podcastId.unresolved.map(Int.init) { return "podcast:\(value):\(guid)" }
        return "\(feed)\u{001F}\(guid)"
    }
    public var audioURL: URL? { URL(string: file.url) }
    public var artworkURL: URL? { URL(string: episodeArt ?? cover) }
}

public struct Podcast: Codable, Hashable, Sendable, Identifiable {
    public var isPrivate: Bool?
    @StoredCatalogueID public var id: Int?
    @StoredCatalogueID public var itunesId: Int?
    public var itunesLocale: String?
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

    public init(id: Int? = nil, itunesId: Int? = nil, itunesLocale: String? = nil, feed: String, title: String, author: String = "", cover: String = "", thumbnail: String = "", description: String = "", link: String? = nil, published: Date? = nil, explicit: Bool = false, keywords: [String] = [], episodeCount: Int = 0, episodes: [Episode] = [], isPrivate: Bool = false) {
        self.isPrivate = isPrivate
        self.id = id
        self.itunesId = itunesId
        self.itunesLocale = itunesLocale
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

    public var identity: String { id.map { "podcast:\($0)" } ?? "local:\(feed)" }
    public var artworkURL: URL? { URL(string: cover) }
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

struct EpisodeProgress: Codable, Equatable, Sendable {
    var episodeId: Int
    var position: Double
    var completed: Bool
}

public struct ProgressSaveResponse: Codable, Hashable, Sendable {
    public var success: Bool
}

public struct SubscriptionImportResult: Codable, Hashable, Sendable {
    public var succeeded: Int
    public var failed: Int
}

struct Passkey: Hashable, Sendable, Identifiable {
    var id: String
    var provider: String?
    var created: Date
    var lastUsed: Date?
}

struct Account: Equatable, Sendable {
    var created: Date?
    var passkeys: [Passkey]
    var preferences: AudioOptions?
}

struct AccountEpisodeList: Codable, Equatable, Sendable {
    var id: String
    var kind: String
    var name: String?
    var revision: String
    var itemCount: Int
}

enum ListAvailability: String, Codable, Sendable {
    case available
    case contentMissing = "content_missing"
    case unavailable
}

struct ListMembership: Codable, Hashable, Sendable {
    var episodeId: Int
    var addedAt: Double
    var availability: ListAvailability
}

struct ListSnapshot: Codable, Equatable, Sendable {
    var scope: StateScope? = nil
    var listId: String
    var revision: String
    var items: [ListMembership]
}

struct ListEpisodeItem: Sendable {
    var membership: ListMembership
    var episode: Episode?
}

struct ListEpisodePage: Sendable {
    var scope: StateScope? = nil
    var listId: String
    var revision: String
    var items: [ListEpisodeItem]
    var nextCursor: String?
}

struct ListChange: Codable, Equatable, Sendable {
    enum Operation: String, Codable, Sendable { case add, remove }
    var op: Operation
    var episodeId: Int
}

struct ListBatch: Codable, Equatable, Sendable {
    var scope: StateScope? = nil
    var clientId: String
    var sequence: String
    var changes: [ListChange]
}

struct ListChangeResult: Codable, Equatable, Sendable {
    enum Status: String, Codable, Sendable {
        case applied, unchanged
        case notFound = "not_found"
    }
    var episodeId: Int
    var status: Status
}

struct ListAcknowledgement: Codable, Equatable, Sendable {
    var scope: StateScope? = nil
    var clientId: String
    var sequence: String
    var listId: String
    var revision: String
    var results: [ListChangeResult]
}

public struct APIError: Error, Codable, LocalizedError, Sendable {
    public var statusCode: Int
    public var message: String

    public var code: String?
    public var retryAfter: Double?

    public init(statusCode: Int, message: String, code: String? = nil, retryAfter: Double? = nil) {
        self.code = code
        self.retryAfter = retryAfter
        self.statusCode = statusCode
        self.message = message
    }

    public var errorDescription: String? { message }
}

struct StarLists: Sendable {
    var scope: StateScope
    var lists: [AccountEpisodeList]
}

@propertyWrapper public struct StoredCatalogueID: Codable, Hashable, Sendable {
    public var wrappedValue: Int?
    fileprivate var unresolved: Int64?
    public init(wrappedValue: Int? = nil) { self.wrappedValue = wrappedValue }
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { wrappedValue = nil; return }
        if let string = try? c.decode(String.self) {
            wrappedValue = try StateID(string).number
        } else {
            let number = try c.decode(Int64.self)
            if number > 0, number <= 9_007_199_254_740_991 { wrappedValue = Int(number) }
            else { wrappedValue = nil; unresolved = number }
        }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        if let wrappedValue { try c.encode(String(wrappedValue)) }
        else if let unresolved { try c.encode(unresolved) }
        else { try c.encodeNil() }
    }
}
extension KeyedDecodingContainer {
    func decode(_ type: StoredCatalogueID.Type, forKey key: Key) throws -> StoredCatalogueID {
        try decodeIfPresent(type, forKey: key) ?? StoredCatalogueID()
    }
}
