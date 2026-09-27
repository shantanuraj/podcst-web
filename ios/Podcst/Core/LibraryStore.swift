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
    public private(set) var progress: PlaybackProgress?

    private let api: APIClient
    private let session: SessionStore
    private let defaults: UserDefaults
    private let guestKey = "guest.library.podcasts"
    @ObservationIgnored private var progressWriter: PlaybackProgressWriter?
    @ObservationIgnored private var progressAccountID: String?

    public init(api: APIClient, session: SessionStore, defaults: UserDefaults = .standard) {
        self.api = api
        self.session = session
        self.defaults = defaults
        let cached = session.user == nil ? nil : api.cachedSubscriptions()
        podcasts = session.user == nil ? loadGuest() : cached ?? []
        hasLoaded = cached != nil || !api.hasSession
    }

    public var newReleases: [Episode] {
        podcasts.flatMap(\.episodes).sorted { ($0.published ?? .distantPast) > ($1.published ?? .distantPast) }
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
            if let accountID {
                await writer(for: accountID).flush()
                guard session.user?.id == accountID, !Task.isCancelled else { return }
                if let cached = api.cachedSubscriptions() { podcasts = cached }
                let subscriptions = try await (forceRefresh ? api.refreshSubscriptions() : api.subscriptions())
                guard session.user?.id == accountID, !Task.isCancelled else { return }
                podcasts = subscriptions
                let latest = try? await api.currentProgress()
                guard session.user?.id == accountID, !Task.isCancelled else { return }
                progress = latest
            } else {
                podcasts = loadGuest()
                progress = nil
            }
            error = nil
        } catch let failure {
            guard session.user?.id == accountID, !Task.isCancelled else { return }
            error = failure.localizedDescription
        }
    }

    public func toggleSubscription(_ podcast: Podcast) async {
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
                } else {
                    podcasts.append(podcast)
                }
                persistGuest()
            }
            error = nil
        } catch let failure {
            error = failure.localizedDescription
        }
    }

    public func restoreProgress() async {
        guard session.user != nil else {
            progress = nil
            return
        }
        do {
            progress = try await api.currentProgress()
            error = nil
        } catch let failure {
            error = failure.localizedDescription
        }
    }

    public func saveProgress(_ update: PlaybackUpdate) {
        guard let accountID = session.user?.id, let episodeID = update.episode.id else { return }
        writer(for: accountID).submit(.init(episodeID: episodeID, position: update.position, completed: update.completed))
    }

    private func writer(for accountID: String) -> PlaybackProgressWriter {
        if progressAccountID == accountID, let progressWriter { return progressWriter }
        let key = SHA256.hash(data: Data(accountID.utf8)).map { String(format: "%02x", $0) }.joined()
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Podcst/Progress", isDirectory: true)
        let writer = PlaybackProgressWriter(storageURL: directory.appendingPathComponent(key + ".json")) { [weak self] value in
            guard let self, self.session.user?.id == accountID, self.api.accountID == accountID else { throw CancellationError() }
            do {
                try await self.api.saveProgress(episodeID: value.episodeID, position: value.position, completed: value.completed)
                guard self.session.user?.id == accountID, !Task.isCancelled else { return }
                if value.completed { self.progress = nil }
                self.error = nil
            } catch {
                guard self.session.user?.id == accountID, !Task.isCancelled else { return }
                self.error = error.localizedDescription
                throw error
            }
        }
        progressAccountID = accountID
        progressWriter = writer
        return writer
    }

    public func resetProgressSync() async {
        let writer = progressWriter
        progressWriter = nil
        progressAccountID = nil
        await writer?.reset()
        podcasts = []
        progress = nil
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
                    if let podcast = try? await api.podcast(feed: feed) { imported.append(podcast) }
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
        return value
    }

    private func persistGuest() {
        if let data = try? JSONEncoder().encode(podcasts) { defaults.set(data, forKey: guestKey) }
    }
}
