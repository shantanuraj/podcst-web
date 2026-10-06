import Foundation
import Observation

@MainActor
@Observable
public final class SessionStore {
    public private(set) var user: User?
    public private(set) var isLoading = true
    public private(set) var error: String?

    @ObservationIgnored var prepareAccountChange: ((String?) async throws -> Void)?
    @ObservationIgnored var suspendAccountWork: (() -> Void)?
    @ObservationIgnored var resumeAccountWork: (() -> Void)?
    private var changingSession = false
    private var restoration: (id: UUID, task: Task<Void, Never>)?
    private let storageURL: URL
    private let api: APIClient

    public init(api: APIClient, storageURL: URL? = nil) {
        self.api = api
        self.storageURL = storageURL ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Podcst/session.json")
        if api.hasSession, let data = try? Data(contentsOf: self.storageURL), let cached = try? JSONDecoder().decode(User.self, from: data) {
            user = cached
            api.restoreAccount(cached.id)
        }
    }

    private func updateUser(_ value: User?) async throws {
        if user?.id != value?.id {
            try? FileManager.default.removeItem(at: storageURL)
            try await prepareAccountChange?(value?.id)
        }
        user = value
        api.restoreAccount(value?.id)
        if let value, let data = try? JSONEncoder().encode(value) {
            try FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: storageURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            var file = storageURL
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try file.setResourceValues(values)
        } else {
            try? FileManager.default.removeItem(at: storageURL)
        }
    }

    public func restore() async {
        guard !changingSession else { return }
        if let restoration { await restoration.task.value; return }
        let id = UUID()
        isLoading = true
        let task = Task { [weak self] in
            guard let self else { return }
            defer {
                if self.restoration?.id == id { self.restoration = nil }
                if !self.changingSession { self.isLoading = false; self.resumeAccountWork?() }
            }
            do {
                let value = try await self.api.sessionUser()
                try Task.checkCancellation()
                try await self.updateUser(value)
                if self.user == nil { self.api.clearSession() }
                self.error = nil
            } catch let failure {
                guard !Task.isCancelled else { return }
                if let failure = failure as? APIError, [401, 403].contains(failure.statusCode) {
                    try? await self.updateUser(nil)
                    self.api.clearSession()
                }
                self.error = failure.localizedDescription
            }
        }
        restoration = (id, task)
        await task.value
    }

    private func cancelRestoration() async {
        guard let restoration else { return }
        restoration.task.cancel()
        api.beginAuthentication()
        await restoration.task.value
        self.restoration = nil
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
        guard !changingSession else { return }
        suspendAccountWork?()
        changingSession = true
        isLoading = true
        defer { changingSession = false; isLoading = false; resumeAccountWork?() }
        await cancelRestoration()
        do {
            try await updateUser(api.signIn(email: email, code: code))
            error = nil
        } catch let failure {
            error = failure.localizedDescription
        }
    }

    public func signInWithPasskey(email: String? = nil) async {
        guard !changingSession else { return }
        suspendAccountWork?()
        changingSession = true
        isLoading = true
        defer { changingSession = false; isLoading = false; resumeAccountWork?() }
        await cancelRestoration()
        do {
            try await updateUser(api.signInWithPasskey(email: email))
            error = nil
        } catch let failure {
            error = failure.localizedDescription
        }
    }

    public func registerPasskey() async {
        do {
            try await api.registerPasskey()
            try await updateUser(api.sessionUser())
            error = nil
        } catch let failure {
            error = failure.localizedDescription
        }
    }

    public func signOut() async {
        guard !changingSession else { return }
        suspendAccountWork?()
        changingSession = true
        isLoading = true
        defer { changingSession = false; isLoading = false; resumeAccountWork?() }
        await cancelRestoration()
        do {
            try await updateUser(nil)
            await api.signOut()
            error = nil
        } catch let failure {
            error = failure.localizedDescription
        }
    }
}
