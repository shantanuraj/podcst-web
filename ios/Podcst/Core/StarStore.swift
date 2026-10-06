import Foundation
import Observation

@MainActor
protocol StarAPI {
    func sessionUser() async throws -> User?
    func lists() async throws -> [AccountEpisodeList]
    func listMembership(id: String) async throws -> ListSnapshot
    func listEpisodes(id: String, cursor: String?) async throws -> ListEpisodePage
    func changeList(id: String, batch: ListBatch) async throws -> ListAcknowledgement
}

extension APIClient: StarAPI {}

struct Star: Hashable, Identifiable {
    var membership: ListMembership
    var episode: Episode?
    var id: Int { membership.episodeId }
    var starredAt: Date { Date(timeIntervalSince1970: Double(membership.addedAt) / 1000) }
}

private struct StarIntent: Codable {
    var change: ListChange
    var at: Double
}

private struct StarFlight: Codable {
    var batch: ListBatch
    var intents: [StarIntent]
    var acknowledgement: ListAcknowledgement?
}

private struct StarScope: Codable {
    var clientId = UUID().uuidString.lowercased()
    var sequence: Int64 = 0
    var listId: String?
    var snapshot: ListSnapshot?
    var episodes: [Int: Episode] = [:]
    var queued: [StarIntent] = []
    var flight: StarFlight?
    var blocked: Int?
    var failures: Set<Int> = []

    var stars: [Star] {
        var members = (snapshot?.items ?? []).reduce(into: [Int: ListMembership]()) { $0[$1.episodeId] = $1 }
        let sent = flight?.intents.enumerated().compactMap { index, intent in
            flight?.acknowledgement?.results[index].status == .notFound ? nil : intent
        } ?? []
        for intent in sent + queued {
            let id = intent.change.episodeId
            if intent.change.op == .remove { members[id] = nil }
            else if members[id] == nil { members[id] = ListMembership(episodeId: id, addedAt: intent.at, availability: .contentMissing) }
        }
        return members.values.sorted { $0.addedAt == $1.addedAt ? $0.episodeId > $1.episodeId : $0.addedAt > $1.addedAt }.map {
            Star(membership: $0, episode: $0.availability == .unavailable ? nil : episodes[$0.episodeId])
        }
    }

    mutating func enqueue(_ id: Int, _ op: ListChange.Operation, at: Double, episode: Episode? = nil) {
        if let episode { episodes[id] = episode }
        failures.remove(id)
        queued.append(StarIntent(change: ListChange(op: op, episodeId: id), at: at))
    }

    mutating func freeze() throws {
        guard flight == nil, !queued.isEmpty, listId != nil, blocked == nil else { return }
        guard sequence < Int64.max else { throw StarFailure.protocolViolation }
        let intents = Array(queued.prefix(100))
        queued.removeFirst(intents.count)
        sequence += 1
        flight = StarFlight(batch: ListBatch(clientId: clientId, sequence: String(sequence), changes: intents.map(\.change)), intents: intents)
    }

    mutating func acknowledge(_ value: ListAcknowledgement) throws {
        guard let sent = flight, value.clientId == sent.batch.clientId, value.sequence == sent.batch.sequence,
              value.listId == listId, let revision = Int64(value.revision), revision >= 0,
              value.results.count == sent.intents.count,
              zip(value.results, sent.intents).allSatisfy({ $0.episodeId == $1.change.episodeId }) else { throw StarFailure.protocolViolation }
        flight?.acknowledgement = value
        for result in value.results {
            failures.remove(result.episodeId)
            if result.status == .notFound {
                failures.insert(result.episodeId)
                episodes[result.episodeId] = nil
                if let index = snapshot?.items.firstIndex(where: { $0.episodeId == result.episodeId }) { snapshot?.items[index].availability = .unavailable }
            }
        }
    }

    mutating func install(_ value: ListSnapshot) throws {
        guard value.listId == listId, let revision = Int64(value.revision), revision >= 0,
              revision >= (Int64(snapshot?.revision ?? "0") ?? 0),
              revision >= (Int64(flight?.acknowledgement?.revision ?? "0") ?? 0),
              Set(value.items.map(\.episodeId)).count == value.items.count,
              value.items.allSatisfy({ StarStore.validID($0.episodeId) && $0.addedAt.isFinite && $0.addedAt.rounded() == $0.addedAt }) else { throw StarFailure.protocolViolation }
        snapshot = value
        if flight?.acknowledgement != nil { flight = nil }
        let visible = Set(stars.map(\.id))
        let unavailable = Set(value.items.filter { $0.availability == .unavailable }.map(\.episodeId))
        episodes = episodes.filter { visible.contains($0.key) && !unavailable.contains($0.key) }
    }

