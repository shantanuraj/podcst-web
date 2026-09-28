import AuthenticationServices
import Foundation
import Observation
import Security
import UIKit

@MainActor
@Observable
public final class APIClient {
    public nonisolated static let productionBaseURL = URL(string: "https://www.podcst.app")!

    private let baseURL: URL
    private let session: URLSession
    private let visitorId: String
    private var sessionCookie: String?
    private var currentUserID: String?
    private var sessionRevision = UUID()
    var hasSession: Bool { sessionCookie?.isEmpty == false }
    var accountID: String? { currentUserID }

    func restoreAccount(_ id: String?) { currentUserID = id }
    private let keychain: any SessionCredentialStore
    private let feedCache = FeedCache(storageURL: FeedCache.defaultStorageURL())
    private let topCache = PodcastSnapshotCache(namespace: "top", lifetime: 3600)
    private let subscriptionCache = PodcastSnapshotCache(namespace: "subscriptions", lifetime: 86400)
    private var topRequests: [String: Task<[Podcast], Error>] = [:]
    private var subscriptionRequest: Task<[Podcast], Error>?

    public init(baseURL: URL = APIClient.productionBaseURL, session: URLSession = .shared, keychain: any SessionCredentialStore = KeychainStore()) {
        self.baseURL = baseURL
        self.session = session
        self.keychain = keychain
        self.visitorId = UUID().uuidString
        self.sessionCookie = keychain.read()
    }

    public func top(locale: String = "us", limit: Int = 30) async throws -> [Podcast] {
        let key = "\(locale.lowercased())-\(limit)"
        if let snapshot = topCache.load(key) {
            guard snapshot.isStale else { return snapshot.value }
            do { return try await refreshTop(locale: locale, limit: limit, key: key) }
            catch { return snapshot.value }
        }
        return try await refreshTop(locale: locale, limit: limit, key: key)
    }

    public func cachedTop(locale: String = "us", limit: Int = 30) -> [Podcast]? {
        topCache.load("\(locale.lowercased())-\(limit)")?.value
    }

    public func refreshTop(locale: String = "us", limit: Int = 30) async throws -> [Podcast] {
        try await refreshTop(locale: locale, limit: limit, key: "\(locale.lowercased())-\(limit)")
    }

    private func refreshTop(locale: String, limit: Int, key: String) async throws -> [Podcast] {
        if let request = topRequests[key] { return try await request.value }
        let request = Task { @MainActor [weak self] in
            guard let self else { throw APIError(statusCode: 0, message: "API client unavailable") }
            defer { self.topRequests[key] = nil }
            let rows: [RawPodcast] = try await self.get(path: "/api/top", query: [URLQueryItem(name: "limit", value: String(limit)), URLQueryItem(name: "locale", value: locale)])
            let podcasts = rows.map { self.mapPodcast($0) }
            self.topCache.store(podcasts, key: key)
            return podcasts
        }
        topRequests[key] = request
        return try await request.value
    }

    public func search(term: String, locale: String = "us") async throws -> [Podcast] {
        let rows: [RawSearchResult] = try await get(path: "/api/search", query: [URLQueryItem(name: "term", value: term), URLQueryItem(name: "locale", value: locale)])
        return rows.map { Podcast(feed: $0.feed, title: $0.title, author: $0.author, cover: $0.thumbnail, thumbnail: $0.thumbnail) }
    }

    public func cachedPodcast(id: Int? = nil, feed: String) -> Podcast? {
        feedCache.cached(id: id, feed: feed)
    }

    public func podcast(feed: String) async throws -> Podcast {
        try await feedCache.load(.feed(feed)) {
            let raw: RawPodcast = try await self.get(path: "/api/feed", query: [URLQueryItem(name: "url", value: feed)])
            return self.mapPodcast(raw, feedFallback: feed)
        }
    }

    public func podcast(id: Int) async throws -> Podcast {
        try await feedCache.load(.id(id)) {
            let raw: RawPodcast = try await self.get(path: "/api/feed", query: [URLQueryItem(name: "id", value: String(id))])
            return self.mapPodcast(raw)
        }
    }

