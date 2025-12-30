import Foundation

enum APIError: Error, Sendable {
    case invalidURL
    case requestFailed(statusCode: Int)
    case decodingFailed(Error)
    case networkError(Error)
    case unauthorized
    case notFound
}

actor APIClient {
    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder

    init(baseURL: URL) {
        self.baseURL = baseURL

        let config = URLSessionConfiguration.default
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        config.httpCookieStorage = .shared
        self.session = URLSession(configuration: config)

        self.decoder = JSONDecoder()
    }

    func request<T: Decodable>(_ endpoint: Endpoint) async throws -> T {
        let request = try buildRequest(for: endpoint)
        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.requestFailed(statusCode: 0)
        }

        switch httpResponse.statusCode {
        case 200..<300:
            do {
                return try decoder.decode(T.self, from: data)
            } catch {
                throw APIError.decodingFailed(error)
            }
        case 401:
            throw APIError.unauthorized
        case 404:
            throw APIError.notFound
        default:
            throw APIError.requestFailed(statusCode: httpResponse.statusCode)
        }
    }

    func requestVoid(_ endpoint: Endpoint) async throws {
        let request = try buildRequest(for: endpoint)
        let (_, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.requestFailed(statusCode: 0)
        }

        switch httpResponse.statusCode {
        case 200..<300:
            return
        case 401:
            throw APIError.unauthorized
        case 404:
            throw APIError.notFound
        default:
            throw APIError.requestFailed(statusCode: httpResponse.statusCode)
        }
    }

    private func buildRequest(for endpoint: Endpoint) throws -> URLRequest {
        var components = URLComponents(url: baseURL.appendingPathComponent(endpoint.path), resolvingAgainstBaseURL: true)
        components?.queryItems = endpoint.queryItems

        guard let url = components?.url else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = endpoint.method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if let body = endpoint.body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        return request
    }
}

extension APIClient {
    func fetchTopPodcasts(limit: Int = 50, locale: String = "us") async throws -> [Podcast] {
        try await request(.top(limit: limit, locale: locale))
    }

    func searchPodcasts(term: String, locale: String = "us") async throws -> [PodcastSearchResult] {
        try await request(.search(term: term, locale: locale))
    }

    func fetchPodcast(id: Int) async throws -> PodcastWithEpisodes {
        try await request(.feed(id: id))
    }

    func fetchPodcastInfo(id: Int) async throws -> PodcastInfo {
        try await request(.feedInfo(id: id))
    }

    func fetchEpisodes(
        podcastId: Int,
        limit: Int = 20,
        cursor: Int? = nil,
        search: String? = nil,
        sortBy: String = "published",
        sortDir: String = "desc"
    ) async throws -> PaginatedEpisodes {
        try await request(.episodes(
            podcastId: podcastId,
            limit: limit,
            cursor: cursor,
            search: search,
            sortBy: sortBy,
            sortDir: sortDir
        ))
    }

    func fetchSubscriptions() async throws -> [PodcastWithEpisodes] {
        try await request(.subscriptions)
    }

    func subscribe(podcastId: Int) async throws {
        let _: SuccessResponse = try await request(.addSubscription(podcastId: podcastId))
    }

    func unsubscribe(podcastId: Int) async throws {
        let _: SuccessResponse = try await request(.removeSubscription(podcastId: podcastId))
    }

    func fetchProgress() async throws -> PlaybackProgress? {
        try await request(.progress)
    }

    func saveProgress(episodeId: Int, position: Int, completed: Bool) async throws {
        let _: SuccessResponse = try await request(.updateProgress(
            episodeId: episodeId,
            position: position,
            completed: completed
        ))
    }

    func sendVerificationCode(email: String) async throws {
        let _: VerifyResponse = try await request(.sendVerificationCode(email: email))
    }

    func verifyCode(email: String, code: String) async throws -> Bool {
        let response: VerifyResponse = try await request(.verifyCode(email: email, code: code))
        return response.verified ?? false
    }

    func emailLogin(email: String, code: String) async throws -> Bool {
        let response: VerifyResponse = try await request(.emailLogin(email: email, code: code))
        return response.verified ?? false
    }

    func fetchSession() async throws -> User? {
        let response: SessionResponse = try await request(.session)
        return response.user
    }

    func logout() async throws {
        try await requestVoid(.logout)
    }
}
