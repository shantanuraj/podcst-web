import Foundation
import XCTest
@testable import Podcst

@MainActor
final class PlaybackTests: XCTestCase {
    func testQueueMoveKeepsCurrentEpisodeIdentity() {
        let controller = PlaybackController(persistenceURL: temporaryURL())
        let first = episode(guid: "first")
        let second = episode(guid: "second")
        let third = episode(guid: "third")

        controller.enqueue(first)
        controller.enqueue(second)
        controller.enqueue(third)
        controller.play(second)
        controller.move(fromOffsets: IndexSet(integer: 1), toOffset: 3)

        XCTAssertEqual(controller.queue.map(\.guid), ["first", "third", "second"])
        XCTAssertEqual(controller.currentEpisode?.guid, "second")
        XCTAssertEqual(controller.currentIndex, 2)
    }

    func testRemoveCurrentSelectsRemainingEpisodeAndPersists() {
        let url = temporaryURL()
        let controller = PlaybackController(persistenceURL: url)
        let first = episode(guid: "first")
        let second = episode(guid: "second")

        controller.enqueue(first)
        controller.enqueue(second)
        controller.play(first, at: 17)
        controller.remove(atOffsets: IndexSet(integer: 0))

        XCTAssertEqual(controller.queue.map(\.guid), ["second"])
        XCTAssertEqual(controller.currentEpisode?.guid, "second")
        XCTAssertEqual(controller.currentTime, 0)

        let restored = PlaybackController(persistenceURL: url)
        XCTAssertEqual(restored.queue.map(\.guid), ["second"])
        XCTAssertEqual(restored.currentEpisode?.guid, "second")
    }

    func testEnqueueDoesNotDuplicateCurrentPlaybackWhenPlayingEpisode() {
        let controller = PlaybackController(persistenceURL: temporaryURL())
        let item = episode(guid: "same")

        controller.play(item)
        controller.play(item, at: 29)

        XCTAssertEqual(controller.queue.count, 1)
        XCTAssertEqual(controller.currentTime, 29)
        XCTAssertEqual(controller.currentEpisode?.guid, "same")
    }

    func testShowNotesTimestampParsingSupportsMinuteAndHourFormats() {
        XCTAssertEqual(ShowNotesParser.seconds(from: "3:33"), 213)
        XCTAssertEqual(ShowNotesParser.seconds(from: "00:05:00"), 300)
        XCTAssertEqual(ShowNotesParser.seconds(from: "2:36:47"), 9407)
        XCTAssertNil(ShowNotesParser.seconds(from: "2:75"))
    }

    func testChaptersParseFromTimestampedShowNotes() {
        let notes = "<p>Why attention feels free.</p><ul><li>00:00 Cold open</li><li>(02:14) The price of a glance</li><li>17:40 – Scarcity, reconsidered</li><li>1:02:05 What we owe each other</li></ul><p>At 12:30 we digress.</p>"

        XCTAssertEqual(ShowNotesParser.chapters(notes), [
            Chapter(title: "Cold open", start: 0),
            Chapter(title: "The price of a glance", start: 134),
            Chapter(title: "Scarcity, reconsidered", start: 1060),
            Chapter(title: "What we owe each other", start: 3725),
        ])
        XCTAssertEqual(ShowNotesParser.chapters("<p>05:00 Only one chapter</p>"), [])
        XCTAssertEqual(ShowNotesParser.chapters("10:00 Late<br>02:00 Early"), [])
    }

    func testChapterNavigationFallsBackToEpisodes() {
        let controller = PlaybackController(persistenceURL: temporaryURL())
        var chaptered = episode(guid: "chaptered")
        chaptered.showNotes = "00:00 Intro<br>01:00 Middle<br>02:00 End"
        chaptered.duration = 180

        controller.restore(chaptered, at: 70)
        XCTAssertEqual(controller.currentChapterIndex, 1)
        controller.nextChapter()
        XCTAssertEqual(controller.currentTime, 120)
        controller.seek(to: 130)
        controller.previousChapter()
        XCTAssertEqual(controller.currentTime, 120)
        controller.previousChapter()
        XCTAssertEqual(controller.currentTime, 60)
    }

    func testUpNextWrapsAfterCurrentAndEditsInThatOrder() {
        let controller = PlaybackController(persistenceURL: temporaryURL())
        ["a", "b", "c", "d"].forEach { controller.enqueue(episode(guid: $0)) }
        controller.play(episode(guid: "c"))

        XCTAssertEqual(controller.upNext.map(\.guid), ["d", "a", "b"])

        controller.moveUpNext(fromOffsets: IndexSet(integer: 2), toOffset: 0)
        XCTAssertEqual(controller.upNext.map(\.guid), ["b", "d", "a"])
        XCTAssertEqual(controller.currentEpisode?.guid, "c")

        controller.removeUpNext(atOffsets: IndexSet(integer: 1))
        XCTAssertEqual(controller.upNext.map(\.guid), ["b", "a"])
        XCTAssertEqual(controller.currentEpisode?.guid, "c")
    }

    func testOPMLRoundTripsFeeds() {
        let podcasts = [
            Podcast(feed: "https://example.com/a.xml?x=1&y=2", title: "A & B"),
            Podcast(feed: "https://example.com/\"quoted\".xml", title: "Quoted"),
        ]

        XCTAssertEqual(OPML.feeds(in: OPML.document(podcasts)), podcasts.map(\.feed))
        XCTAssertEqual(OPML.feeds(in: "<outline text='x' xmlUrl='https://example.com/feed'/>"), ["https://example.com/feed"])
    }

    private func episode(guid: String) -> Episode {
        Episode(guid: guid, feed: "https://example.com/feed.xml", title: guid, file: EpisodeFile(url: "https://example.com/\(guid).mp3"))
    }

    private func temporaryURL() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("json")
    }
}