    public func detail(of podcast: Podcast) async throws -> Podcast {
        if let id = podcast.id {
            let refresh = podcast.episodes.count <= 2 || podcast.episodes.count < podcast.episodeCount
            return try await feedCache.load(.id(id), refreshing: refresh) {
                async let info = self.podcastInfo(id: id)
                async let catalogue = self.allEpisodes(podcastID: id)
                let (infoResult, catalogueResult) = try await (info, catalogue)
                return Podcast(
                    id: infoResult.id,
                    feed: infoResult.feed,
                    title: infoResult.title,
                    author: infoResult.author,
                    cover: infoResult.cover,
                    thumbnail: infoResult.cover,
                    description: infoResult.description,
                    link: infoResult.link,
                    published: infoResult.published,
                    explicit: infoResult.explicit,
                    keywords: infoResult.keywords,
                    episodeCount: max(infoResult.episodeCount, catalogueResult.total),
                    episodes: catalogueResult.episodes
                )
            }
        }
        let resolved = try await self.podcast(feed: podcast.feed)
        guard resolved.id != nil else { return resolved }
        return try await detail(of: resolved)
    }

    public func podcastInfo(id: Int) async throws -> Podcast {
        let raw: RawPodcastInfo = try await get(path: "/api/feed/info", query: [URLQueryItem(name: "id", value: String(id))])
        return Podcast(id: raw.id, feed: raw.feed, title: raw.title, author: raw.author, cover: raw.cover, thumbnail: raw.cover, description: raw.description, link: raw.link, published: date(raw.published), explicit: raw.explicit.value, keywords: raw.keywords, episodeCount: raw.episodeCount)
    }

