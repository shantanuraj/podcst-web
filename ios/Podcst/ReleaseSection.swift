import Foundation

struct ReleaseSection: Identifiable {
    let date: Date?
    private(set) var episodes: [Episode]

    var id: Date? { date }

    static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }()

    static func grouping(_ episodes: [Episode]) -> [ReleaseSection] {
        var sections: [ReleaseSection] = []
        var indices: [Date?: Int] = [:]
        for episode in episodes {
            let date = episode.published.map { calendar.startOfDay(for: $0) }
            if let index = indices[date] {
                sections[index].episodes.append(episode)
            } else {
                indices[date] = sections.count
                sections.append(ReleaseSection(date: date, episodes: [episode]))
            }
        }
        return sections
    }

    func title(relativeTo now: Date, locale: Locale = .current) -> String {
        guard let date else { return String(localized: "Date unavailable", locale: locale) }
        switch age(relativeTo: now) {
        case 0:
            return String(localized: "Today", locale: locale)
        case 1:
            return String(localized: "Yesterday", locale: locale)
        case .some(2...6):
            return date.formatted(Date.FormatStyle(locale: locale, calendar: Self.calendar, timeZone: Self.calendar.timeZone).weekday(.wide))
        default:
            return date.formatted(Date.FormatStyle(date: .long, time: .omitted, locale: locale, calendar: Self.calendar, timeZone: Self.calendar.timeZone))
        }
    }

    func isRecent(relativeTo now: Date) -> Bool {
        age(relativeTo: now).map { (0...6).contains($0) } ?? false
    }

    private func age(relativeTo now: Date) -> Int? {
        date.flatMap { Self.calendar.dateComponents([.day], from: $0, to: Self.calendar.startOfDay(for: now)).day }
    }
}
