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
    @ObservationIgnored private var progressWriter: PlaybackProgressWriter?
    private var progressAccountID: String?
    private var savedProgress: [Int: EpisodeProgress] = [:]
    @ObservationIgnored private var progressEdits: [Int: UUID] = [:]
    @ObservationIgnored private var progressRead = UUID()

    public init(api: APIClient, session: SessionStore, defaults: UserDefaults = .standard, progressDirectory: URL? = nil) {
        self.api = api
        self.session = session
        self.defaults = defaults
        self.progressDirectory = progressDirectory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Podcst/Progress", isDirectory: true)
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
        guard !session.isLoading, let accountID = session.user?.id,
              progressAccountID == accountID, let id = episode.id else { return nil }
        return savedProgress[id]
    }

    func loadProgress(for episodes: [Episode]) async {
        guard !Task.isCancelled, !session.isLoading, let accountID = session.user?.id,
              api.accountID == accountID else { return }
        let ids = Set(episodes.compactMap(\.id))
        guard !ids.isEmpty else { return }
        let writer = writer(for: accountID)
        let edits = progressEdits
        let pending = Set(writer.pendingUpdates.map(\.episodeID))
        let read = UUID()
        progressRead = read
        do {
            let rows = try await api.episodeProgress(episodeIDs: Array(ids))
            guard !Task.isCancelled, !session.isLoading, session.user?.id == accountID,
                  api.accountID == accountID, progressWriter === writer, progressRead == read else { return }
            let protected = pending.union(writer.pendingUpdates.map(\.episodeID))
            let remote = Dictionary(uniqueKeysWithValues: rows.map { ($0.episodeId, $0) })
            for id in ids where edits[id] == progressEdits[id] && !protected.contains(id) {
                savedProgress[id] = remote[id]
            }
        } catch {
            return
        }
    }

    public func isSubscribed(_ podcast: Podcast) -> Bool {
        podcasts.contains { $0.identity == podcast.identity }
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
                if let cached = api.cachedSubscriptions() { podcasts = cached }
                let subscriptions = try await (forceRefresh ? api.refreshSubscriptions() : api.subscriptions())
                guard session.user?.id == accountID, !Task.isCancelled else { return }
                podcasts = subscriptions
            } else {
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
        guard podcast.isPrivate != true || session.user != nil else {
            error = "Sign in to follow a private podcast"
            return
        }
        let accountID = session.user?.id
        do {
            if session.user != nil {
                guard let id = podcast.id else { throw APIError(statusCode: 400, message: "Podcast ID required") }
                if isSubscribed(podcast) {
                    try await api.unsubscribe(podcastID: id)
                } else {
                    try await api.subscribe(podcastID: id)
                }
                podcasts = try await api.subscriptions()
            } else {
                if let index = podcasts.firstIndex(where: { $0.identity == podcast.identity }) {
                    podcasts.remove(at: index)
                    persistGuest()
                } else {
                    podcasts.append(podcast)
                    persistGuest()
                    try await loadGuestPodcast(podcast)
                }
                guard session.user == nil, !session.isLoading, !Task.isCancelled else { return }
            }
            error = nil
        } catch let failure {
            guard session.user?.id == accountID, !session.isLoading, !Task.isCancelled else { return }
            error = failure.localizedDescription
        }
    }

    func restoreProgress() async -> PlaybackProgress? {
        guard !Task.isCancelled, !session.isLoading,
              let accountID = session.user?.id, api.accountID == accountID else { return nil }
        let writer = writer(for: accountID)
        await writer.flush()
        guard !Task.isCancelled, !session.isLoading,
              session.user?.id == accountID, !writer.hasPendingUpdates else { return nil }
        do {
            let latest = try await api.currentProgress()
            guard !Task.isCancelled, !session.isLoading,
                  session.user?.id == accountID, !writer.hasPendingUpdates else { return nil }
            error = nil
            return latest
        } catch let failure {
            guard !Task.isCancelled, !session.isLoading,
                  session.user?.id == accountID else { return nil }
            error = failure.localizedDescription
            return nil
        }
    }

    public func saveProgress(_ update: PlaybackUpdate) {
        guard let accountID = session.user?.id, let episodeID = update.episode.id else { return }
        let writer = writer(for: accountID)
        savedProgress[episodeID] = EpisodeProgress(episodeId: episodeID, position: update.position, completed: update.completed)
        progressEdits[episodeID] = UUID()
        writer.submit(.init(episodeID: episodeID, position: update.position, completed: update.completed))
    }

    func flushProgress() async {
        guard !Task.isCancelled, !session.isLoading,
              let accountID = session.user?.id, api.accountID == accountID else { return }
        await writer(for: accountID).flush()
    }

    private func writer(for accountID: String) -> PlaybackProgressWriter {
        if progressAccountID == accountID, let progressWriter { return progressWriter }
        let key = SHA256.hash(data: Data(accountID.utf8)).map { String(format: "%02x", $0) }.joined()
        let writer = PlaybackProgressWriter(storageURL: progressDirectory.appendingPathComponent(key + ".json")) { [weak self] value in
            guard let self, self.session.user?.id == accountID, self.api.accountID == accountID else { throw CancellationError() }
            do {
                try await self.api.saveProgress(episodeID: value.episodeID, position: value.position, completed: value.completed)
                guard self.session.user?.id == accountID, !Task.isCancelled else { return }
                self.error = nil
            } catch {
                guard self.session.user?.id == accountID, !Task.isCancelled else { return }
                self.error = error.localizedDescription
                throw error
            }
        }
        savedProgress = Dictionary(uniqueKeysWithValues: writer.pendingUpdates.map {
            ($0.episodeID, EpisodeProgress(episodeId: $0.episodeID, position: $0.position, completed: $0.completed))
        })
        progressEdits = [:]
        progressAccountID = accountID
        progressWriter = writer
        return writer
    }

    public func resetProgressSync() async {
        let writer = progressWriter
        progressWriter = nil
        progressAccountID = nil
        progressRead = UUID()
        savedProgress = [:]
        progressEdits = [:]
        podcasts = []
        await writer?.reset()
    }

    public func importFeeds(_ feeds: [String]) async {
        guard !feeds.isEmpty else { return }
        do {
            if session.user != nil {
                _ = try await api.importSubscriptions(feeds: feeds)
                podcasts = try await api.subscriptions()
            } else {
                var imported: [Podcast] = []
                for feed in feeds {
                    if let podcast = try? await api.podcast(feed: feed), podcast.isPrivate != true { imported.append(podcast) }
                }
                var byIdentity = Dictionary(uniqueKeysWithValues: podcasts.map { ($0.identity, $0) })
                imported.forEach { byIdentity[$0.identity] = $0 }
                podcasts = Array(byIdentity.values).sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
                persistGuest()
            }
            error = nil
        } catch let failure {
            error = failure.localizedDescription
        }
    }

    private func loadGuest() -> [Podcast] {
        guard let data = defaults.data(forKey: guestKey), let value = try? JSONDecoder().decode([Podcast].self, from: data) else { return [] }
        return value.filter { $0.isPrivate != true }
    }

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
        podcasts[index] = updated
        persistGuest()
    }

    private func persistGuest() {
        if let data = try? JSONEncoder().encode(podcasts) { defaults.set(data, forKey: guestKey) }
    }
}