    mutating func hydrate(_ page: ListEpisodePage) {
        guard page.listId == listId, page.revision == snapshot?.revision else { return }
        for item in page.items {
            let id = item.membership.episodeId
            guard let index = snapshot?.items.firstIndex(where: { $0.episodeId == id }) else { continue }
            if item.membership.availability == .unavailable {
                snapshot?.items[index].availability = .unavailable
                episodes[id] = nil
            } else if snapshot?.items[index].availability != .unavailable, item.episode?.id == id { episodes[id] = item.episode }
        }
    }
}

private enum StarFailure: Error { case protocolViolation, sessionChanged, storageUnavailable }

@MainActor
@Observable
final class StarStore {
    private(set) var stars: [Star] = []
    private(set) var accountID: String?
    private(set) var pending = false
    private(set) var error: String?
    private(set) var ready = true
    @ObservationIgnored private var root: [String: StarScope] = [:]
    @ObservationIgnored private let url: URL
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let api: (any StarAPI)?
    @ObservationIgnored private let save: (Data, URL) throws -> Void
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var syncing: Task<Void, Never>?
    @ObservationIgnored private var readable = true
    @ObservationIgnored private var authenticationPaused = false
    @ObservationIgnored private var attempts = 0
    @ObservationIgnored private var nextAttempt = Date.distantPast
    @ObservationIgnored private var lastSync = Date.distantPast