    public func episodes(podcastID: Int, cursor: Int? = nil, search: String? = nil, sortBy: String = "published", sortDirection: String = "desc", limit: Int = 20) async throws -> EpisodePage {
        var query = [URLQueryItem(name: "podcastId", value: String(podcastID)), URLQueryItem(name: "limit", value: String(limit)), URLQueryItem(name: "sortBy", value: sortBy), URLQueryItem(name: "sortDir", value: sortDirection)]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: String(cursor))) }
        if let search, !search.isEmpty { query.append(URLQueryItem(name: "search", value: search)) }
        let raw: RawEpisodePage = try await get(path: "/api/feed/episodes", query: query)
        return EpisodePage(episodes: raw.episodes.map { mapEpisode($0, podcastId: podcastID) }, total: raw.total, hasMore: raw.hasMore, nextCursor: raw.nextCursor)
    }

    private func allEpisodes(podcastID: Int) async throws -> (episodes: [Episode], total: Int) {
        var cursor: Int?
        var collected: [Episode] = []
        var total = 0
        repeat {
            let page = try await episodes(podcastID: podcastID, cursor: cursor, limit: 200)
            collected.append(contentsOf: page.episodes)
            total = max(total, page.total)
            guard page.hasMore, let nextCursor = page.nextCursor, nextCursor != cursor else { break }
            cursor = nextCursor
        } while true
        return (collected, total)
    }

    public func refresh(podcastID: Int) async throws -> Podcast {
        try await feedCache.load(.id(podcastID), refreshing: true) {
            let raw: RawPodcast = try await self.post(path: "/api/feed/refresh", body: ["podcastId": podcastID])
            return self.mapPodcast(raw)
        }
    }

    public func sessionUser() async throws -> User? {
        let raw: RawSession = try await get(path: "/api/auth/session")
        guard let user = raw.user else {
            currentUserID = nil
            return nil
        }
        currentUserID = user.id
        return User(id: user.id, email: user.email, name: user.name, image: user.image, hasPasskey: user.hasPasskey)
    }

    public func sendCode(email: String) async throws {
        let _: RawSent = try await post(path: "/api/auth/verify", body: ["email": email])
    }

    public func signIn(email: String, code: String) async throws -> User? {
        beginAuthentication()
        let _: RawVerified = try await post(path: "/api/auth/email-login", body: ["email": email, "code": code])
        let user = try await sessionUser()
        subscriptionRequest?.cancel()
        subscriptionRequest = nil
        feedCache.clear()
        return user
    }

    public func signInWithPasskey(email: String? = nil) async throws -> User? {
        beginAuthentication()
        let normalizedEmail = email?.trimmingCharacters(in: .whitespacesAndNewlines)
        let start: RawPasskeyLogin = try await post(
            path: "/api/auth/login",
            body: PasskeyLoginBody(
                email: normalizedEmail?.isEmpty == true ? nil : normalizedEmail,
                visitorId: visitorId,
                discoverable: normalizedEmail?.isEmpty != false
            )
        )
        guard let options = start.options else {
            if start.exists == false {
                throw APIError(statusCode: 404, message: "No account found for this email")
            }
            if start.hasPasskey == false {
                throw APIError(statusCode: 400, message: "No passkey is registered for this account")
            }
            throw APIError(statusCode: 400, message: "Passkey sign-in is unavailable")
        }
        let assertion = try await authorizePasskey(options: options)
        let result: RawPasskeyResult = try await post(
            path: "/api/auth/login",
            body: PasskeyLoginVerification(
                response: assertion,
                userId: start.userId,
                visitorId: visitorId
            )
        )
        guard result.verified else {
            throw APIError(statusCode: 400, message: "Passkey verification failed")
        }
        let user = try await sessionUser()
        subscriptionRequest?.cancel()
        subscriptionRequest = nil
        feedCache.clear()
        return user
    }

    public func registerPasskey() async throws {
        throw APIError(statusCode: 501, message: "Passkey registration is not configured for this client")
    }

    private var authorizationCoordinator: PasskeyAuthorizationCoordinator?

    private func authorizePasskey(options: RawPasskeyOptions) async throws -> PasskeyAssertion {
        guard let challenge = Data(base64URL: options.challenge) else {
            throw APIError(statusCode: 400, message: "Invalid passkey challenge")
        }
        guard let relyingPartyIdentifier = options.rpId, !relyingPartyIdentifier.isEmpty else {
            throw APIError(statusCode: 400, message: "Passkey relying party is not configured")
        }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: relyingPartyIdentifier)
        let request = provider.createCredentialAssertionRequest(challenge: challenge)
        if let credentials = options.allowCredentials {
            request.allowedCredentials = credentials.compactMap { descriptor in
                guard let credentialID = Data(base64URL: descriptor.id) else { return nil }
                return ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: credentialID)
            }
        }
        defer { authorizationCoordinator = nil }
        return try await withCheckedThrowingContinuation { continuation in
            let coordinator = PasskeyAuthorizationCoordinator(continuation: continuation)
            authorizationCoordinator = coordinator
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = coordinator
            controller.presentationContextProvider = coordinator
            coordinator.controller = controller
            controller.performRequests()
        }
    }

    func beginAuthentication() {
        sessionRevision = UUID()
        subscriptionRequest?.cancel()
        subscriptionRequest = nil
    }

    public func signOut() async {
        var request = URLRequest(url: baseURL.appendingPathComponent("/api/auth/logout"))
        request.httpMethod = "POST"
        request.httpShouldHandleCookies = false
        if let sessionCookie { request.setValue("session=\(sessionCookie)", forHTTPHeaderField: "Cookie") }
        clearSession()
        _ = try? await session.data(for: request)
    }

    func clearSession() {
        sessionRevision = UUID()
        sessionCookie = nil
        currentUserID = nil
        keychain.delete()
        subscriptionRequest?.cancel()
        subscriptionRequest = nil
        feedCache.clear()
        subscriptionCache.removeAll()
    }

    public func subscriptions() async throws -> [Podcast] {
        guard let currentUserID else {
            return try await fetchSubscriptions()
        }
        let key = currentUserID
        if let snapshot = subscriptionCache.load(key) {
            feedCache.markSubscribed(snapshot.value)
            guard snapshot.isStale else { return snapshot.value }
            do { return try await refreshSubscriptions(key: key) }
            catch { return snapshot.value }
        }
        return try await refreshSubscriptions(key: key)
    }

    public func cachedSubscriptions() -> [Podcast]? {
        guard let currentUserID else { return nil }
        return subscriptionCache.load(currentUserID)?.value
    }

    public func refreshSubscriptions() async throws -> [Podcast] {
        guard let currentUserID else { return try await fetchSubscriptions() }
        return try await refreshSubscriptions(key: currentUserID)
    }

    private func fetchSubscriptions() async throws -> [Podcast] {
        let rows: [RawPodcast] = try await get(path: "/api/subscriptions")
        let podcasts = rows.map { mapPodcast($0) }
        feedCache.markSubscribed(podcasts)
        return podcasts
    }

    private func refreshSubscriptions(key: String) async throws -> [Podcast] {
        if let request = subscriptionRequest { return try await request.value }
        let revision = sessionRevision
        let request = Task { @MainActor [weak self] in
            guard let self else { throw APIError(statusCode: 0, message: "API client unavailable") }
            defer { if self.sessionRevision == revision { self.subscriptionRequest = nil } }
            let podcasts = try await self.fetchSubscriptions()
            self.subscriptionCache.store(podcasts, key: key)
            return podcasts
        }
        subscriptionRequest = request
        return try await request.value
    }

    public func subscribe(podcastID: Int) async throws {
        let _: RawSuccess = try await post(path: "/api/subscriptions", body: ["podcastId": podcastID])
        feedCache.markSubscribed(id: podcastID)
        if let currentUserID { subscriptionCache.remove(currentUserID) }
    }

    public func unsubscribe(podcastID: Int) async throws {
        let _: RawSuccess = try await delete(path: "/api/subscriptions", query: [URLQueryItem(name: "podcastId", value: String(podcastID))])
        feedCache.removeSubscription(id: podcastID)
        if let currentUserID { subscriptionCache.remove(currentUserID) }
    }

    public func importSubscriptions(feeds: [String]) async throws -> SubscriptionImportResult {
        let result: SubscriptionImportResult = try await post(path: "/api/subscriptions", body: ["feedUrls": feeds])
        if let currentUserID { subscriptionCache.remove(currentUserID) }
        return result
    }

    public func currentProgress() async throws -> PlaybackProgress? {
        let raw: RawProgress? = try await get(path: "/api/progress")
        guard let raw else { return nil }
        return PlaybackProgress(episode: mapEpisode(raw.episode), position: raw.position)
    }

    public func saveProgress(episodeID: Int, position: Double, completed: Bool) async throws {
        let _: RawSuccess = try await put(path: "/api/progress", body: ProgressBody(episodeId: episodeID, position: Int(position.rounded(.towardZero)), completed: completed))
    }

    private func get<T: Decodable>(path: String, query: [URLQueryItem] = []) async throws -> T {
        try await request(method: "GET", path: path, query: query, body: Optional<EmptyBody>.none)
    }

    private func post<T: Decodable, B: Encodable>(path: String, body: B) async throws -> T {
        try await request(method: "POST", path: path, query: [], body: body)
    }

    private func put<T: Decodable, B: Encodable>(path: String, body: B) async throws -> T {
        try await request(method: "PUT", path: path, query: [], body: body)
    }

    private func delete<T: Decodable>(path: String, query: [URLQueryItem]) async throws -> T {
        try await request(method: "DELETE", path: path, query: query, body: Optional<EmptyBody>.none)
    }

    private func request<T: Decodable, B: Encodable>(method: String, path: String, query: [URLQueryItem], body: B?) async throws -> T {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)
        components?.queryItems = query.isEmpty ? nil : query
        guard let url = components?.url else { throw APIError(statusCode: 0, message: "Invalid API URL") }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let revision = sessionRevision
        let cookie = sessionCookie
        if let cookie { request.setValue("session=\(cookie)", forHTTPHeaderField: "Cookie") }

        let (data, response) = try await session.data(for: request)
        guard revision == sessionRevision else { throw CancellationError() }
        guard let http = response as? HTTPURLResponse else { throw APIError(statusCode: 0, message: "Invalid API response") }
        persistCookie(from: http)
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(RawError.self, from: data).message) ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            throw APIError(statusCode: http.statusCode, message: message)
        }
        if data.isEmpty { return try JSONDecoder().decode(T.self, from: Data("{}".utf8)) }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw APIError(statusCode: http.statusCode, message: "Invalid API response") }
    }

    private func persistCookie(from response: HTTPURLResponse) {
        guard let value = response.allHeaderFields.first(where: { key, _ in
            String(describing: key).caseInsensitiveCompare("Set-Cookie") == .orderedSame
        }).map({ String(describing: $0.value) }) else { return }
        guard let pair = value.split(separator: ";", maxSplits: 1).first, pair.starts(with: "session=") else { return }
        let cookie = String(pair.dropFirst("session=".count))
        sessionCookie = cookie
        keychain.write(cookie)
    }

    private func date(_ milliseconds: Double?) -> Date? {
        guard let milliseconds else { return nil }
        return Date(timeIntervalSince1970: milliseconds / 1000)
    }

    private func mapPodcast(_ raw: RawPodcast, feedFallback: String? = nil) -> Podcast {
        let feed = raw.feed ?? raw.feedUrl ?? feedFallback ?? ""
        feedCache.identify(id: raw.id, feed: feed)
        return Podcast(id: raw.id, feed: feed, title: raw.title, author: raw.author, cover: raw.cover, thumbnail: raw.thumbnail ?? raw.cover, description: raw.description ?? "", link: raw.link, published: date(raw.published), explicit: raw.explicit.value, keywords: raw.keywords ?? [], episodeCount: raw.episodeCount ?? raw.count ?? raw.episodes?.count ?? 0, episodes: raw.episodes?.map { mapEpisode($0, podcastId: raw.id, feedFallback: feed, coverFallback: raw.cover, titleFallback: raw.title) } ?? [])
    }

    private func mapEpisode(_ raw: RawEpisode, podcastId: Int? = nil, feedFallback: String? = nil, coverFallback: String? = nil, titleFallback: String? = nil) -> Episode {
        Episode(id: raw.id, podcastId: raw.podcastId ?? podcastId, guid: raw.guid, feed: raw.feed ?? feedFallback ?? "", podcastTitle: raw.podcastTitle ?? titleFallback, title: raw.title, summary: raw.summary, published: date(raw.published), cover: raw.cover ?? coverFallback ?? "", explicit: raw.explicit, duration: raw.duration, link: raw.link, episodeArt: raw.episodeArt, showNotes: raw.showNotes ?? raw.summary ?? "", author: raw.author, file: EpisodeFile(url: raw.file?.url ?? "", length: raw.file?.length ?? 0, type: raw.file?.type ?? "audio/mpeg"))
    }
}

