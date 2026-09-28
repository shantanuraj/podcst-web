import SwiftUI

struct ArtworkRetention: ViewModifier {
    @Environment(LibraryStore.self) private var library
    @Environment(SessionStore.self) private var session
    @Environment(PlaybackController.self) private var playback
    @Environment(MediaStore.self) private var media
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        let snapshot = ArtworkRetentionSnapshot(
            accountID: session.user?.id,
            podcasts: library.podcasts,
            episodes: playback.queue + media.downloadedEpisodes + library.newReleases.prefix(3),
            isActive: scenePhase == .active
        )
        content.task(id: snapshot) {
            guard snapshot.isActive else { return }
            await ArtworkStore.shared.retain(snapshot.urls, accountID: snapshot.accountID)
        }
    }
}

struct ArtworkRetentionSnapshot: Hashable {
    let accountID: String?
    let urls: Set<URL>
    let isActive: Bool

    init(accountID: String?, podcasts: [Podcast], episodes: [Episode], isActive: Bool = true) {
        self.accountID = accountID
        self.isActive = isActive
        let episodeURLs = episodes.flatMap { [$0.artworkURL, URL(string: $0.cover)] }
        urls = Set((podcasts.map(\.artworkURL) + episodeURLs).compactMap { $0 }.filter { !$0.absoluteString.isEmpty })
    }
}
