import Foundation
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

    public init(api: APIClient, session: SessionStore, defaults: UserDefaults = .standard) {
        self.api = api
        self.session = session
        self.defaults = defaults
        podcasts = loadGuest()
    }

    public var newReleases: [Episode] {
        podcasts.flatMap(\.episodes).sorted { ($0.published ?? .distantPast) > ($1.published ?? .distantPast) }
    }

    public func isSubscribed(_ podcast: Podcast) -> Bool {
        podcasts.contains { $0.identity == podcast.identity }
    }

    public func load(forceRefresh: Bool = false) async {
        isLoading = true
        defer {
            isLoading = false
            hasLoaded = true
        }
        do {
            if session.user != nil {
                if let cached = api.cachedSubscriptions() { podcasts = cached }
                podcasts = try await (forceRefresh ? api.refreshSubscriptions() : api.subscriptions())
                progress = try? await api.currentProgress()
            } else {
                podcasts = loadGuest()
                progress = nil
            }
            error = nil
        } catch let failure {
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

    public func saveProgress(episodeID: Int, position: Double, completed: Bool) async {
        guard session.user != nil else { return }
        do {
            try await api.saveProgress(episodeID: episodeID, position: position, completed: completed)
            if completed { progress = nil }
            error = nil
        } catch let failure {
            error = failure.localizedDescription
        }
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
