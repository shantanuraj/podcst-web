import Foundation
import SwiftData

@Observable
final class AppState {
    let apiClient: APIClient
    let audioService: AudioService
    let playerState: PlayerState
    let modelContext: ModelContext

    private(set) var currentUser: User?
    private(set) var isCheckingSession = true

    init(apiClient: APIClient, audioService: AudioService, modelContext: ModelContext) {
        self.apiClient = apiClient
        self.audioService = audioService
        self.modelContext = modelContext
        self.playerState = PlayerState(audioService: audioService, apiClient: apiClient)
    }

    func checkSession() async {
        isCheckingSession = true
        currentUser = try? await apiClient.fetchSession()
        isCheckingSession = false

        if currentUser != nil {
            await playerState.restoreProgress()
        }
    }

    func logout() async {
        try? await apiClient.logout()
        currentUser = nil
    }

    var isAuthenticated: Bool {
        currentUser != nil
    }
}
