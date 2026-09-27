import CryptoKit
import Foundation

struct MediaKey: Hashable, Codable, Sendable {
    let rawValue: String

    init(accountID: String?, episode: Episode) {
        let identity = episode.id.map { "episode:\($0)" } ?? episode.podcastId.map { "podcast:\($0):\(episode.guid)" } ?? episode.identity
        rawValue = Self.digest(Self.scope(accountID) + "\u{001F}" + identity)
    }

    init(rawValue: String) { self.rawValue = rawValue }

    static func scope(_ accountID: String?) -> String {
        digest(accountID.map { "account:\($0)" } ?? "anonymous")
    }

    static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

enum MediaFailure: Error, Equatable, Codable, Sendable {
    case invalidSource
    case invalidResponse
    case unavailable(Int)
    case representationChanged
    case requiresCompleteFile
    case cancelled
    case storageUnavailable
    case pinned
    case accountChanged
    case unsupportedMedia
}

enum MediaCapability: Codable, Equatable, Sendable {
    case randomAccess
    case completeFileRequired
}

struct MediaMetadata: Codable, Equatable, Sendable {
    var totalBytes: Int64?
    var contentType: String?
    var validator: String?
    var capability: MediaCapability
}

enum MediaDownloadState: Equatable, Sendable {
    case notDownloaded
    case downloading(received: Int64, total: Int64?)
    case paused(received: Int64, total: Int64?)
    case available(bytes: Int64)
    case failed(MediaFailure)
}

struct MediaByteRange: Codable, Equatable, Sendable {
    var lower: Int64
    var upper: Int64

    var count: Int64 { upper - lower }

    func contains(_ other: MediaByteRange) -> Bool {
        lower <= other.lower && upper >= other.upper
    }
}

struct MediaManifest: Codable, Sendable {
    var metadata: MediaMetadata?
    var ranges: [MediaByteRange] = []
    var durable = false
    var lastAccess = Date()

    var storedBytes: Int64 { ranges.reduce(0) { $0 + $1.count } }
    var isComplete: Bool {
        guard let total = metadata?.totalBytes, total > 0 else { return false }
        return ranges.count == 1 && ranges[0].lower == 0 && ranges[0].upper == total
    }

    mutating func insert(_ range: MediaByteRange) {
        let sorted = (ranges + [range]).sorted { $0.lower < $1.lower }
        ranges = []
        for range in sorted {
            if let last = ranges.last, range.lower <= last.upper {
                ranges[ranges.count - 1].upper = max(last.upper, range.upper)
            } else {
                ranges.append(range)
            }
        }
    }
}

struct MediaAssetLease: Sendable {
    let key: MediaKey
    let completeFileURL: URL?
    let byteSource: HTTPMediaByteSource
    private let lifetime: MediaLeaseLifetime

    init(key: MediaKey, completeFileURL: URL?, byteSource: HTTPMediaByteSource, onRelease: @escaping @Sendable () async -> Void) {
        self.key = key
        self.completeFileURL = completeFileURL
        self.byteSource = byteSource
        lifetime = MediaLeaseLifetime(source: byteSource, onRelease: onRelease)
    }

    func release() async { await lifetime.release() }
}

private final class MediaLeaseLifetime: Sendable {
    private let owner: MediaLeaseOwner

    init(source: HTTPMediaByteSource, onRelease: @escaping @Sendable () async -> Void) {
        owner = MediaLeaseOwner(source: source, onRelease: onRelease)
    }

    func release() async { await owner.release() }

    deinit {
        let owner = owner
        Task { await owner.release() }
    }
}

private actor MediaLeaseOwner {
    private let source: HTTPMediaByteSource
    private let onRelease: @Sendable () async -> Void
    private var released = false

    init(source: HTTPMediaByteSource, onRelease: @escaping @Sendable () async -> Void) {
        self.source = source
        self.onRelease = onRelease
    }

    func release() async {
        guard !released else { return }
        released = true
        await source.unpin()
        await onRelease()
    }
}
