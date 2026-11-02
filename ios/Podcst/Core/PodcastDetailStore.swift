import Foundation
import Observation
import OSLog

struct PodcastEpisodeQuery: Hashable, Sendable {
    var search = ""
    var newestFirst = true

    var isDefault: Bool { search.isEmpty && newestFirst }
}

@MainActor
protocol PodcastDetailService: AnyObject, Sendable {
    var activityToken: UUID { get }
    var podcastPages: PodcastPageCache { get }
    func cachedPodcast(id: Int?, feed: String) -> Podcast?
    func resolvePodcast(_ podcast: Podcast) async throws -> Podcast
    func podcastInfo(id: Int) async throws -> Podcast
    func episodePage(podcastID: Int, query: PodcastEpisodeQuery, cursor: Int?) async throws -> EpisodePage
    func refresh(podcastID: Int) async throws -> FeedRefreshResponse
    func invalidatePodcast(id: Int)
    func persistPodcastPage(id: Int)
}

@MainActor
final class PodcastPageCache {
    struct Key: Hashable {
        let id: Int
        let query: PodcastEpisodeQuery
    }

    private var metadata: [Int: Podcast] = [:]
    private var pages: [Key: EpisodePage] = [:]
    private var order: [Int] = []

    func info(_ id: Int) -> Podcast? { metadata[id] }
    func page(_ id: Int, query: PodcastEpisodeQuery) -> EpisodePage? { pages[Key(id: id, query: query)] }

    func store(_ podcast: Podcast) {
        guard let id = podcast.id else { return }
        metadata[id] = podcast
        touch(id)
    }

    func store(_ page: EpisodePage, id: Int, query: PodcastEpisodeQuery) {
        guard page.freshness?.content != .missing else { return }
        if pages.keys.filter({ $0.id == id }).count >= 8, pages[Key(id: id, query: query)] == nil {
            pages = pages.filter { $0.key.id != id || $0.key.query.isDefault }
        }
        pages[Key(id: id, query: query)] = page
        touch(id)
    }

    func remove(_ id: Int) {
        metadata[id] = nil
        pages = pages.filter { $0.key.id != id }
        order.removeAll { $0 == id }
    }

    func clear() {
        metadata.removeAll()
        pages.removeAll()
        order.removeAll()
    }

    private func touch(_ id: Int) {
        order.removeAll { $0 == id }
        order.append(id)
        if order.count > 40 { remove(order[0]) }
    }
}

@MainActor
@Observable
final class PodcastDetailStore {
    static let pageSize = 30
    private(set) var podcast: Podcast?
    private(set) var page: EpisodePage?
    private(set) var latest: Episode?
    private(set) var scope: UUID?
    private(set) var query = PodcastEpisodeQuery()
    private(set) var isLoading = false
    private(set) var isLoadingMore = false
    private(set) var isRechecking = false
    private(set) var loadFailed = false
    private(set) var moreFailed = false
    private(set) var updateFailed = false
    private(set) var unavailable = false
    private(set) var freshness: FeedFreshness?
    @ObservationIgnored private var identity: String?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var pageRevision = UUID()
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let wait: (TimeInterval) async throws -> Void
    private static let logger = Logger(subsystem: "app.podcst.ios", category: "PodcastDetail")

    init(now: @escaping () -> Date = Date.init, wait: @escaping (TimeInterval) async throws -> Void = { try await Task.sleep(for: .seconds($0)) }) {
        self.now = now
        self.wait = wait
    }

    var episodes: [Episode] { page?.episodes ?? [] }
    var hasMore: Bool { page?.hasMore == true && page?.nextCursor != nil }

