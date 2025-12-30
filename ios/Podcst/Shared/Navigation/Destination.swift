import Foundation

enum Destination: Hashable {
    case podcast(Int)
    case episode(podcastId: Int, episodeId: Int)
    case search
    case library
    case downloads
    case settings
    case auth
}
