import Foundation
import Observation

struct Star: Codable, Hashable, Sendable {
    var episode: Episode
    var starredAt: Date
}

@MainActor
@Observable
final class StarStore {
    private(set) var stars: [Star]
    private(set) var accountID: String?
    @ObservationIgnored private let directory: URL
    @ObservationIgnored private let now: () -> Date

    init(accountID: String? = nil, directory: URL? = nil, now: @escaping () -> Date = Date.init) {
        let directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Podcst/Stars", isDirectory: true)
        self.accountID = accountID
        self.directory = directory
        self.now = now
        stars = Self.load(Self.storageURL(in: directory, for: accountID))
    }

    var episodes: [Episode] { stars.map(\.episode) }

    func contains(_ episode: Episode) -> Bool {
        stars.contains { $0.episode.identity == episode.identity }
    }

    func star(_ episode: Episode) {
        if let index = stars.firstIndex(where: { $0.episode.identity == episode.identity }) {
            stars[index].episode = episode
        } else {
            stars.insert(Star(episode: episode, starredAt: now()), at: 0)
        }
        persist()
    }

    func unstar(_ episode: Episode) {
        stars.removeAll { $0.episode.identity == episode.identity }
        persist()
    }

    func toggle(_ episode: Episode) {
        if contains(episode) { unstar(episode) } else { star(episode) }
    }

    func switchAccount(to accountID: String?) {
        guard self.accountID != accountID else { return }
        if self.accountID != nil { try? FileManager.default.removeItem(at: storageURL) }
        self.accountID = accountID
        stars = Self.load(storageURL)
    }

    private var storageURL: URL { Self.storageURL(in: directory, for: accountID) }

    private static func storageURL(in directory: URL, for accountID: String?) -> URL {
        directory.appendingPathComponent(MediaKey.scope(accountID) + ".json")
    }

    private static func load(_ url: URL) -> [Star] {
        guard let data = try? Data(contentsOf: url), let stars = try? JSONDecoder().decode([Star].self, from: data) else { return [] }
        return stars.sorted { $0.starredAt > $1.starredAt }
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(stars) else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: storageURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