    func load(_ original: Podcast, api: any PodcastDetailService, query requested: PodcastEpisodeQuery = PodcastEpisodeQuery(), forceRefresh: Bool = false) async {
        let token = api.activityToken
        let owner = UUID()
        let changedIdentity = identity != nil && identity != original.identity
        identity = original.identity
        let changedQuery = query != requested
        let changedScope = scope != nil && scope != token
        generation = owner
        pageRevision = UUID()
        scope = token
        query = requested
        isLoading = true
        isLoadingMore = false
        isRechecking = false
        loadFailed = false
        moreFailed = false
        updateFailed = false
        if changedScope || changedIdentity {
            podcast = nil
            page = nil
            latest = nil
            freshness = nil
        }
        if changedQuery { page = nil }
        unavailable = changedScope && original.isPrivate == true
        if unavailable {
            podcast = Podcast(id: original.id, feed: "", title: "Podcast unavailable", isPrivate: true)
            isLoading = false
            loadFailed = true
            return
        }
        let saved = api.cachedPodcast(id: original.id, feed: original.feed) ?? original
        let source = podcast ?? saved
        podcast = source
        if let id = source.id {
            podcast = api.podcastPages.info(id) ?? source
            if page == nil { page = api.podcastPages.page(id, query: requested) }
            latest = api.podcastPages.page(id, query: PodcastEpisodeQuery())?.episodes.first ?? latest
        }
        if latest == nil { latest = source.episodes.max { ($0.published ?? .distantPast) < ($1.published ?? .distantPast) } }
        if requested.isDefault, !saved.episodes.isEmpty, saved.episodes.count > episodes.count {
            let initial = saved.episodes.sorted { ($0.published ?? .distantPast) > ($1.published ?? .distantPast) }
            let total = max(saved.episodeCount, initial.count)
            page = EpisodePage(episodes: initial, total: total, hasMore: total > initial.count, nextCursor: total > initial.count ? initial.count : nil, freshness: saved.freshness)
        }
        freshness = page?.freshness
        defer {
            if owns(api, token: token, owner: owner) {
                isLoading = false
                isRechecking = false
            }
        }
        let startedAt = now()
        do {
            if changedQuery, !requested.search.isEmpty { try await wait(0.25) }
            try Task.checkCancellation()
            guard active(api, token: token, owner: owner) else { return }
            let resolved = source.id == nil ? try await api.resolvePodcast(source) : source
            guard active(api, token: token, owner: owner), let id = resolved.id else { return }
            if podcast?.id == nil { podcast = resolved }
            async let metadata: Void = readInfo(id: id, api: api, token: token, owner: owner)
            async let catalogue: Void = readFirstPage(id: id, api: api, token: token, owner: owner)
            async let newest: Void = readLatestIfNeeded(id: id, api: api, token: token, owner: owner)
            _ = await (metadata, catalogue, newest)
            guard active(api, token: token, owner: owner), !unavailable else { return }
            let retryAllowed = Double(freshness?.retryAtMs ?? 0) <= now().timeIntervalSince1970 * 1000
            if retryAllowed, forceRefresh || freshness?.state == .stale {
                let checkedAt = freshness?.checkedAtMs
                do {
                    let response = try await api.refresh(podcastID: id)
                    guard active(api, token: token, owner: owner) else { return }
                    freshness = response.freshness
                    if response.freshness.content == .cached, response.freshness.checkedAtMs != checkedAt {
                        await readFirstPage(id: id, api: api, token: token, owner: owner)
                    }
                } catch {
                    guard active(api, token: token, owner: owner) else { return }
                    handle(error, id: id, api: api)
                    updateFailed = !unavailable
                }
            }
            while active(api, token: token, owner: owner), !unavailable,
                  let delay = freshness?.recheckDelay(startedAt: startedAt, now: now()) {
                isRechecking = true
                try await wait(delay)
                guard active(api, token: token, owner: owner) else { return }
                await readFirstPage(id: id, api: api, token: token, owner: owner)
                if loadFailed { break }
            }
            if active(api, token: token, owner: owner), episodes.isEmpty, freshness?.content == .missing { loadFailed = true }
        } catch {
            guard active(api, token: token, owner: owner) else { return }
            if let id = source.id { handle(error, id: id, api: api) }
            loadFailed = true
        }
    }

    func loadMore(api: any PodcastDetailService) async {
        guard !isLoading, !isLoadingMore, !loadFailed, !unavailable, hasMore,
              let id = podcast?.id, let cursor = page?.nextCursor, let token = scope, token == api.activityToken else { return }
        let owner = generation
        let revision = pageRevision
        isLoadingMore = true
        moreFailed = false
        defer { if owns(api, token: token, owner: owner) { isLoadingMore = false } }
        do {
            let result = try await api.episodePage(podcastID: id, query: query, cursor: cursor)
            guard active(api, token: token, owner: owner), !unavailable, pageRevision == revision else { return }
            guard result.freshness?.content != .missing,
                  !result.hasMore || result.nextCursor.map({ $0 > cursor }) == true else { throw FeedContractError.invalidResponse }
            var known = Set(episodes.map(\.identity))
            let additions = result.episodes.filter { known.insert($0.identity).inserted }
            page = EpisodePage(episodes: episodes + additions, total: result.total, hasMore: result.hasMore, nextCursor: result.nextCursor, freshness: result.freshness)
        } catch {
            guard active(api, token: token, owner: owner), pageRevision == revision else { return }
            handle(error, id: id, api: api)
            moreFailed = !unavailable
        }
    }

