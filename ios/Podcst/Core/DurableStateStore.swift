import Foundation
import Observation

@MainActor protocol DurableStateAPI {
    func sessionUser() async throws -> User?
    func progressState(ids: [Int]?) async throws -> StateSnapshot<StateProgressItem>
    func followState() async throws -> StateSnapshot<StateFollowItem>
    func changeProgress(_ batch: StateBatch<StateProgressChange>) async throws -> StateAcknowledgement<StateProgressResult>
    func changeFollows(_ batch: StateBatch<StateFollowChange>) async throws -> StateAcknowledgement<StateFollowResult>
}
extension APIClient: DurableStateAPI {}

private struct StateStream<Change: Codable & Equatable & Sendable, Result: Codable & Equatable & Sendable>: Codable {
    var clientID = UUID().uuidString.lowercased()
    var sequence: Int64 = 0
    var queued: [Change] = []
    var flight: StateBatch<Change>?
    var acknowledgement: StateAcknowledgement<Result>?
    var revision: Int64 = 0
    var blocked: String?
    var pending: Bool { flight != nil || !queued.isEmpty }

    mutating func freeze(_ scope: StateScope) throws {
        guard flight == nil, !queued.isEmpty, blocked == nil else { return }
        guard sequence < Int64.max else { throw DurableStateFailure.protocolViolation }
        sequence += 1
        let changes = Array(queued.prefix(100))
        queued.removeFirst(changes.count)
        flight = StateBatch(protocol: 1, accountId: scope.accountId, generation: scope.generation,
                            clientId: clientID, sequence: try StateID(String(sequence)), changes: changes)
    }

    mutating func acknowledge(_ ack: StateAcknowledgement<Result>, ids: (Change) -> StateID, resultIDs: (Result) -> StateID) throws {
        guard let flight, ack.protocol == 1, ack.accountId == flight.accountId, ack.generation == flight.generation,
              ack.clientId == flight.clientId, ack.sequence == flight.sequence,
              ack.results.map(resultIDs) == flight.changes.map(ids) else { throw DurableStateFailure.protocolViolation }
        acknowledgement = ack
    }

    mutating func install(revision: Int64, retire: Bool) throws {
        guard revision >= self.revision, revision >= (acknowledgement?.revision.number ?? 0) else { throw DurableStateFailure.protocolViolation }
        self.revision = revision
        if retire, acknowledgement != nil { flight = nil; acknowledgement = nil }
    }
}

private struct DurableAccount: Codable {
    var scope: StateScope?
    var progress = StateStream<StateProgressChange, StateProgressResult>()
    var follows = StateStream<StateFollowChange, StateFollowResult>()
    var positions: [Int: StateProgressChange] = [:]
    var memberships: [StateFollowItem] = []
    var legacyProgressSource: Data?
    var legacyProgress: [PlaybackProgressWriter.Update] = []
    var legacyProgressImported = false
    var failures: [String] = []
    var importFeeds: [String] = []
}
private struct DurableRoot: Codable {
    var version = 1
    var accounts: [String: DurableAccount] = [:]
    var guestFollows: [Podcast] = []
    var guestProgress: [Int: StateProgressChange] = [:]
    var legacyGuestSource: Data?
    var guestImported = false
    var unresolvedGuest: [Podcast] = []
}

@MainActor @Observable final class DurableStateStore {
    private var root = DurableRoot()
    private(set) var accountID: String?
    private(set) var verified = false
    private var isSuspended = false
    private(set) var error: String?
    private(set) var readable = true
    @ObservationIgnored private let url: URL
    @ObservationIgnored private let api: any DurableStateAPI
    @ObservationIgnored private let save: (Data, URL) throws -> Void
    @ObservationIgnored private var epoch = UUID()
    @ObservationIgnored private var worker: Task<Void, Never>?
    @ObservationIgnored private var retryAfter = Date.distantPast
    @ObservationIgnored private var authenticationPaused = false

