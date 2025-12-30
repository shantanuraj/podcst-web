import Foundation

struct User: Codable, Sendable, Identifiable, Hashable {
    let id: String
    let email: String
    let name: String?
    let image: String?
}

struct SessionResponse: Codable, Sendable {
    let user: User?
}

struct VerifyResponse: Codable, Sendable {
    let sent: Bool?
    let verified: Bool?
}

struct SuccessResponse: Codable, Sendable {
    let success: Bool
}

struct ImportResponse: Codable, Sendable {
    let succeeded: Int
    let failed: Int
}