@MainActor
@Observable
final class FeedCache {
    enum Key: Hashable {
        case id(Int)
        case feed(String)
    }

    private struct Entry {
        var podcast: Podcast
        var expires: Date
        var lastAccess: Date
        var persistent: Bool
        var complete: Bool
    }

    private struct Pending {
        var sequence: Int
        var refreshing: Bool
        var task: Task<Podcast, Error>
    }

    private struct StoredEntry: Codable {
        var id: Int?
        var feed: String
        var podcast: Podcast
        var expires: Date
        var lastAccess: Date
        var complete: Bool
    }

    private var entries: [Key: Entry] = [:]
    private var feedIDs: [String: Int] = [:]
    private var persistentIDs: Set<Int> = []
    @ObservationIgnored private var pending: [Key: Pending] = [:]
    @ObservationIgnored private var sequence = 0
    private let lifetime: TimeInterval
    private let persistentLifetime: TimeInterval
    private let capacity: Int
    private let now: () -> Date
    private let storageURL: URL?

    init(lifetime: TimeInterval = 300, persistentLifetime: TimeInterval = 7 * 24 * 60 * 60, capacity: Int = 40, now: @escaping () -> Date = Date.init, storageURL: URL? = nil) {
        self.lifetime = lifetime
        self.persistentLifetime = persistentLifetime
        self.capacity = max(1, capacity)
        self.now = now
        self.storageURL = storageURL
        restore()
    }

