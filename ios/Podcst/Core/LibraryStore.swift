import Foundation
import CryptoKit
import Observation

@MainActor
@Observable
public final class LibraryStore {
    public private(set) var podcasts: [Podcast] = []
    public private(set) var isLoading = false
    public private(set) var hasLoaded = false
    public private(set) var error: String?

    private let api: APIClient
    private let session: SessionStore
    private let defaults: UserDefaults
    private let progressDirectory: URL
    private let guestKey = "guest.library.podcasts"
    private static let releasesPerPodcast = 2
    @ObservationIgnored private var unsavedProgress: [Int: PlaybackUpdate] = [:]
    let durable: DurableStateStore
    var syncPending: Bool { durable.pending }
    var syncBlocked: Bool { durable.blocked }
    var syncError: String? { durable.error ?? error }
    var legacyProgress: [PlaybackProgressWriter.Update] { durable.legacyProgress }
    var unresolvedCount: Int { durable.unresolvedCount }

    public init(api: APIClient, session: SessionStore, defaults: UserDefaults = .standard, progressDirectory: URL? = nil) {
        self.api = api
        self.session = session
        self.defaults = defaults
        self.progressDirectory = progressDirectory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Podcst/Progress", isDirectory: true)
        durable = DurableStateStore(directory: self.progressDirectory, api: api, accountID: session.user?.id)
        do { try durable.importGuestSource(defaults.data(forKey: guestKey)) }
        catch { self.error = "Guest follows could not be migrated. Original data has been preserved." }
        let cached = session.user == nil ? nil : api.cachedSubscriptions()
        podcasts = session.user == nil ? loadGuest() : cached ?? []
        hasLoaded = cached != nil || !api.hasSession
    }

    public var newReleases: [Episode] {
        podcasts.flatMap {
            $0.episodes.sorted { ($0.published ?? .distantPast) > ($1.published ?? .distantPast) }
                .prefix(Self.releasesPerPodcast)
        }
        .sorted { ($0.published ?? .distantPast) > ($1.published ?? .distantPast) }
    }

    func progress(for episode: Episode) -> EpisodeProgress? {
        guard !session.isLoading, let id = episode.id, let value = durable.position(id) else { return nil }
        return EpisodeProgress(episodeId: id, position: Double(value.positionSeconds), completed: value.completed)
    }

    private func activateState() async throws {
        guard !session.isLoading else { throw DurableStateFailure.suspended }
        try await durable.activate(accountID: session.user?.id, verifiedAccountID: session.verifiedAccountID)
        if let accountID = session.user?.id {
            let key = SHA256.hash(data: Data(accountID.utf8)).map { String(format: "%02x", $0) }.joined()
            try durable.importLegacyProgress(progressDirectory.appendingPathComponent(key + ".json"))
        }
    }

    func loadProgress(for episodes: [Episode]) async {
        let accountID = session.user?.id
        do {
            try await activateState()
            try await durable.refreshProgress(ids: episodes.compactMap(\.id))
        } catch {
            guard !Task.isCancelled, session.user?.id == accountID, !session.isLoading else { return }
            self.error = error.localizedDescription
        }
    }

    public func isSubscribed(_ podcast: Podcast) -> Bool {
        podcast.id.map { durable.followedIDs.contains($0) } ?? (session.user == nil && durable.unresolvedGuest.contains { $0.identity == podcast.identity })
    }

    public func load(forceRefresh: Bool = false) async {
        guard !session.isLoading else { return }
        let accountID = session.user?.id
        isLoading = true
        defer {
            if session.user?.id == accountID {
                isLoading = false
                hasLoaded = true
            }
        }
        do {
            if accountID != nil {
                try await activateState()
                await durable.flush()
                let subscriptions = try await api.refreshSubscriptions()
                guard session.user?.id == accountID, !Task.isCancelled else { return }
                guard durable.verified else { podcasts = []; return }
                podcasts = subscriptions.filter { podcast in
                    podcast.id.map { durable.followedIDs.contains($0) && !durable.unavailableIDs.contains($0) } ?? false
                }
            } else {
                try await durable.activate(accountID: nil)
                podcasts = loadGuest()
                var refreshError: Error?
                for podcast in podcasts {
                    do {
                        try await loadGuestPodcast(podcast, forceRefresh: forceRefresh)
                    } catch {
                        guard session.user == nil, !session.isLoading, !Task.isCancelled else { return }
                        refreshError = error
                    }
                    guard session.user == nil, !session.isLoading, !Task.isCancelled else { return }
                }
                if let refreshError { throw refreshError }
            }
            error = nil
        } catch let failure {
            guard session.user?.id == accountID, !Task.isCancelled else { return }
            error = failure.localizedDescription
        }
    }

