import Foundation
import Observation

@MainActor
@Observable
public final class SessionStore {
    public private(set) var user: User?
    public private(set) var isLoading = true
    public private(set) var error: String?

    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func restore() async {
        isLoading = true
        defer { isLoading = false }
        do {
            user = try await api.sessionUser()
            error = nil
        } catch let failure {
            user = nil
            error = failure.localizedDescription
        }
    }

    public func sendCode(email: String) async {
        do {
            try await api.sendCode(email: email)
            error = nil
        } catch let failure {
            error = failure.localizedDescription
        }
    }

    public func signIn(email: String, code: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            user = try await api.signIn(email: email, code: code)
            error = nil
        } catch let failure {
            error = failure.localizedDescription
        }
    }

    public func signInWithPasskey(email: String? = nil) async {
        isLoading = true
        defer { isLoading = false }
        do {
            user = try await api.signInWithPasskey(email: email)
            error = nil
        } catch let failure {
            error = failure.localizedDescription
        }
    }

    public func registerPasskey() async {
        do {
            try await api.registerPasskey()
            user = try await api.sessionUser()
            error = nil
        } catch let failure {
            error = failure.localizedDescription
        }
    }

    public func signOut() async {
        do {
            try await api.signOut()
            user = nil
            error = nil
        } catch let failure {
            error = failure.localizedDescription
        }
    }
}
