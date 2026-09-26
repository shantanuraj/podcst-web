import AuthenticationServices
import Foundation
import Observation
import Security

@MainActor
@Observable
public final class APIClient {
    public nonisolated static let productionBaseURL = URL(string: "https://www.podcst.app")!

    private let baseURL: URL
    private let session: URLSession
    private let visitorId: String
    private var sessionCookie: String?
    private let keychain: KeychainStore

    public init(baseURL: URL = APIClient.productionBaseURL, session: URLSession = .shared, keychain: KeychainStore = KeychainStore()) {
        self.baseURL = baseURL
        self.session = session
        self.keychain = keychain
        self.visitorId = UUID().uuidString
        self.sessionCookie = keychain.read()
    }

    public func top(locale: String = "us", limit: Int = 30) async throws -> [Podcast] {
        let rows: [RawPodcast] = try await get(path: "/api/top", query: [URLQueryItem(name: "limit", value: String(limit)), URLQueryItem(name: "locale", value: locale)])
        return rows.map { mapPodcast($0) }
    }

    public func search(term: String, locale: String = "us") async throws -> [SearchResult] {
        let rows: [RawSearchResult] = try await get(path: "/api/search", query: [URLQueryItem(name: "term", value: term), URLQueryItem(name: "locale", value: locale)])
        return rows.map { SearchResult(id: $0.id, author: $0.author, feed: $0.feed, thumbnail: $0.thumbnail, title: $0.title) }
    }

    public func podcast(feed: String) async throws -> Podcast {
        let raw: RawPodcast = try await get(path: "/api/feed", query: [URLQueryItem(name: "url", value: feed)])
        return mapPodcast(raw, feedFallback: feed)
    }

    public func podcast(id: Int) async throws -> Podcast {
        let raw: RawPodcast = try await get(path: "/api/feed", query: [URLQueryItem(name: "id", value: String(id))])
        return mapPodcast(raw)
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

    public func refresh(podcastID: Int) async throws -> Podcast {
        let raw: RawPodcast = try await post(path: "/api/feed/refresh", body: ["podcastId": podcastID])
        return mapPodcast(raw)
    }

    public func sessionUser() async throws -> User? {
        let raw: RawSession = try await get(path: "/api/auth/session")
        guard let user = raw.user else { return nil }
        return User(id: user.id, email: user.email, name: user.name, image: user.image, hasPasskey: user.hasPasskey)
    }

    public func sendCode(email: String) async throws {
        let _: RawSent = try await post(path: "/api/auth/verify", body: ["email": email])
    }

    public func signIn(email: String, code: String) async throws -> User? {
        let _: RawVerified = try await post(path: "/api/auth/email-login", body: ["email": email, "code": code])
        return try await sessionUser()
    }

    public func signInWithPasskey(email: String? = nil) async throws -> User? {
        throw APIError(statusCode: 501, message: "Passkey sign-in is not configured for this client")
    }

    public func registerPasskey() async throws {
        throw APIError(statusCode: 501, message: "Passkey registration is not configured for this client")
    }

    public func signOut() async throws {
        let _: RawSuccess = try await post(path: "/api/auth/logout", body: EmptyBody())
        sessionCookie = nil
        keychain.delete()
    }

    public func subscriptions() async throws -> [Podcast] {
        let rows: [RawPodcast] = try await get(path: "/api/subscriptions")
        return rows.map { mapPodcast($0) }
    }

    public func subscribe(podcastID: Int) async throws {
        let _: RawSuccess = try await post(path: "/api/subscriptions", body: ["podcastId": podcastID])
    }

    public func unsubscribe(podcastID: Int) async throws {
        let _: RawSuccess = try await delete(path: "/api/subscriptions", query: [URLQueryItem(name: "podcastId", value: String(podcastID))])
    }

    public func importSubscriptions(feeds: [String]) async throws -> SubscriptionImportResult {
        try await post(path: "/api/subscriptions", body: ["feedUrls": feeds])
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
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let cookie = sessionCookie
        if let cookie { request.setValue("session=\(cookie)", forHTTPHeaderField: "Cookie") }

        let (data, response) = try await session.data(for: request)
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
        let feed = raw.feed ?? feedFallback ?? ""
        return Podcast(id: raw.id, feed: feed, title: raw.title, author: raw.author, cover: raw.cover, thumbnail: raw.thumbnail ?? raw.cover, description: raw.description ?? "", link: raw.link, published: date(raw.published), explicit: raw.explicit.value, keywords: raw.keywords ?? [], episodeCount: raw.episodeCount ?? raw.count ?? raw.episodes?.count ?? 0, episodes: raw.episodes?.map { mapEpisode($0, podcastId: raw.id, feedFallback: feed, coverFallback: raw.cover, titleFallback: raw.title) } ?? [])
    }

    private func mapEpisode(_ raw: RawEpisode, podcastId: Int? = nil, feedFallback: String? = nil, coverFallback: String? = nil, titleFallback: String? = nil) -> Episode {
        Episode(id: raw.id, podcastId: raw.podcastId ?? podcastId, guid: raw.guid, feed: raw.feed ?? feedFallback ?? "", podcastTitle: raw.podcastTitle ?? titleFallback, title: raw.title, summary: raw.summary, published: date(raw.published), cover: raw.cover ?? coverFallback ?? "", explicit: raw.explicit, duration: raw.duration, link: raw.link, episodeArt: raw.episodeArt, showNotes: raw.showNotes ?? raw.summary ?? "", author: raw.author, file: EpisodeFile(url: raw.file?.url ?? "", length: raw.file?.length ?? 0, type: raw.file?.type ?? "audio/mpeg"))
    }
}

public struct KeychainStore: Sendable {
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
private struct RawError: Decodable { var message: String? }
private struct RawSuccess: Decodable { var success: Bool }
private struct RawSent: Decodable { var sent: Bool }
private struct RawVerified: Decodable { var verified: Bool }
private struct RawSession: Decodable { var user: RawUser? }
private struct RawUser: Decodable { var id: String; var email: String; var name: String?; var image: String?; var hasPasskey: Bool }
private struct RawSearchResult: Decodable { var id: Int?; var author: String; var feed: String; var thumbnail: String; var title: String }
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