    public func toggleSubscription(_ podcast: Podcast) async {
        guard !session.isLoading else { return }
        guard podcast.isPrivate != true || session.user != nil else { error = "Sign in to follow a private podcast"; return }
        let accountID = session.user?.id
        do {
            if durable.accountID != accountID { try await activateState() }
            else if accountID != nil && !durable.verified {
                do { try await activateState() } catch { self.error = "Changes saved locally; waiting for account verification." }
            }
            let followed = !isSubscribed(podcast)
            try durable.setFollow(podcast, followed: followed)
            if followed { podcasts.append(podcast) } else { podcasts.removeAll { $0.identity == podcast.identity } }
            error = nil
            if accountID == nil, followed { try await loadGuestPodcast(podcast) }
            guard session.user?.id == accountID, !session.isLoading else { return }
            await durable.flush()
        } catch {
            guard session.user?.id == accountID, !session.isLoading, !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
    }

    func restoreProgress() async -> PlaybackProgress? {
        guard !Task.isCancelled, !session.isLoading, let accountID = session.user?.id, api.accountID == accountID else { return nil }
        do {
            try await activateState()
            await durable.flush(includeFollows: false)
            guard !durable.progressPending, !durable.progressBlocked, durable.verified else { return nil }
            let latest = try await api.currentProgress()
            guard !Task.isCancelled, !session.isLoading, session.user?.id == accountID, !durable.progressPending else { return nil }
            return latest
        } catch {
            guard !Task.isCancelled, session.user?.id == accountID, !session.isLoading else { return nil }
            self.error = error.localizedDescription
            return nil
        }
    }

    public func saveProgress(_ update: PlaybackUpdate) {
        guard durable.accountID == session.user?.id else { error = "Playback remains local until this account is verified."; return }
        guard let id = update.episode.id else { error = "This episode has no canonical identity. Playback remains local."; return }
        do {
            try durable.setProgress(id: id, position: update.position, event: update.event ?? (update.completed ? .ended : .checkpoint))
            unsavedProgress[id] = nil
            error = nil
            Task { await durable.flush(includeFollows: false) }
        } catch { unsavedProgress[id] = update; self.error = error.localizedDescription }
    }

    func mark(_ episode: Episode, played: Bool) {
        guard durable.accountID == session.user?.id else { error = "Verify this account before saving progress."; return }
        guard let id = episode.id else { error = "Episode identity is unresolved."; return }
        do {
            try durable.setProgress(id: id, position: 0, event: played ? .played : .unplayed)
            Task { await durable.flush(includeFollows: false) }
        } catch { self.error = error.localizedDescription }
    }

    func reapplyLegacy(_ update: PlaybackProgressWriter.Update) {
        do { try durable.reapplyLegacy(update); Task { await durable.flush(includeFollows: false) } }
        catch { self.error = error.localizedDescription }
    }

    func flushProgress() async {
        guard !session.isLoading else { return }
        do { try await activateState(); await durable.flush(includeFollows: false) }
        catch { self.error = error.localizedDescription }
    }

    func checkpointAndSuspend() throws {
        for (id, update) in unsavedProgress {
            try durable.setProgress(id: id, position: update.position, event: update.event ?? (update.completed ? .ended : .checkpoint))
        }
        try durable.checkpointAndSuspend()
        unsavedProgress = [:]
    }
    func terminalErase(accountID: String) throws {
        let key = SHA256.hash(data: Data(accountID.utf8)).map { String(format: "%02x", $0) }.joined()
        let source = progressDirectory.appendingPathComponent(key + ".json")
        if FileManager.default.fileExists(atPath: source.path) { try FileManager.default.removeItem(at: source) }
        try durable.terminalErase(accountID: accountID)
    }

    func reapplyGuest(_ change: StateProgressChange) {
        do { try durable.reapplyGuest(change); Task { await durable.flush(includeFollows: false) } }
        catch { self.error = error.localizedDescription }
    }

    public func resetProgressSync(accountID: String? = nil) async {
        guard unsavedProgress.isEmpty else { error = "Unable to suspend: playback changes still need device storage."; return }
        durable.selectAccount(accountID)
        error = nil
        podcasts = []
    }

    public func importFeeds(_ feeds: [String]) async {
        guard !feeds.isEmpty else { return }
        do {
            try await activateState()
            if let accountID = session.user?.id {
                await durable.flush()
                guard let scope = durable.scope else { throw DurableStateFailure.suspended }
                try durable.stageImport(feeds)
                let pending = durable.pendingImportFeeds
                for offset in stride(from: 0, to: pending.count, by: 20) {
                    let batch = Array(pending[offset..<min(offset + 20, pending.count)])
                    let result = try await api.resolveFollows(batch, scope: scope)
                    guard session.user?.id == accountID, durable.scope == scope,
                          result.protocol == 1, result.accountId == scope.accountId, result.generation == scope.generation,
                          result.items.map(\.index) == Array(batch.indices),
                          result.items.allSatisfy({ ($0.status == "resolved" && $0.podcastId != nil) || ($0.status == "unavailable" && $0.podcastId == nil) }) else { throw DurableStateFailure.protocolViolation }
                    for item in result.items {
                        if let id = item.podcastId { try durable.resolvedImport(feed: batch[item.index], id: id) }
                    }
                    if result.items.contains(where: { $0.status == "unavailable" }) { error = "Some feeds could not be resolved. Retry the import to resolve them." }
                }
                await durable.flush()
            } else {
                for feed in feeds {
                    let podcast = try await api.podcast(feed: feed)
                    if podcast.isPrivate != true { try durable.setFollow(podcast, followed: true) }
                }
                podcasts = durable.guestFollows
            }
        } catch { self.error = error.localizedDescription }
    }

    private func loadGuest() -> [Podcast] { durable.guestFollows + durable.unresolvedGuest }

    private func loadGuestPodcast(_ podcast: Podcast, forceRefresh: Bool = false) async throws {
        var updated: Podcast
        if forceRefresh {
            updated = try await api.detail(of: podcast, forceRefresh: true)
        } else if let id = podcast.id {
            let page = try await api.episodes(podcastID: id, limit: Self.releasesPerPodcast)
            updated = podcast
            updated.episodes = page.episodes
            updated.episodeCount = page.total
        } else {
            updated = try await api.podcast(feed: podcast.feed)
        }
        guard session.user == nil, !session.isLoading, !Task.isCancelled,
              let index = podcasts.firstIndex(of: podcast) else { return }
        try durable.cacheGuest(updated, replacing: podcast)
        podcasts[index] = updated
    }

}
