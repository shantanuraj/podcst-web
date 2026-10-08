import Foundation
import XCTest
@testable import Podcst

final class PublicLinkTests: XCTestCase {
    func testLinksMatchSharedVectors() throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("contracts/sharing/links.json")
        let vectors = try JSONDecoder().decode(LinkVectors.self, from: Data(contentsOf: url))
        XCTAssertEqual(vectors.origin, PublicLink.origin)
        XCTAssertEqual(vectors.maxSeconds, PublicLink.maxSeconds)

        for vector in vectors.format {
            XCTAssertEqual(PublicLink.format(Int(vector.seconds.rounded(.down))), vector.expected, "\(vector.seconds)")
            XCTAssertEqual(PublicLink.seconds(vector.expected), Int(vector.seconds.rounded(.down)), vector.expected)
        }

        for vector in vectors.generate {
            let target = vector.target
            guard let podcastId = try? StateID(target.podcastId).number,
                  target.episodeId.map({ (try? StateID($0)) != nil }) ?? true else {
                XCTAssertNil(vector.expected, vector.name)
                continue
            }
            let link = PublicLink(podcastId: podcastId, episodeId: target.episodeId.flatMap { try? StateID($0).number }, moment: target.moment?.value)
            XCTAssertEqual(link.url?.absoluteString, vector.expected, vector.name)
        }

        for vector in vectors.parse {
            let parsed = URL(string: vector.url).flatMap(PublicLink.init)
            guard let expected = vector.expected else {
                XCTAssertNil(parsed, vector.url)
                continue
            }
            let link = try XCTUnwrap(parsed, vector.url)
            XCTAssertEqual(String(link.podcastId), expected.podcastId, vector.url)
            XCTAssertEqual(link.episodeId.map(String.init), expected.episodeId, vector.url)
            XCTAssertEqual(link.moment, expected.moment?.value, vector.url)
            XCTAssertEqual(link.invalidMoment, expected.invalidMoment, vector.url)
        }
    }

    func testOnlyPublicContentWithCanonicalIdentitiesIsShareable() throws {
        let file = EpisodeFile(url: "https://example.test/audio.mp3")
        var episode = Episode(id: 88412, podcastId: 301, guid: "guid", feed: "https://example.test/feed", title: "Episode", link: "https://example.test/episode", file: file)
        var podcast = Podcast(id: 301, feed: "https://example.test/feed", title: "Show", link: "https://example.test/show")
        XCTAssertEqual(episode.publicLink?.url?.absoluteString, "https://www.podcst.app/episodes/301/88412")
        XCTAssertEqual(podcast.publicLink?.url?.absoluteString, "https://www.podcst.app/episodes/301")
        XCTAssertEqual(episode.publicLink?.with(.time(1092.97)).url?.absoluteString, "https://www.podcst.app/episodes/301/88412?t=18m12s")

        episode.isPrivate = true
        podcast.isPrivate = true
        XCTAssertNil(episode.publicLink)
        XCTAssertNil(podcast.publicLink)
        XCTAssertEqual(try JSONDecoder().decode(Episode.self, from: JSONEncoder().encode(episode)).isPrivate, true)

        episode.isPrivate = false
        podcast.isPrivate = false
        podcast.id = nil
        XCTAssertNil(podcast.publicLink)
        episode.podcastId = nil
        XCTAssertNil(episode.publicLink)
        episode.podcastId = 301
        episode.id = nil
        XCTAssertNil(episode.publicLink)
    }
}

private struct LinkVectors: Decodable {
    struct Format: Decodable {
        let seconds: Double
        let expected: String
    }

    struct Seconds: Decodable {
        let value: Double

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let text = try? container.decode(String.self) {
                guard text == "NaN" else { throw DecodingError.dataCorruptedError(in: container, debugDescription: text) }
                value = .nan
            } else {
                value = try container.decode(Double.self)
            }
        }
    }

    struct Moment: Decodable {
        let kind: String
        let start: Seconds
        let end: Seconds?
        let chapter: Int?

        var value: PublicLink.Moment {
            switch kind {
            case "time": .time(start.value)
            case "clip": .clip(start.value, end!.value)
            default: .chapter(chapter!, start.value, end!.value)
            }
        }
    }

    struct Target: Decodable {
        let podcastId: String
        let episodeId: String?
        let moment: Moment?
    }

    struct Generate: Decodable {
        let name: String
        let target: Target
        let expected: String?
    }

    struct Parsed: Decodable {
        let podcastId: String
        let episodeId: String?
        let moment: Moment?
        let invalidMoment: Bool
    }

    struct Parse: Decodable {
        let url: String
        let expected: Parsed?
    }

    let origin: String
    let maxSeconds: Int
    let format: [Format]
    let generate: [Generate]
    let parse: [Parse]
}
