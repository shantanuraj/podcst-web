import Foundation

struct PublicLink: Hashable, Sendable {
    enum Moment: Hashable, Sendable {
        case time(TimeInterval)
        case clip(TimeInterval, TimeInterval)
        case chapter(Int, TimeInterval, TimeInterval)

        var start: TimeInterval {
            switch self {
            case .time(let start), .clip(let start, _), .chapter(_, let start, _): start
            }
        }

        fileprivate var query: String? {
            switch self {
            case .time(let start):
                return PublicLink.second(start).map { "t=\(PublicLink.format($0))" }
            case .clip(let start, let end):
                return PublicLink.range(start, end)
            case .chapter(let chapter, let start, let end):
                guard (1...9999).contains(chapter), let range = PublicLink.range(start, end) else { return nil }
                return "ch=\(chapter)&\(range)"
            }
        }
    }

    static let origin = "https://www.podcst.app"
    static let maxSeconds = 604_800
    private static let hosts: Set<String> = ["podcst.app", "www.podcst.app"]

    var podcastId: Int
    var episodeId: Int? = nil
    var moment: Moment? = nil
    var invalidMoment = false

    var url: URL? {
        guard podcastId > 0 else { return nil }
        let show = "\(Self.origin)/episodes/\(podcastId)"
        guard let episodeId else { return moment == nil ? URL(string: show) : nil }
        guard episodeId > 0 else { return nil }
        let episode = "\(show)/\(episodeId)"
        guard let moment else { return URL(string: episode) }
        return moment.query.flatMap { URL(string: "\(episode)?\($0)") }
    }

    func with(_ moment: Moment?) -> PublicLink {
        PublicLink(podcastId: podcastId, episodeId: episodeId, moment: moment)
    }

    init(podcastId: Int, episodeId: Int? = nil, moment: Moment? = nil) {
        self.podcastId = podcastId
        self.episodeId = episodeId
        self.moment = moment
    }

    init?(_ url: URL) {
        guard url.scheme?.lowercased() == "https", let host = url.host()?.lowercased(), Self.hosts.contains(host),
              url.port == nil, url.user == nil, url.password == nil,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let segments = components.percentEncodedPath.split(separator: "/", omittingEmptySubsequences: false).dropFirst().map(String.init)
        guard (2...3).contains(segments.count), segments[0] == "episodes",
              let podcastId = try? StateID(segments[1]).number else { return nil }
        let episodeId = segments.count == 3 ? try? StateID(segments[2]).number : nil
        guard segments.count == 2 || episodeId != nil else { return nil }
        let items = components.queryItems ?? []
        let times = items.filter { $0.name == "t" }.map { $0.value ?? "" }
        let chapters = items.filter { $0.name == "ch" }.map { $0.value ?? "" }
        let requested = !times.isEmpty || !chapters.isEmpty
        self.podcastId = podcastId
        self.episodeId = episodeId
        moment = requested && episodeId != nil ? Self.moment(times: times, chapters: chapters) : nil
        invalidMoment = requested && moment == nil
    }

    static func format(_ seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = seconds % 3600 / 60
        let remainder = seconds % 60
        if hours > 0 { return String(format: "%dh%02dm%02ds", hours, minutes, remainder) }
        if minutes > 0 { return String(format: "%dm%02ds", minutes, remainder) }
        return "\(remainder)s"
    }

    static func seconds(_ token: String) -> Int? {
        guard !token.isEmpty, let match = token.wholeMatch(of: /(?:([0-9]{1,7})h)?(?:([0-9]{1,7})m)?(?:([0-9]{1,7})s)?/) else { return nil }
        let hours = match.1.flatMap { Int($0) }
        let minutes = match.2.flatMap { Int($0) }
        let seconds = match.3.flatMap { Int($0) }
        if hours != nil, let minutes, minutes >= 60 { return nil }
        if hours != nil || minutes != nil, let seconds, seconds >= 60 { return nil }
        let total = (hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0)
        return total <= maxSeconds ? total : nil
    }

    private static func second(_ value: TimeInterval) -> Int? {
        guard value.isFinite, value >= 0, value <= TimeInterval(maxSeconds) else { return nil }
        return Int(value.rounded(.down))
    }

    private static func range(_ start: TimeInterval, _ end: TimeInterval) -> String? {
        guard let start = second(start), let end = second(end), start < end else { return nil }
        return "t=\(format(start))-\(format(end))"
    }

    private static func moment(times: [String], chapters: [String]) -> Moment? {
        guard times.count == 1, chapters.count <= 1 else { return nil }
        let range = times[0].split(separator: "-", omittingEmptySubsequences: false).map(String.init)
        guard range.count <= 2, let start = seconds(range[0]) else { return nil }
        guard range.count == 2 else { return chapters.isEmpty ? .time(TimeInterval(start)) : nil }
        guard let end = seconds(range[1]), end > start else { return nil }
        guard let chapter = chapters.first else { return .clip(TimeInterval(start), TimeInterval(end)) }
        guard chapter.wholeMatch(of: /[1-9][0-9]{0,3}/) != nil, let number = Int(chapter) else { return nil }
        return .chapter(number, TimeInterval(start), TimeInterval(end))
    }
}

extension Podcast {
    var publicLink: PublicLink? {
        guard isPrivate != true, let id else { return nil }
        return PublicLink(podcastId: id)
    }
}

extension Episode {
    var publicLink: PublicLink? {
        guard isPrivate != true, let id, let podcastId else { return nil }
        return PublicLink(podcastId: podcastId, episodeId: id)
    }
}
