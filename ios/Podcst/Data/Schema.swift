import Foundation
import SwiftData

@Model
final class CachedPodcast {
    @Attribute(.unique) var id: Int
    var itunesId: Int?
    var title: String
    var author: String
    var feed: String
    var cover: String
    var thumbnail: String
    var podcastDescription: String
    var link: String?
    var published: Date?
    var explicit: Bool
    var keywords: [String]
    var episodeCount: Int
    var cachedAt: Date

    @Relationship(deleteRule: .cascade, inverse: \CachedEpisode.podcast)
    var episodes: [CachedEpisode] = []

    init(
        id: Int,
        itunesId: Int? = nil,
        title: String,
        author: String,
        feed: String,
        cover: String,
        thumbnail: String,
        podcastDescription: String,
        link: String? = nil,
        published: Date? = nil,
        explicit: Bool,
        keywords: [String],
        episodeCount: Int
    ) {
        self.id = id
        self.itunesId = itunesId
        self.title = title
        self.author = author
        self.feed = feed
        self.cover = cover
        self.thumbnail = thumbnail
        self.podcastDescription = podcastDescription
        self.link = link
        self.published = published
        self.explicit = explicit
        self.keywords = keywords
        self.episodeCount = episodeCount
        self.cachedAt = Date()
    }
}

@Model
final class CachedEpisode {
    @Attribute(.unique) var id: Int
    var podcastId: Int
    var guid: String
    var title: String
    var summary: String?
    var published: Date?
    var duration: Int?
    var episodeArt: String?
    var cover: String
    var explicit: Bool
    var showNotes: String
    var author: String?
    var fileUrl: String
    var fileLength: Int
    var fileType: String
    var feed: String
    var podcastTitle: String
    var cachedAt: Date

    var podcast: CachedPodcast?

    @Relationship(deleteRule: .cascade, inverse: \DownloadedEpisode.episode)
    var download: DownloadedEpisode?

    init(
        id: Int,
        podcastId: Int,
        guid: String,
        title: String,
        summary: String?,
        published: Date?,
        duration: Int?,
        episodeArt: String?,
        cover: String,
        explicit: Bool,
        showNotes: String,
        author: String?,
        fileUrl: String,
        fileLength: Int,
        fileType: String,
        feed: String,
        podcastTitle: String
    ) {
        self.id = id
        self.podcastId = podcastId
        self.guid = guid
        self.title = title
        self.summary = summary
        self.published = published
        self.duration = duration
        self.episodeArt = episodeArt
        self.cover = cover
        self.explicit = explicit
        self.showNotes = showNotes
        self.author = author
        self.fileUrl = fileUrl
        self.fileLength = fileLength
        self.fileType = fileType
        self.feed = feed
        self.podcastTitle = podcastTitle
        self.cachedAt = Date()
    }
}

@Model
final class DownloadedEpisode {
    @Attribute(.unique) var episodeId: Int
    var podcastId: Int
    var localPath: String
    var downloadedAt: Date
    var fileSize: Int64

    var episode: CachedEpisode?

    init(episodeId: Int, podcastId: Int, localPath: String, fileSize: Int64) {
        self.episodeId = episodeId
        self.podcastId = podcastId
        self.localPath = localPath
        self.fileSize = fileSize
        self.downloadedAt = Date()
    }

    var localURL: URL? {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        return documents?.appendingPathComponent(localPath)
    }
}

@Model
final class LocalPlaybackProgress {
    @Attribute(.unique) var episodeId: Int
    var position: TimeInterval
    var completed: Bool
    var updatedAt: Date

    init(episodeId: Int, position: TimeInterval, completed: Bool = false) {
        self.episodeId = episodeId
        self.position = position
        self.completed = completed
        self.updatedAt = Date()
    }
}

@Model
final class LocalSubscription {
    @Attribute(.unique) var podcastId: Int
    var feed: String
    var subscribedAt: Date

    init(podcastId: Int, feed: String) {
        self.podcastId = podcastId
        self.feed = feed
        self.subscribedAt = Date()
    }
}
