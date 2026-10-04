import XCTest
@testable import Podcst

@MainActor
final class StarStoreTests: XCTestCase {
    func testStarsKeepTheirOrderAndContentAcrossRelaunch() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var clock = Date(timeIntervalSince1970: 1_000)
        let stars = StarStore(directory: directory) { clock }
        let first = episode("first")
        let second = episode("second")
        stars.star(first)
        clock += 60
        stars.star(second)
        XCTAssertEqual(stars.episodes, [second, first])
        XCTAssertTrue(stars.contains(first))

        clock += 60
        var renamed = first
        renamed.title = "First, renamed"
        stars.star(renamed)
        XCTAssertEqual(stars.episodes, [second, renamed])
        XCTAssertEqual(stars.stars.last?.starredAt, Date(timeIntervalSince1970: 1_000))

        let restored = StarStore(directory: directory)
        XCTAssertEqual(restored.stars, stars.stars)
        restored.unstar(second)
        XCTAssertEqual(StarStore(directory: directory).episodes, [renamed])
    }

    func testToggleStarsAndUnstarsByIdentity() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let stars = StarStore(directory: directory)
        let starred = episode("toggled")
        stars.toggle(starred)
        XCTAssertTrue(stars.contains(starred))
        var refreshed = starred
        refreshed.duration = 1_800
        stars.toggle(refreshed)
        XCTAssertFalse(stars.contains(starred))
        XCTAssertTrue(stars.stars.isEmpty)
    }

    func testAccountsKeepSeparateStarsAndLeavingAnAccountForgetsIt() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let guest = episode("guest")
        let listener = episode("listener")
        let stars = StarStore(directory: directory)
        stars.star(guest)

        stars.switchAccount(to: "listener")
        XCTAssertEqual(stars.accountID, "listener")
        XCTAssertTrue(stars.stars.isEmpty)
        stars.star(listener)
        XCTAssertEqual(StarStore(accountID: "listener", directory: directory).episodes, [listener])
        XCTAssertFalse(try FileManager.default.contentsOfDirectory(atPath: directory.path).joined().contains("listener"))

        stars.switchAccount(to: nil)
        XCTAssertEqual(stars.episodes, [guest])
        XCTAssertTrue(StarStore(accountID: "listener", directory: directory).stars.isEmpty)
    }

    private func episode(_ guid: String) -> Episode {
        Episode(guid: guid, feed: "https://example.test/feed", podcastTitle: "Show", title: guid, file: EpisodeFile(url: "https://example.test/\(guid).mp3"))
    }
}