    init(accountID: String? = nil, directory: URL? = nil, api: (any StarAPI)? = nil, save: ((Data, URL) throws -> Void)? = nil, now: @escaping () -> Date = Date.init) {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Podcst", isDirectory: true)
        let directory = directory ?? base.appendingPathComponent("EpisodeLists", isDirectory: true)
        if directory == base.appendingPathComponent("EpisodeLists", isDirectory: true) { try? FileManager.default.removeItem(at: base.appendingPathComponent("Stars")) }
        url = directory.appendingPathComponent("lists.json")
        self.accountID = accountID
        self.now = now
        self.api = api
        self.save = save ?? { data, url in
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            var file = url.deletingLastPathComponent()
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try file.setResourceValues(values)
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
        if FileManager.default.fileExists(atPath: url.path) {
            do { root = try JSONDecoder().decode([String: StarScope].self, from: Data(contentsOf: url)) }
            catch { readable = false; ready = false; self.error = "Saved episodes could not be opened. Pending work has not been reset." }
        }
        publish()
    }

    nonisolated static func validID(_ id: Int?) -> Bool { id.map { $0 > 0 && $0 <= 9_007_199_254_740_991 } ?? false }
    var episodes: [Episode] { stars.compactMap(\.episode) }
    private var key: String { MediaKey.scope(accountID) }
    private var state: StarScope { root[key] ?? StarScope() }
    func contains(_ episode: Episode) -> Bool { Self.validID(episode.id) && stars.contains { $0.id == episode.id } }

    @discardableResult func star(_ episode: Episode) -> Bool { edit(episode.id, .add, episode: episode) }
    @discardableResult func unstar(_ episode: Episode) -> Bool { edit(episode.id, .remove) }
    @discardableResult func remove(id: Int) -> Bool { edit(id, .remove) }
    @discardableResult func toggle(_ episode: Episode) -> Bool { contains(episode) ? unstar(episode) : star(episode) }

    private func edit(_ id: Int?, _ op: ListChange.Operation, episode: Episode? = nil) -> Bool {
        guard ready, let id, Self.validID(id) else { error = "A canonical episode ID and an active account scope are required."; return false }
        do {
            error = nil
            try update { state in
                state.enqueue(id, op, at: (now().timeIntervalSince1970 * 1000).rounded(), episode: episode)
                if accountID == nil {
                    let stars = state.stars
                    state.queued = stars.map { StarIntent(change: ListChange(op: .add, episodeId: $0.id), at: $0.membership.addedAt) }
                    state.episodes = stars.reduce(into: [:]) { $0[$1.id] = $1.episode }
                }
            }
            Task { await refresh() }
            return true
        } catch { self.error = "Unable to save this change on your device."; return false }
    }

    func suspend() {
        authenticationPaused = true
        generation = UUID()
        syncing?.cancel()
        syncing = nil
        ready = false
        stars = []
    }

    func resume(accountID: String?) {
        guard self.accountID == accountID else { return }
        authenticationPaused = false
        Task { await refresh() }
    }

    func switchAccount(to id: String?, activate: Bool = true) throws {
        suspend()
        var next = root
        if accountID != nil { next[key]?.episodes = [:]; next[key]?.snapshot = nil }
        if let id { Self.mergeGuest(&next, account: id) }
        try commit(next)
        accountID = id
        ready = readable && activate
        authenticationPaused = !activate
        nextAttempt = .distantPast
        publish()
    }

    private static func mergeGuest(_ root: inout [String: StarScope], account: String) {
        let guestKey = MediaKey.scope(nil)
        guard let guest = root[guestKey] else { return }
        let key = MediaKey.scope(account)
        var target = root[key] ?? StarScope()
        for star in guest.stars.reversed() { target.enqueue(star.id, .add, at: star.membership.addedAt, episode: star.episode) }
        root[key] = target
        root[guestKey] = nil
    }

    private func commit(_ next: [String: StarScope]) throws {
        guard readable else { throw StarFailure.storageUnavailable }
        try save(JSONEncoder().encode(next), url)
        root = next
    }

    private func update(_ change: (inout StarScope) throws -> Void) throws {
        var next = root
        var current = next[key] ?? StarScope()
        try change(&current)
        next[key] = current
        try commit(next)
        publish()
    }

    private func publish() {
        stars = ready ? state.stars : []
        pending = accountID != nil && (state.flight != nil || !state.queued.isEmpty)
        if state.blocked != nil { error = "Star sync needs attention. Pending edits have been kept." }
        else if !state.failures.isEmpty { error = "\(state.failures.count) episode(s) could not be added." }
    }

    func poll() async { if pending || now().timeIntervalSince(lastSync) >= 60 { await refresh() } }

    func refresh() async {
        guard let api, readable, !authenticationPaused, now() >= nextAttempt else { return }
        guard let accountID else { ready = true; publish(); return }
        if let syncing { await syncing.value; return }
        let token = generation
        let task = Task { [self] in
            defer { if token == generation { syncing = nil } }
            do {
                let user = try await api.sessionUser()
                try check(token)
                guard user?.id == accountID else {
                    ready = false
                    stars = []
                    try update { $0.episodes = [:]; $0.snapshot = nil }
                    throw StarFailure.sessionChanged
                }
                ready = true
                var next = root
                Self.mergeGuest(&next, account: accountID)
                try commit(next)
                error = nil
                publish()
                guard state.blocked == nil else { return }
                if state.listId == nil {
                    let lists = try await api.lists()
                    try check(token)
                    guard let list = lists.first(where: { $0.kind == "starred" }) else { throw StarFailure.protocolViolation }
                    try update { $0.listId = list.id }
                }
                guard let id = state.listId else { throw StarFailure.protocolViolation }
                repeat {
                    try check(token)
                    try update { try $0.freeze() }
                    if let flight = state.flight, flight.acknowledgement == nil {
                        do {
                            let ack = try await api.changeList(id: id, batch: flight.batch)
                            try check(token)
                            try update { try $0.acknowledge(ack) }
                        } catch {
                            try check(token)
                            if let failure = error as? APIError, [400, 404, 409, 413].contains(failure.statusCode) { try update { $0.blocked = failure.statusCode } }
                            throw error
                        }
                    }
                    let snapshot = try await api.listMembership(id: id)
                    try check(token)
                    try update { try $0.install(snapshot) }
                } while !state.queued.isEmpty
                var cursor: String?
                var cursors = Set<String>()
                repeat {
                    let page = try await api.listEpisodes(id: id, cursor: cursor)
                    try check(token)
                    try update { $0.hydrate(page) }
                    cursor = page.nextCursor
                    if let cursor, !cursors.insert(cursor).inserted { throw StarFailure.protocolViolation }
                } while cursor != nil
                attempts = 0
                nextAttempt = .distantPast
                lastSync = now()
            } catch {
                guard token == generation, !Task.isCancelled else { return }
                if let failure = error as? APIError, [401, 403].contains(failure.statusCode) {
                    ready = false
                    stars = []
                    try? update { $0.episodes = [:]; $0.snapshot = nil }
                }
                attempts += 1
                nextAttempt = now().addingTimeInterval(min(60, pow(2, Double(min(attempts, 6)))))
                self.error = "Star sync paused. Changes remain saved on this device."
                publish()
            }
        }
        syncing = task
        await task.value
    }

    private func check(_ token: UUID) throws {
        try Task.checkCancellation()
        guard generation == token else { throw StarFailure.sessionChanged }
    }
}
