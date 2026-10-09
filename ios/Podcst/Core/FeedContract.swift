import Foundation

public struct FeedFreshness: Codable, Hashable, Sendable {
    public enum Content: String, Codable, Sendable { case cached, missing }
    public enum State: String, Codable, Sendable { case fresh, stale, pending, backoff, unavailable }
    public let content: Content
    public let state: State
    public let checkedAtMs: Int64?
    public let retryAtMs: Int64?

    enum CodingKeys: String, CodingKey, CaseIterable { case content, state, checkedAtMs, retryAtMs }

    public init(from decoder: Decoder) throws {
        try feedKeys(decoder, CodingKeys.allCases.map(\.rawValue))
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        content = try fields.decode(Content.self, forKey: .content)
        state = try fields.decode(State.self, forKey: .state)
        checkedAtMs = try fields.decode(Int64?.self, forKey: .checkedAtMs)
        retryAtMs = try fields.decode(Int64?.self, forKey: .retryAtMs)
        guard [checkedAtMs, retryAtMs].compactMap({ $0 }).allSatisfy({ (0...9_007_199_254_740_991).contains($0) }),
              state != .fresh || (content == .cached && checkedAtMs != nil),
              (state == .pending || state == .backoff) == (retryAtMs != nil) else { throw FeedContractError.invalidResponse }
    }

    public func encode(to encoder: Encoder) throws {
        var fields = encoder.container(keyedBy: CodingKeys.self)
        try fields.encode(content, forKey: .content)
        try fields.encode(state, forKey: .state)
        try fields.encode(checkedAtMs, forKey: .checkedAtMs)
        try fields.encode(retryAtMs, forKey: .retryAtMs)
    }
}

struct FeedRefreshResponse: Decodable, Sendable {
    let podcastId: StateID
    let freshness: FeedFreshness
    enum CodingKeys: String, CodingKey, CaseIterable { case podcastId, freshness }

    init(from decoder: Decoder) throws {
        try feedKeys(decoder, CodingKeys.allCases.map(\.rawValue))
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        podcastId = try fields.decode(StateID.self, forKey: .podcastId)
        freshness = try fields.decode(FeedFreshness.self, forKey: .freshness)
    }
}

struct FeedResolutionItem: Decodable, Sendable {
    enum Status: String, Decodable, Sendable { case resolved, retry, unavailable }
    let index: Int
    let podcastId: StateID?
    let status: Status
    let retryAfterSeconds: Int?
    enum CodingKeys: String, CodingKey, CaseIterable { case index, podcastId, status, retryAfterSeconds }

    init(from decoder: Decoder) throws {
        try feedKeys(decoder, CodingKeys.allCases.map(\.rawValue))
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        index = try fields.decode(Int.self, forKey: .index)
        podcastId = try fields.decode(StateID?.self, forKey: .podcastId)
        status = try fields.decode(Status.self, forKey: .status)
        retryAfterSeconds = try fields.decode(Int?.self, forKey: .retryAfterSeconds)
        guard (0..<FeedLimits.current.imports.items).contains(index),
              (status == .resolved) == (podcastId != nil),
              (status == .retry) == (retryAfterSeconds != nil),
              retryAfterSeconds.map({ (1...86400).contains($0) }) ?? true else { throw FeedContractError.invalidResponse }
    }
}

struct FeedLimits: Decodable {
    struct Imports: Decodable { let items: Int; let retrySeconds: Int }
    struct Opml: Decodable { let pendingPerScope: Int; let bytes: Int; let feeds: Int; let outlines: Int; let depth: Int }
    let bodyBytes: Int
    let imports: Imports
    let opml: Opml
    static let current: FeedLimits = {
        guard let url = Bundle.main.url(forResource: "limits", withExtension: "json"),
              let data = try? Data(contentsOf: url), let value = try? JSONDecoder().decode(FeedLimits.self, from: data) else {
            preconditionFailure("Feed limits resource required")
        }
        return value
    }()
}

struct FeedImportRequest: Encodable {
    let `protocol` = 1
    let accountId: String
    let generation: String
    let feedUrls: [String]

    static func batches(_ feeds: [String], scope: StateScope) throws -> [[String]] {
        var batches: [[String]] = []
        var batch: [String] = []
        func fits(_ urls: [String]) throws -> Bool {
            try JSONEncoder().encode(FeedImportRequest(accountId: scope.accountId, generation: scope.generation, feedUrls: urls)).count <= FeedLimits.current.bodyBytes
        }
        for feed in feeds {
            guard !feed.isEmpty, feed.utf16.count <= 4096 else { throw FeedContractError.invalidResponse }
            let withinBytes = try fits(batch + [feed])
            if batch.count == FeedLimits.current.imports.items || !withinBytes {
                if !batch.isEmpty { batches.append(batch) }
                batch = []
            }
            batch.append(feed)
            guard try fits(batch) else { throw FeedContractError.invalidResponse }
        }
        if !batch.isEmpty { batches.append(batch) }
        return batches
    }
}

enum FeedContractError: Error { case invalidResponse }

private struct FeedKey: CodingKey {
    let stringValue: String
    var intValue: Int? { nil }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
}

private func feedKeys(_ decoder: Decoder, _ expected: [String]) throws {
    let keys = try decoder.container(keyedBy: FeedKey.self).allKeys.map(\.stringValue)
    guard Set(keys) == Set(expected) else { throw FeedContractError.invalidResponse }
}