    static func defaultStorageURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("Podcst", isDirectory: true).appendingPathComponent("feed-cache.json")
    }

    func cached(id: Int?, feed: String) -> Podcast? {
        if let id, let podcast = entries[key(.id(id))]?.podcast {
            return podcast
        }
        return entries[key(.feed(feed))]?.podcast
    }

    func clear() {
        pending.values.forEach { $0.task.cancel() }
        pending.removeAll(keepingCapacity: false)
        entries.removeAll(keepingCapacity: false)
        feedIDs.removeAll(keepingCapacity: false)
        persistentIDs.removeAll(keepingCapacity: false)
        if let storageURL { try? FileManager.default.removeItem(at: storageURL) }
    }

    func markSubscribed(_ podcasts: [Podcast]) {
        for podcast in podcasts {
            markSubscribed(podcast)
        }
        persist()
    }

    func markSubscribed(id: Int) {
        persistentIDs.insert(id)
        if var entry = entries[.id(id)] {
            entry.persistent = true
            entry.expires = max(entry.expires, now().addingTimeInterval(persistentLifetime))
            entries[.id(id)] = entry
        }
        persist()
    }

    func removeSubscription(id: Int) {
        persistentIDs.remove(id)
        if var entry = entries[.id(id)] {
            entry.persistent = false
            entry.expires = now().addingTimeInterval(lifetime)
            entries[.id(id)] = entry
        }
        persist()
    }

    func identify(id: Int?, feed: String) {
        guard let id, !feed.isEmpty else { return }
        feedIDs[feed] = id
        let original = Key.feed(feed)
        let resolved = Key.id(id)
        if let entry = entries.removeValue(forKey: original), entry.expires > (entries[resolved]?.expires ?? .distantPast) {
            entries[resolved] = entry
        }
    }

    func load(_ requestedKey: Key, refreshing: Bool = false, fetch: @escaping @MainActor () async throws -> Podcast) async throws -> Podcast {
        let resolved = key(requestedKey)
        if !refreshing, var entry = entries[resolved] {
            let usable = entry.expires > now() && (!entry.persistent || entry.complete)
            if usable {
                entry.lastAccess = now()
                entries[resolved] = entry
                return entry.podcast
            }
        }
        if let request = pending[resolved], !refreshing || request.refreshing {
            return try await request.task.value
        }
        sequence += 1
        let requestSequence = sequence
        let task = Task { try await fetch() }
        pending[resolved] = Pending(sequence: requestSequence, refreshing: refreshing, task: task)
        do {
            let podcast = try await task.value
            identify(id: podcast.id, feed: podcast.feed)
            let destination = key(requestedKey)
            if pending[resolved]?.sequence == requestSequence {
                let date = now()
                let persistent = entries[resolved]?.persistent ?? podcast.id.map { persistentIDs.contains($0) } ?? false
                entries[destination] = Entry(
                    podcast: podcast,
                    expires: date.addingTimeInterval(persistent ? persistentLifetime : lifetime),
                    lastAccess: date,
                    persistent: persistent,
                    complete: true
                )
                pending[resolved] = nil
                evictIfNeeded()
                persist()
            }
            return podcast
        } catch {
            if pending[resolved]?.sequence == requestSequence {
                pending[resolved] = nil
            }
            if !refreshing, let stale = entries[resolved]?.podcast {
                return stale
            }
            throw error
        }
    }

    private func markSubscribed(_ podcast: Podcast) {
        guard let id = podcast.id else { return }
        persistentIDs.insert(id)
        identify(id: id, feed: podcast.feed)
        let key = Key.id(id)
        if var entry = entries[key] {
            entry.persistent = true
            entry.expires = max(entry.expires, now().addingTimeInterval(persistentLifetime))
            if !entry.complete { entry.podcast = podcast }
            entries[key] = entry
        } else {
            let date = now()
            entries[key] = Entry(podcast: podcast, expires: date.addingTimeInterval(persistentLifetime), lastAccess: date, persistent: true, complete: false)
        }
    }

    private func key(_ requested: Key) -> Key {
        if case .feed(let feed) = requested, let id = feedIDs[feed] {
            return .id(id)
        }
        return requested
    }

    private func evictIfNeeded() {
        while entries.count > capacity {
            guard let oldest = entries.filter({ !$0.value.persistent }).min(by: { $0.value.lastAccess < $1.value.lastAccess })?.key else { return }
            entries[oldest] = nil
        }
    }

    private func restore() {
        guard let storageURL, let data = try? Data(contentsOf: storageURL), let stored = try? JSONDecoder().decode([StoredEntry].self, from: data) else { return }
        for item in stored {
            let key: Key
            if let id = item.id {
                key = .id(id)
                persistentIDs.insert(id)
                feedIDs[item.feed] = id
            } else {
                key = .feed(item.feed)
            }
            entries[key] = Entry(podcast: item.podcast, expires: item.expires, lastAccess: item.lastAccess, persistent: true, complete: item.complete)
        }
        evictIfNeeded()
    }

    private func persist() {
        guard let storageURL else { return }
        let stored = entries.compactMap { key, entry -> StoredEntry? in
            guard entry.persistent else { return nil }
            let id: Int?
            let feed: String
            switch key {
            case .id(let value):
                id = value
                feed = entry.podcast.feed
            case .feed(let value):
                id = nil
                feed = value
            }
            return StoredEntry(id: id, feed: feed, podcast: entry.podcast, expires: entry.expires, lastAccess: entry.lastAccess, complete: entry.complete)
        }
        guard let data = try? JSONEncoder().encode(stored) else { return }
        do {
            try FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: storageURL, options: [.atomic])
        } catch {
            return
        }
    }
}

