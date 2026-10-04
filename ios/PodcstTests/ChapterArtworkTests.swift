import Foundation
import MediaPlayer
import XCTest
@testable import Podcst

@MainActor
final class ChapterArtworkTests: XCTestCase {
    func testID3VersionsPreserveImagesAndHideUnreferencedCues() throws {
        for version in [3, 4] {
            let metadata = try fixture(version)
            XCTAssertEqual(metadata.entries.count, 4)
            XCTAssertEqual(metadata.navigation.map(\.title), ["Opening", "No artwork", "Ending"])
            XCTAssertEqual(metadata.navigation.map(\.start), [0, 4, 8])
            XCTAssertTrue(metadata.entries[1].isHidden)
            XCTAssertEqual(metadata.entries[1].end, 3.5)
            XCTAssertEqual(metadata.entries.filter { $0.artwork != nil }.count, 3)
            let red = try XCTUnwrap(metadata.navigation.first?.artwork)
            let blue = try XCTUnwrap(metadata.entries[1].artwork)
            XCTAssertNotEqual(red.id, blue.id)
            XCTAssertEqual(blue, metadata.navigation.last?.artwork)
            XCTAssertEqual(red.image()?.size.width, 2)
            XCTAssertEqual(red.image()?.size.height, 1)
            let cases: [(Double, ChapterArtwork?)] = [(0, red), (1.999, red), (2, blue), (3.499, blue), (3.5, red), (4, nil), (7.999, nil), (8, blue), (11.999, blue), (12, nil)]
            for (time, expected) in cases {
                XCTAssertEqual(metadata.artwork(at: time, duration: 16), expected, "time \(time)")
            }
            XCTAssertNil(metadata.artwork(at: .nan, duration: 16))
            XCTAssertNil(metadata.artwork(at: -1, duration: 16))
        }
    }

    func testWithoutTableAllChaptersAreNavigableAndMalformedTagsFailClosed() throws {
        var data = try tag(3)
        while let range = data.range(of: Data("CTOC".utf8)) {
            data.replaceSubrange(range, with: Data("XXXX".utf8))
        }
        XCTAssertEqual(ID3Chapters.parse(data)?.navigation.count, 4)
        XCTAssertNil(ID3Chapters.parse(Data(data.dropLast())))
        data[5] = 0x80
        XCTAssertNil(ID3Chapters.parse(data))
        var oversized = Data("ID3\u{4}\0\0".utf8)
        oversized.append(contentsOf: [0x7f, 0x7f, 0x7f, 0x7f])
        XCTAssertNil(ID3Chapters.tagSize(oversized))
        XCTAssertNil(ChapterArtwork(Data("not an image".utf8)))
        XCTAssertNil(ChapterArtwork(Data(repeating: 0, count: 4 * 1024 * 1024 + 1)))
    }

    func testUnknownEndsUseNextVisibleChapterWithoutHiddenCuesShorteningIt() throws {
        let image = try XCTUnwrap(fixture(3).entries.first?.artwork)
        let metadata = ChapterMetadata([
            Chapter(title: "First", start: 0, artwork: image),
            Chapter(title: "", start: 2, end: 3, artwork: image, isHidden: true),
            Chapter(title: "Second", start: 4),
        ])
        XCTAssertEqual(metadata.artwork(at: 3.5, duration: 8), image)
        XCTAssertNil(metadata.artwork(at: 4, duration: 8))
        XCTAssertNil(metadata.artwork(at: 8, duration: 8))
    }

    func testPlaybackSeeksAndSystemArtworkFollowCuesWithoutChangingNavigation() async throws {
        let metadata = try fixture(3)
        let transport = ChapterTestTransport()
        var infos: [[String: Any]?] = []
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let controller = PlaybackController(transport: transport, persistenceURL: directory.appendingPathComponent("state"),
                                            nowPlayingInfoSink: { infos.append($0) }, chapterLoader: { _ in metadata })
        defer { controller.shutdown(); try? FileManager.default.removeItem(at: directory) }
        controller.play(episode("first"))
        try await wait { controller.chapters.count == 3 && infos.last.flatMap { $0 }?[MPMediaItemPropertyArtwork] != nil }
        XCTAssertEqual(controller.currentChapterArtwork, metadata.entries[0].artwork)
        controller.seek(to: 2.5)
        XCTAssertEqual(controller.currentChapterArtwork, metadata.entries[1].artwork)
        XCTAssertEqual(controller.currentChapterIndex, 0)
        controller.nextChapter()
        XCTAssertEqual(controller.currentTime, 4)
        XCTAssertNil(controller.currentChapterArtwork)
        controller.seek(to: 8)
        XCTAssertEqual(controller.currentChapterArtwork, metadata.entries.last?.artwork)
        controller.seek(to: 12)
        XCTAssertNil(controller.currentChapterArtwork)
        controller.beginAccountChange()
        await controller.releaseChapterMetadata()
        XCTAssertNil(controller.currentChapterArtwork)
        XCTAssertTrue(controller.chapters.isEmpty)
        controller.switchAccount(to: "other")
        XCTAssertNil(infos.last.flatMap { $0 })
    }

    func testLateMetadataCannotCrossAnEpisodeOrAccountBoundary() async throws {
        let metadata = try fixture(3)
        var continuations: [CheckedContinuation<ChapterMetadata?, Never>] = []
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let controller = PlaybackController(transport: ChapterTestTransport(), persistenceURL: directory.appendingPathComponent("state"), chapterLoader: { _ in
            await withCheckedContinuation { continuations.append($0) }
        })
        defer { controller.shutdown(); try? FileManager.default.removeItem(at: directory) }
        controller.play(episode("first"))
        try await wait { continuations.count == 1 }
        controller.play(episode("second"))
        continuations[0].resume(returning: metadata)
        try await wait { continuations.count == 2 }
        XCTAssertNil(controller.currentChapterArtwork)
        controller.beginAccountChange()
        continuations[1].resume(returning: metadata)
        await controller.releaseChapterMetadata()
        XCTAssertNil(controller.currentChapterArtwork)
        XCTAssertTrue(controller.chapters.isEmpty)
    }

    private func fixture(_ version: Int) throws -> ChapterMetadata {
        try XCTUnwrap(ID3Chapters.parse(tag(version)))
    }

    private func tag(_ version: Int) throws -> Data {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("contracts/fixtures/media/chapters-artwork-v2\(version).mp3")
        let bytes = try Data(contentsOf: url)
        return Data(bytes.prefix(try XCTUnwrap(ID3Chapters.tagSize(bytes))))
    }

    private func episode(_ id: String) -> Episode {
        Episode(guid: id, feed: "https://example.com/feed", title: id, duration: 16, file: EpisodeFile(url: "https://example.com/\(id).mp3"))
    }

    private func wait(_ predicate: () -> Bool) async throws {
        for _ in 0..<200 {
            if predicate() { return }
            try await Task.sleep(for: .milliseconds(5))
        }
        XCTFail("Timed out waiting for chapter metadata")
    }
}

@MainActor
private final class ChapterTestTransport: PlaybackTransport {
    var onUpdate: (@MainActor (PlaybackTransportUpdate) -> Void)?
    var hasSource = false
    var position: TimeInterval = 0
    func load(source: PlaybackSource, at position: TimeInterval, generation: UUID) { hasSource = true; self.position = position }
    func play(atRate rate: Double) {}
    func pause() {}
    func setRate(_ rate: Double) {}
    func setEffects(_ effects: AudioEffects) {}
    func seek(to position: TimeInterval, generation: UUID) { self.position = position }
    func stop() { hasSource = false }
    func shutdown() { stop() }
}