    init(directory: URL, api: any DurableStateAPI, accountID: String? = nil, save: ((Data, URL) throws -> Void)? = nil) {
        url = directory.appendingPathComponent("durable-state-v1.json")
        self.api = api
        self.accountID = accountID
        self.save = save ?? Self.protectedWrite
        do {
            if let data = try readPreservedState(url) {
                root = try JSONDecoder().decode(DurableRoot.self, from: data)
                guard root.version == 1 else { throw DurableStateFailure.storageUnavailable }
            }
        } catch {
            readable = false
            self.error = "Saved state could not be opened. Original data has not been reset."
        }
    }

    static func protectedWrite(_ data: Data, _ url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        var directory = url.deletingLastPathComponent()
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private var account: DurableAccount { accountID.flatMap { root.accounts[$0] } ?? DurableAccount() }
    var scope: StateScope? { verified ? account.scope : nil }
    var progressPending: Bool { accountID != nil && account.progress.pending }
    var progressBlocked: Bool { !readable || account.progress.blocked != nil }
    var pending: Bool { accountID != nil && (account.progress.pending || account.follows.pending) && !isSuspended }
    var blocked: Bool { !readable || (verified && (account.progress.blocked != nil || account.follows.blocked != nil)) }
    var guestFollows: [Podcast] { root.guestFollows }
    var guestPositions: [StateProgressChange] { verified ? root.guestProgress.values.sorted { $0.episodeId.number < $1.episodeId.number } : [] }
    func reapplyGuest(_ change: StateProgressChange) throws {
        guard verified else { throw DurableStateFailure.suspended }
        try update { state in
            state.progress.queued.removeAll { $0.episodeId == change.episodeId }
            state.progress.queued.append(change)
        }
    }
    var legacyProgress: [PlaybackProgressWriter.Update] { verified ? account.legacyProgress : [] }
    var unresolvedCount: Int { root.unresolvedGuest.count + legacyProgress.filter { $0.episodeID > 9_007_199_254_740_991 || $0.episodeID <= 0 }.count }
    var failures: [String] { verified ? account.failures : [] }
    var pendingImportFeeds: [String] { verified ? account.importFeeds : [] }
    var unresolvedGuest: [Podcast] { root.unresolvedGuest }
    func stageImport(_ feeds: [String]) throws {
        try update { state in
            for feed in feeds where !state.importFeeds.contains(feed) { state.importFeeds.append(feed) }
        }
    }
    func resolvedImport(feed: String, id: StateID) throws {
        try update { state in
            state.follows.queued.removeAll { $0.podcastId == id }
            state.follows.queued.append(StateFollowChange(podcastId: id, followed: true))
            state.importFeeds.removeAll { $0 == feed }
        }
    }

    func position(_ id: Int) -> StateProgressChange? {
        if accountID == nil { return root.guestProgress[id] }
        guard verified else { return nil }
        let state = account
        return (state.progress.queued.last { $0.episodeId.number == id })
            ?? (state.progress.flight?.changes.last { $0.episodeId.number == id }) ?? state.positions[id]
    }
    var followedIDs: Set<Int> {
        guard verified else { return Set(root.guestFollows.compactMap(\.id)) }
        var ids = Set(account.memberships.map { $0.podcastId.number })
        for change in (account.follows.flight?.changes ?? []) + account.follows.queued {
            if change.followed { ids.insert(change.podcastId.number) } else { ids.remove(change.podcastId.number) }
        }
        return ids
    }
    var unavailableIDs: Set<Int> { Set(account.memberships.filter { $0.availability == .unavailable }.map { $0.podcastId.number }) }

    private func commit(_ change: (inout DurableRoot) throws -> Void) throws {
        guard readable else { throw DurableStateFailure.storageUnavailable }
        var next = root
        try change(&next)
        do { try save(JSONEncoder().encode(next), url) }
        catch { self.error = DurableStateFailure.storageUnavailable.localizedDescription; throw error }
        root = next
    }
    private func update(_ change: (inout DurableAccount) throws -> Void) throws {
        guard let accountID else { throw DurableStateFailure.suspended }
        try commit { root in
            var account = root.accounts[accountID] ?? DurableAccount()
            try change(&account)
            root.accounts[accountID] = account
        }
    }

    func importGuestSource(_ data: Data?) throws {
        guard !root.guestImported else { return }
        let podcasts = try data.map { try JSONDecoder().decode([Podcast].self, from: $0) } ?? []
        try commit { root in
            root.legacyGuestSource = data
            root.guestImported = true
            for podcast in podcasts where podcast.isPrivate != true {
                if let id = podcast.id, id > 0 { root.guestFollows.append(podcast) }
                else { root.unresolvedGuest.append(podcast) }
            }
        }
    }

    func importLegacyProgress(_ source: URL) throws {
        guard verified, !account.legacyProgressImported else { return }
        let data = try readPreservedState(source)
        let updates = try data.map { try JSONDecoder().decode([PlaybackProgressWriter.Update].self, from: $0) } ?? []
        try update { state in
            state.legacyProgressSource = data
            state.legacyProgress = updates
            state.legacyProgressImported = true
        }
    }

    func reapplyLegacy(_ update: PlaybackProgressWriter.Update) throws {
        guard update.episodeID > 0, update.episodeID <= 9_007_199_254_740_991,
              update.position.isFinite, update.position >= 0, update.position <= Double(Int32.max) else { throw DurableStateFailure.unresolved }
        let change = StateProgressChange(episodeId: try StateID(String(update.episodeID)), positionSeconds: Int(update.position), completed: update.completed)
        try self.update { state in
            guard state.legacyProgress.contains(update) else { return }
            state.progress.queued.removeAll { $0.episodeId == change.episodeId }
            state.progress.queued.append(change)
            state.legacyProgress.removeAll { $0 == update }
        }
    }

    func setProgress(id: Int, position: Double, event: StateProgressEvent) throws {
        guard position.isFinite, position >= 0, position <= Double(Int32.max) else { throw StateContractError.invalidPosition }
        let value = try event.intent(positionSeconds: Int(position), previousCompleted: self.position(id)?.completed ?? false)
        let change = StateProgressChange(episodeId: try StateID(String(id)), positionSeconds: value.positionSeconds, completed: value.completed)
        if accountID == nil {
            try commit { $0.guestProgress[id] = change }
        } else {
            try update { state in
                state.progress.queued.removeAll { $0.episodeId == change.episodeId }
                state.progress.queued.append(change)
            }
        }
    }
    func cacheGuest(_ podcast: Podcast, replacing original: Podcast) throws {
        try commit { root in
            if let index = root.guestFollows.firstIndex(where: { $0.identity == original.identity }) {
                root.guestFollows[index] = podcast
            } else if let index = root.unresolvedGuest.firstIndex(where: { $0.identity == original.identity }) {
                if podcast.id != nil { root.unresolvedGuest.remove(at: index); root.guestFollows.append(podcast) }
                else { root.unresolvedGuest[index] = podcast }
            }
        }
    }
    func setFollow(_ podcast: Podcast, followed: Bool) throws {
        guard let id = podcast.id else {
            guard accountID == nil else { throw DurableStateFailure.unresolved }
            try commit { root in
                root.unresolvedGuest.removeAll { $0.identity == podcast.identity }
                if followed { root.unresolvedGuest.append(podcast) }
            }
            return
        }
        let change = StateFollowChange(podcastId: try StateID(String(id)), followed: followed)
        if accountID == nil {
            try commit { root in
                root.guestFollows.removeAll { $0.id == id }
                if followed { root.guestFollows.append(podcast) }
            }
        } else { try enqueueFollows([change]) }
    }
    func enqueueFollows(_ changes: [StateFollowChange]) throws {
        try update { state in
            for change in changes {
                state.follows.queued.removeAll { $0.podcastId == change.podcastId }
                state.follows.queued.append(change)
            }
        }
    }

    func suspend() {
        isSuspended = true
        epoch = UUID()
        worker?.cancel()
        worker = nil
        verified = false
        if readable { error = nil }
    }
    func checkpointAndSuspend() throws {
        if accountID != nil {
            try update { $0.positions = [:]; $0.memberships = [] }
        } else { try commit { _ in } }
        suspend()
    }
    func terminalErase(accountID: String) throws {
        if self.accountID == accountID { suspend() }
        try commit { $0.accounts[accountID] = nil }
    }
    func selectAccount(_ id: String?) {
        suspend()
        accountID = id
        if id == nil { isSuspended = false }
    }
    func activate(accountID: String?, verifiedAccountID: String? = nil) async throws {
        if self.accountID != accountID { selectAccount(accountID) }
        guard let accountID else { verified = false; return }
        if verified && !authenticationPaused { return }
        let token = epoch
        if authenticationPaused || verifiedAccountID != accountID {
            guard try await api.sessionUser()?.id == accountID else { throw DurableStateFailure.suspended }
        }
        try check(token)
        verified = true
        isSuspended = false
        authenticationPaused = false
        try commit { root in
            var state = root.accounts[accountID] ?? DurableAccount()
            for podcast in root.guestFollows {
                guard let id = podcast.id else { continue }
                state.follows.queued.removeAll { $0.podcastId.number == id }
                state.follows.queued.append(StateFollowChange(podcastId: try StateID(String(id)), followed: true))
            }
            root.accounts[accountID] = state
            root.guestFollows = []
        }
    }
    private func check(_ token: UUID) throws {
        try Task.checkCancellation()
        guard epoch == token else { throw DurableStateFailure.suspended }
    }
    private func validate<Item>(_ snapshot: StateSnapshot<Item>) throws {
        guard let accountID else { throw DurableStateFailure.suspended }
        let scope = StateScope(protocol: snapshot.protocol, accountId: snapshot.accountId, generation: snapshot.generation)
        try scope.validate(account: accountID)
        if let existing = account.scope, existing != scope { throw DurableStateFailure.protocolViolation }
    }
    private func installScope<Item>(_ snapshot: StateSnapshot<Item>) throws {
        try validate(snapshot)
        try update { $0.scope = StateScope(protocol: snapshot.protocol, accountId: snapshot.accountId, generation: snapshot.generation) }
    }

    func refreshProgress(ids: [Int]) async throws {
        guard verified else { return }
        let token = epoch
        let ids = Array(Set(ids)).sorted()
        for offset in stride(from: 0, to: ids.count, by: 200) {
            let requested = Array(ids[offset..<min(offset + 200, ids.count)])
            do {
                let snapshot = try await api.progressState(ids: requested)
                try check(token)
                try installProgress(snapshot, requested: requested, retire: false)
            } catch {
                try check(token)
                pauseIfUnauthenticated(error)
                throw error
            }
        }
    }
    private func installProgress(_ snapshot: StateSnapshot<StateProgressItem>, requested: [Int], retire: Bool) throws {
        try validate(snapshot)
        guard Set(snapshot.items.map { $0.episodeId.number }) == Set(requested), snapshot.items.count == requested.count,
              snapshot.items.allSatisfy({ item in
                  item.progress.map { (0...Int(Int32.max)).contains($0.positionSeconds) && Int64($0.revision.value)! <= snapshot.revision.number } ?? true
              }) else { throw DurableStateFailure.protocolViolation }
        try update { state in
            state.scope = StateScope(protocol: snapshot.protocol, accountId: snapshot.accountId, generation: snapshot.generation)
            try state.progress.install(revision: snapshot.revision.number, retire: retire)
            for item in snapshot.items {
                state.positions[item.episodeId.number] = item.progress.map { StateProgressChange(episodeId: item.episodeId, positionSeconds: $0.positionSeconds, completed: $0.completed) }
            }
        }
    }
    private func installFollows(_ snapshot: StateSnapshot<StateFollowItem>) throws {
        try validate(snapshot)
        guard Set(snapshot.items.map(\.podcastId)).count == snapshot.items.count,
              snapshot.items.allSatisfy({ Int64($0.revision.value)! <= snapshot.revision.number }) else { throw DurableStateFailure.protocolViolation }
        try update { state in
            state.scope = StateScope(protocol: snapshot.protocol, accountId: snapshot.accountId, generation: snapshot.generation)
            try state.follows.install(revision: snapshot.revision.number, retire: true)
            state.memberships = snapshot.items
        }
    }

    func flush(includeFollows: Bool = true) async {
        guard verified, readable, !authenticationPaused, Date() >= retryAfter else { return }
        if let worker {
            await worker.value
            if error == nil, !blocked, account.progress.pending || (includeFollows && account.follows.pending) { await flush(includeFollows: includeFollows) }
            return
        }
        let token = epoch
        let task = Task { [self] in
            defer { if epoch == token { worker = nil } }
            do {
                try check(token)
                if account.scope == nil {
                    let initial = try await api.progressState(ids: nil)
                    try check(token)
                    try installScope(initial)
                }
                guard let scope = account.scope else { throw DurableStateFailure.protocolViolation }
                if account.progress.blocked == nil {
                    do { try await syncProgress(scope, token: token) }
                    catch { try check(token); try record(error, progress: true) }
                }
                if includeFollows, account.follows.blocked == nil, !authenticationPaused {
                    do { try await syncFollows(scope, token: token) }
                    catch { try check(token); try record(error, progress: false) }
                }
                if !account.progress.pending && (!includeFollows || !account.follows.pending) && !blocked { error = nil }
            } catch {
                guard epoch == token, !Task.isCancelled else { return }
                pauseIfUnauthenticated(error)
                self.error = error.localizedDescription
            }
        }
        worker = task
        await task.value
    }
    private func syncProgress(_ scope: StateScope, token: UUID) async throws {
        repeat {
            try update { try $0.progress.freeze(scope) }
            guard let flight = account.progress.flight else { return }
            if account.progress.acknowledgement == nil {
                let ack = try await api.changeProgress(flight)
                try check(token)
                try update { state in
                    try state.progress.acknowledge(ack, ids: { $0.episodeId }, resultIDs: { $0.episodeId })
                    state.failures += ack.results.filter { $0.status == .notFound }.map { "Episode \($0.episodeId.value) is unavailable." }
                }
            }
            let ids = Array(Set(flight.changes.map { $0.episodeId.number })).sorted()
            let snapshot = try await api.progressState(ids: ids)
            try check(token)
            try installProgress(snapshot, requested: ids, retire: true)
        } while account.progress.pending
    }
    private func syncFollows(_ scope: StateScope, token: UUID) async throws {
        repeat {
            try update { try $0.follows.freeze(scope) }
            if let flight = account.follows.flight, account.follows.acknowledgement == nil {
                let ack = try await api.changeFollows(flight)
                try check(token)
                try update { state in
                    try state.follows.acknowledge(ack, ids: { $0.podcastId }, resultIDs: { $0.podcastId })
                    state.failures += ack.results.filter { $0.status == .notFound }.map { "Podcast \($0.podcastId.value) is unavailable." }
                }
            }
            let snapshot = try await api.followState()
            try check(token)
            try installFollows(snapshot)
        } while account.follows.pending
    }
    private func pauseIfUnauthenticated(_ failure: Error) {
        if (failure as? APIError)?.statusCode == 401 { authenticationPaused = true; verified = false }
    }
    private func record(_ failure: Error, progress: Bool) throws {
        error = failure.localizedDescription
        if let apiError = failure as? APIError {
            if apiError.statusCode == 401 { pauseIfUnauthenticated(failure); return }
            retryAfter = Date().addingTimeInterval(max(2, apiError.retryAfter ?? 2))
            if [400, 403, 404, 409, 413, 426].contains(apiError.statusCode) {
                try update { if progress { $0.progress.blocked = apiError.code ?? "protocol_error" } else { $0.follows.blocked = apiError.code ?? "protocol_error" } }
            }
        } else if case DurableStateFailure.protocolViolation = failure {
            try update { if progress { $0.progress.blocked = "protocol_error" } else { $0.follows.blocked = "protocol_error" } }
        } else { retryAfter = Date().addingTimeInterval(2) }
    }
}
