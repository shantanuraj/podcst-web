import Foundation
import XCTest
@testable import Podcst

final class ReleaseSectionTests: XCTestCase {
    func testRecentLabelsUseSevenUTCCalendarDays() {
        let episodes = [
            episode(1, published: "2026-09-29T00:00:00Z"),
            episode(2, published: "2026-09-28T09:46:25Z"),
            episode(3, published: "2026-09-27T10:00:00Z"),
            episode(4, published: "2026-09-23T14:00:00Z"),
            episode(5, published: "2026-09-22T08:00:00Z"),
        ]
        let sections = ReleaseSection.grouping(episodes)
        let now = date("2026-09-29T23:59:59Z")

        XCTAssertEqual(sections.map { $0.title(relativeTo: now, locale: locale) }, [
            "Today", "Yesterday", "Sunday", "Wednesday", "September 22, 2026",
        ])
        XCTAssertEqual(sections.map { $0.isRecent(relativeTo: now) }, [true, true, true, true, false])
    }

    func testGroupingPreservesDuplicateTitlesAndOriginalEpisodeOrder() {
        let episodes = [
            episode(275948266, published: "2026-09-18T18:05:00Z", podcastID: 4692124, title: "Bollywood Dreams"),
            episode(265131317, published: "2026-09-18T18:05:00Z", podcastID: 152, title: "Bollywood Dreams"),
            episode(263865354, published: "2026-09-18T14:00:00Z"),
            episode(268760389, published: "2026-09-17T17:00:00Z"),
        ]
        let sections = ReleaseSection.grouping(episodes)

        XCTAssertEqual(sections.map(\.date), [date("2026-09-18T00:00:00Z"), date("2026-09-17T00:00:00Z")])
        XCTAssertEqual(sections.map { $0.episodes.count }, [3, 1])
        XCTAssertEqual(sections.flatMap(\.episodes), episodes)
        XCTAssertEqual(Set(sections.map(\.id)).count, sections.count)
    }

    func testUTCGroupingIgnoresOffsetAndDaylightSavingTransitions() {
        let episodes = [
            episode(1, published: "2026-03-29T23:59:59Z"),
            episode(2, published: "2026-03-29T03:00:00+02:00"),
            episode(3, published: "2026-03-29T01:59:59+01:00"),
            episode(4, published: "2026-03-29T00:00:00Z"),
            episode(5, published: "2026-03-29T00:59:59+01:00"),
        ]
        let sections = ReleaseSection.grouping(episodes)
        let beforeMidnight = date("2026-03-30T01:59:59+02:00")
        let midnight = date("2026-03-30T02:00:00+02:00")

        XCTAssertEqual(sections.map(\.date), [date("2026-03-29T00:00:00Z"), date("2026-03-28T00:00:00Z")])
        XCTAssertEqual(sections.map { $0.episodes.map(\.id) }, [[1, 2, 3, 4], [5]])
        XCTAssertEqual(sections.first?.title(relativeTo: beforeMidnight, locale: locale), "Today")
        XCTAssertEqual(sections.first?.title(relativeTo: midnight, locale: locale), "Yesterday")
    }

    func testMissingDatesShareOneSectionAndEmptyInputStaysEmpty() throws {
        let episodes = [episode(1, published: nil), episode(2, published: nil)]
        let sections = ReleaseSection.grouping(episodes)
        let section = try XCTUnwrap(sections.first)
        let now = date("2026-09-29T00:00:00Z")

        XCTAssertEqual(sections.count, 1)
        XCTAssertNil(section.date)
        XCTAssertEqual(section.episodes, episodes)
        XCTAssertEqual(section.title(relativeTo: now, locale: locale), "Date unavailable")
        XCTAssertFalse(section.isRecent(relativeTo: now))
        XCTAssertTrue(ReleaseSection.grouping([]).isEmpty)
    }

    func testFullDatesKeepYearAndLocaleWhileFutureDatesAreNotRecent() {
        let episodes = [
            episode(1, published: "2027-01-02T00:00:00Z"),
            episode(2, published: "2026-12-31T23:59:59Z"),
            episode(3, published: "2026-12-25T23:59:59Z"),
            episode(4, published: "2023-12-27T19:37:04Z"),
        ]
        let sections = ReleaseSection.grouping(episodes)
        let now = date("2027-01-01T00:00:00Z")

        XCTAssertEqual(sections.map { $0.title(relativeTo: now, locale: locale) }, [
            "January 2, 2027", "Yesterday", "December 25, 2026", "December 27, 2023",
        ])
        XCTAssertEqual(sections.map { $0.isRecent(relativeTo: now) }, [false, true, false, false])
        XCTAssertEqual(sections.last?.title(relativeTo: now, locale: Locale(identifier: "en_GB")), "27 December 2023")
    }

    private let locale = Locale(identifier: "en_US")

    private func date(_ value: String) -> Date {
        ISO8601DateFormatter().date(from: value)!
    }

    private func episode(_ id: Int, published: String?, podcastID: Int = 1, title: String = "Episode") -> Episode {
        Episode(
            id: id,
            podcastId: podcastID,
            guid: "\(id)",
            feed: "https://example.com/\(podcastID)/feed.xml",
            title: title,
            published: published.map(date),
            file: EpisodeFile(url: "https://example.com/\(id).mp3")
        )
    }
}