@MainActor
final class PodcastSnapshotCache {
    struct Snapshot {
        let value: [Podcast]
        let isStale: Bool
    }

    private struct Stored: Codable {
        var value: [Podcast]
        var storedAt: Date
    }

    private let namespace: String
    private let lifetime: TimeInterval
    private let defaults: UserDefaults

    init(namespace: String, lifetime: TimeInterval, defaults: UserDefaults = .standard) {
        self.namespace = namespace
        self.lifetime = lifetime
        self.defaults = defaults
    }

    func load(_ key: String) -> Snapshot? {
        guard let data = defaults.data(forKey: storageKey(key)), let stored = try? JSONDecoder().decode(Stored.self, from: data) else { return nil }
        return Snapshot(value: stored.value, isStale: Date().timeIntervalSince(stored.storedAt) >= lifetime)
    }

    func store(_ value: [Podcast], key: String) {
        guard let data = try? JSONEncoder().encode(Stored(value: value, storedAt: Date())) else { return }
        defaults.set(data, forKey: storageKey(key))
    }

    func remove(_ key: String) {
        defaults.removeObject(forKey: storageKey(key))
    }

    func removeAll() {
        defaults.dictionaryRepresentation().keys.filter { $0.hasPrefix(namespace + ".") }.forEach(defaults.removeObject(forKey:))
    }