    private func readInfo(id: Int, api: any PodcastDetailService, token: UUID, owner: UUID) async {
        let start = now()
        do {
            let info = try await api.podcastInfo(id: id)
            guard active(api, token: token, owner: owner), !unavailable else { return }
            guard info.id == id else { throw FeedContractError.invalidResponse }
            podcast = info
            api.podcastPages.store(info)
            api.persistPodcastPage(id: id)
            Self.logger.info("metadata ready duration=\(self.now().timeIntervalSince(start), privacy: .public)s")
        } catch {
            guard active(api, token: token, owner: owner) else { return }
            handle(error, id: id, api: api)
            updateFailed = !unavailable
        }
    }

    private func readLatestIfNeeded(id: Int, api: any PodcastDetailService, token: UUID, owner: UUID) async {
        guard !query.isDefault, latest == nil else { return }
        do {
            let result = try await awaitFeedContent(read: {
                let result = try await api.episodePage(podcastID: id, query: PodcastEpisodeQuery(), cursor: nil)
                if result.freshness?.content == .missing {
                    throw APIError(statusCode: 202, message: "Preparing episodes", freshness: result.freshness)
                }
                return result
            }, active: { self.active(api, token: token, owner: owner) }, pending: { _ in }, now: now, wait: wait)
            guard active(api, token: token, owner: owner), !unavailable else { return }
            api.podcastPages.store(result, id: id, query: PodcastEpisodeQuery())
            api.persistPodcastPage(id: id)
            latest = result.episodes.first
        } catch {
            guard active(api, token: token, owner: owner) else { return }
            handle(error, id: id, api: api)
            updateFailed = !unavailable
        }
    }

    private func readFirstPage(id: Int, api: any PodcastDetailService, token: UUID, owner: UUID) async {
        let start = now()
        let visibleCount = episodes.count
        isLoading = true
        pageRevision = UUID()
        defer { if owns(api, token: token, owner: owner) { isLoading = false } }
        do {
            let result = try await api.episodePage(podcastID: id, query: query, cursor: nil)
            guard active(api, token: token, owner: owner), !unavailable else { return }
            guard !result.hasMore || result.nextCursor.map({ $0 > 0 }) == true else { throw FeedContractError.invalidResponse }
            freshness = result.freshness
            if result.freshness?.content != .missing || episodes.isEmpty {
                api.podcastPages.store(result, id: id, query: query)
                if query.isDefault { api.persistPodcastPage(id: id) }
                if query.isDefault { latest = result.episodes.first }
                Self.logger.info("first page ready duration=\(self.now().timeIntervalSince(start), privacy: .public)s count=\(result.episodes.count, privacy: .public)")
                var rebuilt = result
                while rebuilt.episodes.count < visibleCount, rebuilt.hasMore, let cursor = rebuilt.nextCursor {
                    let next = try await api.episodePage(podcastID: id, query: query, cursor: cursor)
                    guard active(api, token: token, owner: owner), !unavailable else { return }
                    guard next.freshness?.content != .missing,
                          !next.hasMore || next.nextCursor.map({ $0 > cursor }) == true else { throw FeedContractError.invalidResponse }
                    var known = Set(rebuilt.episodes.map(\.identity))
                    rebuilt = EpisodePage(episodes: rebuilt.episodes + next.episodes.filter { known.insert($0.identity).inserted }, total: next.total, hasMore: next.hasMore, nextCursor: next.nextCursor, freshness: next.freshness)
                }
                page = rebuilt
            }
            loadFailed = false
        } catch {
            guard active(api, token: token, owner: owner) else { return }
            handle(error, id: id, api: api)
            let pending = (error as? APIError)?.freshness
            if pending?.state == .pending || pending?.state == .backoff { freshness = pending }
            loadFailed = pending?.state != .pending && pending?.state != .backoff
        }
    }

    private func active(_ api: any PodcastDetailService, token: UUID, owner: UUID) -> Bool {
        !Task.isCancelled && owns(api, token: token, owner: owner)
    }

    private func owns(_ api: any PodcastDetailService, token: UUID, owner: UUID) -> Bool {
        generation == owner && api.activityToken == token
    }

    private func handle(_ error: Error, id: Int, api: any PodcastDetailService) {
        guard let failure = error as? APIError, [401, 403, 404].contains(failure.statusCode) else { return }
        api.invalidatePodcast(id: id)
        podcast = Podcast(id: id, feed: "", title: "Podcast unavailable")
        page = nil
        latest = nil
        freshness = nil
        unavailable = true
        loadFailed = true
    }
}

extension APIClient {
    func episodePage(podcastID: Int, query: PodcastEpisodeQuery, cursor: Int?) async throws -> EpisodePage {
        try await episodes(podcastID: podcastID, cursor: cursor, search: query.search, sortDirection: query.newestFirst ? "desc" : "asc", limit: PodcastDetailStore.pageSize)
    }
}
