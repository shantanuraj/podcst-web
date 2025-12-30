import Foundation

enum Configuration {
    static let apiBaseURL: URL = {
        #if DEBUG
        URL(string: "http://localhost:3000")!
        #else
        URL(string: "https://podcst.fly.dev")!
        #endif
    }()

    static let defaultLocale: String = {
        Locale.current.region?.identifier.lowercased() ?? "us"
    }()
}
