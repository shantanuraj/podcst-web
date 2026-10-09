import Foundation

private func stateDecimal(_ value: String, allowsZero: Bool) -> Bool {
    guard !value.isEmpty, value.utf8.count <= 19,
          value.utf8.allSatisfy({ (48...57).contains($0) }),
          let number = Int64(value), number >= (allowsZero ? 0 : 1) else { return false }
    return String(number) == value
}

struct StateID: Codable, Hashable, Sendable {
    let value: String

    init(_ value: String) throws {
        guard stateDecimal(value, allowsZero: false) else { throw StateContractError.invalidDecimal }
        self.value = value
    }

    init(from decoder: Decoder) throws {
        try self.init(decoder.singleValueContainer().decode(String.self))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(value)
    }
}

struct StateRevision: Codable, Hashable, Sendable {
    let value: String

    init(_ value: String) throws {
        guard stateDecimal(value, allowsZero: true) else { throw StateContractError.invalidDecimal }
        self.value = value
    }

    init(from decoder: Decoder) throws {
        try self.init(decoder.singleValueContainer().decode(String.self))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(value)
    }
}

enum StateContractError: Error {
    case invalidDecimal, invalidPosition, invalidTimestamp
}

struct StateProgressChange: Codable, Equatable, Sendable {
    var episodeId: StateID
    var positionSeconds: Int
    var completed: Bool?

    enum CodingKeys: String, CodingKey { case episodeId, positionSeconds, completed }

    init(episodeId: StateID, positionSeconds: Int, completed: Bool?) {
        self.episodeId = episodeId
        self.positionSeconds = positionSeconds
        self.completed = completed
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        episodeId = try container.decode(StateID.self, forKey: .episodeId)
        positionSeconds = try container.decode(Int.self, forKey: .positionSeconds)
        completed = try container.decode(Bool?.self, forKey: .completed)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(episodeId, forKey: .episodeId)
        try container.encode(positionSeconds, forKey: .positionSeconds)
        try container.encode(completed, forKey: .completed)
    }
}

struct LocalProgress: Codable, Equatable, Sendable {
    var episodeId: StateID
    var positionSeconds: Int
    var completed: Bool
}

struct StateFollowChange: Codable, Equatable, Sendable {
    var podcastId: StateID
    var followed: Bool
}

struct StateBatch<Change: Codable & Equatable & Sendable>: Codable, Equatable, Sendable {
    var `protocol`: Int
    var accountId: String
    var generation: String
    var clientId: String
    var sequence: StateID
    var changes: [Change]
}

enum StateResult: String, Codable, Sendable {
    case applied, unchanged
    case notFound = "not_found"
}

struct StateProgressResult: Codable, Equatable, Sendable {
    var episodeId: StateID
    var status: StateResult
}

struct StateFollowResult: Codable, Equatable, Sendable {
    var podcastId: StateID
    var status: StateResult
}

struct StateAcknowledgement<Result: Codable & Equatable & Sendable>: Codable, Equatable, Sendable {
    var `protocol`: Int
    var accountId: String
    var generation: String
    var clientId: String
    var sequence: StateID
    var revision: StateRevision
    var results: [Result]
}

struct StateTimestamp: Codable, Equatable, Sendable {
    var milliseconds: Int64?

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        milliseconds = try container.decode(Int64?.self)
        if let milliseconds, !(0...8_640_000_000_000_000).contains(milliseconds) {
            throw StateContractError.invalidTimestamp
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(milliseconds)
    }
}

struct StateProgress: Codable, Equatable, Sendable {
    var positionSeconds: Int
    var completed: Bool
    var revision: StateID
    var updatedAtMs: StateTimestamp
}

struct StateProgressItem: Codable, Equatable, Sendable {
    var episodeId: StateID
    var progress: StateProgress?

    enum CodingKeys: String, CodingKey { case episodeId, progress }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        episodeId = try container.decode(StateID.self, forKey: .episodeId)
        progress = try container.decode(StateProgress?.self, forKey: .progress)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(episodeId, forKey: .episodeId)
        try container.encode(progress, forKey: .progress)
    }
}

struct StateFollowItem: Codable, Equatable, Sendable {
    enum Availability: String, Codable, Sendable { case available, unavailable }
    var podcastId: StateID
    var revision: StateID
    var followedAtMs: StateTimestamp
    var availability: Availability
}

struct StateSnapshot<Item: Codable & Equatable & Sendable>: Codable, Equatable, Sendable {
    var `protocol`: Int
    var accountId: String
    var generation: String
    var revision: StateRevision
    var items: [Item]
}

struct StateErrorBody: Codable, Equatable, Sendable {
    var code: String
    var message: String
}

public enum StateProgressEvent: String, Codable, Sendable {
    case checkpoint, ended, played, unplayed, replay

    func intent(positionSeconds: Int, previousCompleted: Bool) throws -> (positionSeconds: Int, completed: Bool) {
        guard (0...Int(Int32.max)).contains(positionSeconds) else { throw StateContractError.invalidPosition }
        return (self == .unplayed ? 0 : positionSeconds,
                self == .ended || self == .played || (self == .checkpoint && previousCompleted))
    }
}

@propertyWrapper struct CatalogueID: Decodable {
    var wrappedValue: Int
    init(from decoder: Decoder) throws { wrappedValue = Int(try StateID(from: decoder).value)! }
}
@propertyWrapper struct OptionalCatalogueID: Decodable {
    var wrappedValue: Int?
    init(wrappedValue: Int? = nil) { self.wrappedValue = wrappedValue }
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        wrappedValue = c.decodeNil() ? nil : Int(try c.decode(StateID.self).value)
    }
}
extension KeyedDecodingContainer {
    func decode(_ type: OptionalCatalogueID.Type, forKey key: Key) throws -> OptionalCatalogueID {
        try decodeIfPresent(type, forKey: key) ?? OptionalCatalogueID()
    }
}

struct StateScope: Codable, Equatable, Sendable {
    var `protocol` = 1
    var accountId: String
    var generation: String
    func validate(account: String) throws {
        guard `protocol` == 1, accountId == account, !account.isEmpty, account.utf8.count <= 128,
              UUID(uuidString: generation)?.uuidString.lowercased() == generation else { throw DurableStateFailure.protocolViolation }
    }
}

enum DurableStateFailure: Error, LocalizedError {
    case protocolViolation, storageUnavailable, suspended, unresolved
    var errorDescription: String? {
        switch self {
        case .protocolViolation: "Sync blocked: server state needs reconciliation. Saved work has been preserved."
        case .storageUnavailable: "Device storage is unavailable. This change was not saved."
        case .suspended: "Sync paused until this account signs in again."
        case .unresolved: "Legacy identity is unresolved. Original data has been preserved."
        }
    }
}

extension StateRevision {
    var number: Int64 { Int64(value)! }
}
extension StateID {
    var number: Int { Int(value)! }
}

struct FollowResolution: Decodable {
    var `protocol`: Int
    var accountId: String
    var generation: String
    var items: [FeedResolutionItem]
}

func readPreservedState(_ url: URL) throws -> Data? {
    do { return try Data(contentsOf: url) }
    catch let error as NSError where error.domain == NSCocoaErrorDomain && [NSFileReadNoSuchFileError, NSFileNoSuchFileError].contains(error.code) { return nil }
}
