import Foundation

enum Endpoint {
    case top(limit: Int, locale: String)
    case search(term: String, locale: String)
    case feed(id: Int)
    case feedByURL(url: String)
    case feedInfo(id: Int)
    case episodes(podcastId: Int, limit: Int, cursor: Int?, search: String?, sortBy: String, sortDir: String)

    case subscriptions
    case addSubscription(podcastId: Int)
    case removeSubscription(podcastId: Int)

    case progress
    case updateProgress(episodeId: Int, position: Int, completed: Bool)

    case sendVerificationCode(email: String)
    case verifyCode(email: String, code: String)
    case emailLogin(email: String, code: String)
    case session
    case logout

    var path: String {
        switch self {
        case .top: "/api/top"
        case .search: "/api/search"
        case .feed, .feedByURL: "/api/feed"
        case .feedInfo: "/api/feed/info"
        case .episodes: "/api/feed/episodes"
        case .subscriptions, .addSubscription, .removeSubscription: "/api/subscriptions"
        case .progress, .updateProgress: "/api/progress"
        case .sendVerificationCode, .verifyCode: "/api/auth/verify"
        case .emailLogin: "/api/auth/email-login"
        case .session: "/api/auth/session"
        case .logout: "/api/auth/logout"
        }
    }

    var method: HTTPMethod {
        switch self {
        case .top, .search, .feed, .feedByURL, .feedInfo, .episodes, .subscriptions, .progress, .session:
            .get
        case .addSubscription, .sendVerificationCode, .verifyCode, .emailLogin, .logout:
            .post
        case .updateProgress:
            .put
        case .removeSubscription:
            .delete
        }
    }

    var queryItems: [URLQueryItem]? {
        switch self {
        case .top(let limit, let locale):
            return [URLQueryItem(name: "limit", value: String(limit)),
                    URLQueryItem(name: "locale", value: locale)]

        case .search(let term, let locale):
            return [URLQueryItem(name: "term", value: term),
                    URLQueryItem(name: "locale", value: locale)]

        case .feed(let id):
            return [URLQueryItem(name: "id", value: String(id))]

        case .feedByURL(let url):
            return [URLQueryItem(name: "url", value: url)]

        case .feedInfo(let id):
            return [URLQueryItem(name: "id", value: String(id))]

        case .episodes(let podcastId, let limit, let cursor, let search, let sortBy, let sortDir):
            var items = [
                URLQueryItem(name: "podcastId", value: String(podcastId)),
                URLQueryItem(name: "limit", value: String(limit)),
                URLQueryItem(name: "sortBy", value: sortBy),
                URLQueryItem(name: "sortDir", value: sortDir)
            ]
            if let cursor { items.append(URLQueryItem(name: "cursor", value: String(cursor))) }
            if let search, !search.isEmpty { items.append(URLQueryItem(name: "search", value: search)) }
            return items

        case .removeSubscription(let podcastId):
            return [URLQueryItem(name: "podcastId", value: String(podcastId))]

        default:
            return nil
        }
    }

    var body: Encodable? {
        switch self {
        case .addSubscription(let podcastId):
            ["podcastId": podcastId]

        case .updateProgress(let episodeId, let position, let completed):
            UpdateProgressBody(episodeId: episodeId, position: position, completed: completed)

        case .sendVerificationCode(let email):
            ["email": email]

        case .verifyCode(let email, let code):
            ["email": email, "code": code]

        case .emailLogin(let email, let code):
            ["email": email, "code": code]

        default:
            nil
        }
    }
}

struct UpdateProgressBody: Encodable {
    let episodeId: Int
    let position: Int
    let completed: Bool
}

enum HTTPMethod: String {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case delete = "DELETE"
}