    private func storageKey(_ key: String) -> String { namespace + "." + key }
}

@MainActor
public protocol SessionCredentialStore {
    func read() -> String?
    func write(_ value: String)
    func delete()
}

public struct KeychainStore: SessionCredentialStore, Sendable {
    private let service: String
    private let account: String

    public init(service: String = "app.podcst.ios", account: String = "session") {
        self.service = service
        self.account = account
    }

    public func read() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func write(_ value: String) {
        let data = Data(value.utf8)
        SecItemDelete(baseQuery as CFDictionary)
        var query = baseQuery
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(query as CFDictionary, nil)
    }

    public func delete() {
        SecItemDelete(baseQuery as CFDictionary)
    }

    private var baseQuery: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] }
}

private struct EmptyBody: Encodable {}
private struct ProgressBody: Encodable { var episodeId: Int; var position: Int; var completed: Bool }
private struct PasskeyLoginBody: Encodable {
    var email: String?
    var visitorId: String
    var discoverable: Bool
}
private struct PasskeyLoginVerification: Encodable {
    var response: PasskeyAssertion
    var userId: String?
    var visitorId: String
}
private struct RawError: Decodable { var message: String? }
private struct RawSuccess: Decodable { var success: Bool }
private struct RawSent: Decodable { var sent: Bool }
private struct RawVerified: Decodable { var verified: Bool }
private struct RawPasskeyResult: Decodable { var verified: Bool }
private struct RawPasskeyLogin: Decodable {
    var exists: Bool?
    var hasPasskey: Bool?
    var options: RawPasskeyOptions?
    var userId: String?
}
private struct RawPasskeyOptions: Decodable {
    var challenge: String
    var rpId: String?
    var allowCredentials: [RawPasskeyDescriptor]?
}
private struct RawPasskeyDescriptor: Decodable { var id: String }
private struct RawSession: Decodable { var user: RawUser? }
private struct RawUser: Decodable { var id: String; var email: String; var name: String?; var image: String?; var hasPasskey: Bool }
private struct RawSearchResult: Decodable { var author: String; var feed: String; var thumbnail: String; var title: String }
private struct RawEpisodePage: Decodable { var episodes: [RawEpisode]; var total: Int; var hasMore: Bool; var nextCursor: Int? }
private struct RawProgress: Decodable { var episode: RawEpisode; var position: Double }
private struct RawPodcastInfo: Decodable { var id: Int; var feed: String; var title: String; var author: String; var cover: String; var description: String; var link: String?; var published: Double?; var explicit: BoolOrString; var keywords: [String]; var episodeCount: Int }

