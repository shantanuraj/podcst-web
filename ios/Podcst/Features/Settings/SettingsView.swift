import SwiftUI
import SwiftData

struct SettingsView: View {
    @State private var user: User?
    @State private var isCheckingSession = true
    @AppStorage("defaultPlaybackRate") private var defaultPlaybackRate: Double = 1.0
    @AppStorage("skipForwardInterval") private var skipForwardInterval: Int = 30
    @AppStorage("skipBackwardInterval") private var skipBackwardInterval: Int = 10
    @Query private var downloads: [DownloadedEpisode]

    private let apiClient = APIClient(baseURL: Configuration.apiBaseURL)

    private var totalStorageUsed: Int64 {
        downloads.reduce(0) { $0 + $1.fileSize }
    }

    var body: some View {
        Form {
            Section("Playback") {
                Picker("Default Speed", selection: $defaultPlaybackRate) {
                    ForEach([0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0], id: \.self) { rate in
                        Text("\(rate, specifier: "%.2f")x").tag(rate)
                    }
                }

                Stepper("Skip Forward: \(skipForwardInterval)s", value: $skipForwardInterval, in: 5...60, step: 5)
                Stepper("Skip Back: \(skipBackwardInterval)s", value: $skipBackwardInterval, in: 5...60, step: 5)
            }

            Section("Storage") {
                LabeledContent("Downloaded Episodes", value: "\(downloads.count)")
                LabeledContent("Storage Used", value: ByteCountFormatter.string(fromByteCount: totalStorageUsed, countStyle: .file))

                if !downloads.isEmpty {
                    Button("Clear All Downloads", role: .destructive) {
                    }
                }
            }

            Section("Account") {
                if isCheckingSession {
                    HStack {
                        Text("Checking session...")
                        Spacer()
                        ProgressView()
                    }
                } else if let user {
                    LabeledContent("Email", value: user.email)

                    if let name = user.name {
                        LabeledContent("Name", value: name)
                    }

                    Button("Sign Out", role: .destructive) {
                        Task { await signOut() }
                    }
                } else {
                    NavigationLink(value: Destination.auth) {
                        Text("Sign In")
                    }
                }
            }

            Section("About") {
                LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0")
            }
        }
        .navigationTitle("Settings")
        .task {
            await checkSession()
        }
    }

    private func checkSession() async {
        isCheckingSession = true
        user = try? await apiClient.fetchSession()
        isCheckingSession = false
    }

    private func signOut() async {
        try? await apiClient.logout()
        user = nil
    }
}
