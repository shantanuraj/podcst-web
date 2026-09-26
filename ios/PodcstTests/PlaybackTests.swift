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

    private func episode(guid: String) -> Episode {
        Episode(guid: guid, feed: "https://example.com/feed.xml", title: guid, file: EpisodeFile(url: "https://example.com/\(guid).mp3"))
    }

    private func temporaryURL() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("json")
    }
}