private struct RawPodcast: Decodable {
    var id: Int?
    var itunesId: Int?
    var feed: String?
    var feedUrl: String?
    var title: String
    var author: String
    var cover: String
    var thumbnail: String?
    var description: String?
    var link: String?
    var published: Double?
    var explicit: BoolOrString
    var keywords: [String]?
    var episodeCount: Int?
    var count: Int?
    var episodes: [RawEpisode]?

    enum CodingKeys: String, CodingKey { case id, itunesId = "itunes_id", feed, feedUrl = "feed_url", title, author, cover, thumbnail, description, link, published, explicit, keywords, episodeCount, count, episodes }
}

private struct RawEpisode: Decodable {
    var id: Int?
    var podcastId: Int?
    var guid: String
    var feed: String?
    var podcastTitle: String?
    var title: String
    var summary: String?
    var published: Double?
    var cover: String?
    var explicit: Bool
    var duration: Double?
    var link: String?
    var episodeArt: String?
    var showNotes: String?
    var author: String?
    var file: RawFile?

    enum CodingKeys: String, CodingKey { case id, podcastId, guid, feed, podcastTitle, title, summary, published, cover, explicit, duration, link, episodeArt, showNotes, author, file }
}

private struct RawFile: Decodable { var url: String?; var length: Int64?; var type: String? }

private struct BoolOrString: Decodable {
    var value: Bool
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let bool = try? c.decode(Bool.self) { value = bool; return }
        let string = try c.decode(String.self)
        value = string == "explicit"
    }
}

private struct PasskeyAssertion: Encodable, Sendable {
    var id: String
    var rawId: String
    var response: PasskeyAssertionResponse
    var type = "public-key"
}

private struct PasskeyAssertionResponse: Encodable, Sendable {
    var clientDataJSON: String
    var authenticatorData: String
    var signature: String
    var userHandle: String?
}

@MainActor
private final class PasskeyAuthorizationCoordinator: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    let continuation: CheckedContinuation<PasskeyAssertion, Error>
    var controller: ASAuthorizationController?

    init(continuation: CheckedContinuation<PasskeyAssertion, Error>) {
        self.continuation = continuation
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow) ?? UIWindow()
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            continuation.resume(throwing: APIError(statusCode: 400, message: "Unsupported passkey credential"))
            return
        }
        continuation.resume(returning: PasskeyAssertion(
            id: credential.credentialID.base64URL,
            rawId: credential.credentialID.base64URL,
            response: PasskeyAssertionResponse(
                clientDataJSON: credential.rawClientDataJSON.base64URL,
                authenticatorData: credential.rawAuthenticatorData.base64URL,
                signature: credential.signature.base64URL,
                userHandle: credential.userID.isEmpty ? nil : credential.userID.base64URL
            )
        ))
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        if let authorizationError = error as? ASAuthorizationError, authorizationError.code == .canceled {
            continuation.resume(throwing: APIError(statusCode: 499, message: "Passkey sign-in was canceled"))
        } else {
            continuation.resume(throwing: error)
        }
    }
}

private extension Data {
    init?(base64URL value: String) {
        var encoded = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        self.init(base64Encoded: encoded)
    }

    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
