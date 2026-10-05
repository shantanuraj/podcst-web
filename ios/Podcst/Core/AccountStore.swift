import Foundation
import Observation

@MainActor
@Observable
final class AccountStore {
    private(set) var account: Account?
    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let preferences: AudioPreferences
    @ObservationIgnored private var accountID: String?
    @ObservationIgnored private var synced: AudioOptions?
    @ObservationIgnored private var pending = false

    init(api: APIClient, preferences: AudioPreferences) {
        self.api = api
        self.preferences = preferences
        observeDefaults()
    }

    func load(accountID: String?) async {
        if accountID != self.accountID {
            self.accountID = accountID
            account = nil
            synced = nil
            pending = false
        }
        guard let accountID, let account = try? await api.account(), current(accountID) else { return }
        self.account = account
        if let server = account.preferences, !pending {
            synced = server
            preferences.set(server)
        } else {
            try? await push(preferences.defaults)
        }
    }

    func removePasskey(_ passkey: Passkey) async throws {
        guard let accountID else { return }
        try await api.removePasskey(id: passkey.id)
        guard current(accountID) else { return }
        account?.passkeys.removeAll { $0.id == passkey.id }
    }

    private func push(_ defaults: AudioOptions) async throws {
        guard let accountID else { return }
        pending = true
        let saved = try await api.savePreferences(defaults)
        guard current(accountID) else { return }
        pending = false
        synced = saved
        account?.preferences = saved
    }

    private func current(_ accountID: String) -> Bool {
        self.accountID == accountID && api.accountID == accountID
    }

    private func observeDefaults() {
        withObservationTracking {
            _ = preferences.defaults
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.observeDefaults()
                guard let synced = self.synced, self.preferences.defaults != synced else { return }
                try? await self.push(self.preferences.defaults)
            }
        }
    }
}
