import Foundation
import XCTest
@testable import Podcst

@MainActor
final class DownloadedMediaFileTests: XCTestCase {
    func testCompletedDownloadPublishesBytesAndDurableManifestTogether() throws {
        let body = Data((0..<128).map { UInt8($0) })
        let paths = try fixture(body: body)
        let manifest = try DownloadedMediaFile.install(from: paths.temporary, response: response(), in: paths.destination)

        XCTAssertEqual(try Data(contentsOf: paths.destination.appendingPathComponent("media")), body)
        XCTAssertTrue(manifest.isComplete)
        XCTAssertTrue(manifest.durable)
        XCTAssertEqual(manifest.metadata?.totalBytes, Int64(body.count))
        XCTAssertEqual(manifest.metadata?.contentType, "audio/mpeg")
        XCTAssertEqual(manifest.metadata?.validator, "\"version-1\"")
        XCTAssertEqual(manifest.metadata?.capability, .completeFileRequired)
        XCTAssertEqual(DownloadedMediaFile.manifest(in: paths.destination)?.storedBytes, Int64(body.count))
        XCTAssertFalse(FileManager.default.fileExists(atPath: paths.temporary.path))
        XCTAssertEqual(try siblings(of: paths.destination), ["installed"])
        XCTAssertEqual(try paths.destination.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
        #if !targetEnvironment(simulator)
        let attributes = try FileManager.default.attributesOfItem(atPath: paths.destination.appendingPathComponent("media").path)
        XCTAssertEqual(attributes[.protectionKey] as? String, FileProtectionType.completeUntilFirstUserAuthentication.rawValue)
        #endif
    }

    func testCompletedResponseWithoutContentLengthCanBePlayedFromDisk() throws {
        let paths = try fixture()
        let manifest = try DownloadedMediaFile.install(from: paths.temporary, response: response(length: nil), in: paths.destination)

        XCTAssertEqual(manifest.metadata?.totalBytes, 128)
        XCTAssertEqual(DownloadedMediaFile.manifest(in: paths.destination)?.storedBytes, 128)
    }

    func testTruncatedResponseNeverPublishesACompleteFile() throws {
        try assertRejected(response: response(length: 256), expected: .invalidResponse)
    }

    func testResumedResponsePublishesTheFullyAssembledFile() throws {
        let paths = try fixture()
        let manifest = try DownloadedMediaFile.install(
            from: paths.temporary,
            response: response(status: 206, length: 64, headers: ["Content-Range": "bytes 64-127/128"]),
            in: paths.destination
        )

        XCTAssertEqual(manifest.storedBytes, 128)
        XCTAssertEqual(try Data(contentsOf: paths.destination.appendingPathComponent("media")), Data(repeating: 0x5A, count: 128))
        XCTAssertEqual(DownloadedMediaFile.manifest(in: paths.destination)?.metadata?.totalBytes, 128)
    }

    func testResumedResponseRejectsASuffixFileWithoutTheEarlierBytes() throws {
        try assertRejected(
            response: response(status: 206, length: 128, headers: ["Content-Range": "bytes 128-255/256"]),
            expected: .invalidResponse
        )
    }

    func testResumedResponseRejectsAnIncompleteOrMalformedRange() throws {
        for range in ["bytes 0-63/128", "bytes 64-127/*", "bytes -64-127/128", "bytes 128-127/128", "bytes 64-127/128/", "items 64-127/128", "bytes 64-127/9223372036854775808"] {
            try assertRejected(
                response: response(status: 206, length: 64, headers: ["Content-Range": range]),
                expected: .invalidResponse
            )
        }
        try assertRejected(
            response: response(status: 206, length: 65, headers: ["Content-Range": "bytes 64-127/128"]),
            expected: .invalidResponse
        )
    }

    func testHTTPFailuresAndEncodedBodiesAreNeverPublished() throws {
        try assertRejected(response: response(status: 403), expected: .unavailable(403))
        try assertRejected(response: response(status: 500), expected: .unavailable(500))
        try assertRejected(response: response(headers: ["Content-Encoding": "gzip"]), expected: .invalidResponse)
    }

    func testInvalidContentLengthAndEmptyBodiesAreRejected() throws {
        for length in ["-1", "+128", "128,128", "overflow", "9223372036854775808"] {
            try assertRejected(response: response(headers: ["Content-Length": length]), expected: .invalidResponse)
        }
        let paths = try fixture(body: Data())
        XCTAssertThrowsError(try DownloadedMediaFile.install(from: paths.temporary, response: response(length: 0), in: paths.destination)) {
            XCTAssertEqual($0 as? MediaFailure, .invalidResponse)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: paths.destination.path))
    }

    func testOversizedFilesAreRejectedBeforePublication() throws {
        let paths = try fixture()
        let file = try FileHandle(forWritingTo: paths.temporary)
        try file.truncate(atOffset: UInt64(DownloadedMediaFile.maximumBytes + 1))
        try file.close()

        XCTAssertThrowsError(try DownloadedMediaFile.install(from: paths.temporary, response: response(length: nil), in: paths.destination)) {
            XCTAssertEqual($0 as? MediaFailure, .invalidResponse)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: paths.destination.path))
    }

    func testASecondCompletionCannotReplaceAnExistingCompleteDownload() throws {
        let paths = try fixture()
        _ = try DownloadedMediaFile.install(from: paths.temporary, response: response(), in: paths.destination)
        let replacement = Data(repeating: 0xA5, count: 128)
        try replacement.write(to: paths.temporary)

        XCTAssertThrowsError(try DownloadedMediaFile.install(from: paths.temporary, response: response(), in: paths.destination)) {
            XCTAssertEqual($0 as? MediaFailure, .storageUnavailable)
        }
        XCTAssertEqual(try Data(contentsOf: paths.destination.appendingPathComponent("media")), Data(repeating: 0x5A, count: 128))
        XCTAssertEqual(try Data(contentsOf: paths.temporary), replacement)
        XCTAssertEqual(DownloadedMediaFile.manifest(in: paths.destination)?.storedBytes, 128)
        XCTAssertEqual(try siblings(of: paths.destination), ["installed", "pending"])
    }

    func testRestorationRejectsFilesWhoseSizeNoLongerMatchesTheManifest() throws {
        for size in [64, 256] {
            let paths = try fixture()
            _ = try DownloadedMediaFile.install(from: paths.temporary, response: response(), in: paths.destination)
            try Data(repeating: 0x5A, count: size).write(to: paths.destination.appendingPathComponent("media"))

            XCTAssertNil(DownloadedMediaFile.manifest(in: paths.destination))
        }
    }

    private func assertRejected(response: HTTPURLResponse, expected: MediaFailure, file: StaticString = #filePath, line: UInt = #line) throws {
        let paths = try fixture()
        XCTAssertThrowsError(try DownloadedMediaFile.install(from: paths.temporary, response: response, in: paths.destination), file: file, line: line) {
            XCTAssertEqual($0 as? MediaFailure, expected, file: file, line: line)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: paths.destination.path), file: file, line: line)
        XCTAssertEqual(try Data(contentsOf: paths.temporary), Data(repeating: 0x5A, count: 128), file: file, line: line)
        XCTAssertEqual(try siblings(of: paths.destination), ["pending"], file: file, line: line)
    }

    private func fixture(body: Data = Data(repeating: 0x5A, count: 128)) throws -> (temporary: URL, destination: URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("download-file-test-\(UUID())", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let temporary = root.appendingPathComponent("pending")
        try body.write(to: temporary)
        return (temporary, root.appendingPathComponent("installed", isDirectory: true))
    }

    private func response(status: Int = 200, length: Int? = 128, headers: [String: String] = [:]) throws -> HTTPURLResponse {
        var fields = ["Content-Type": "audio/mpeg", "ETag": "\"version-1\""]
        if let length { fields["Content-Length"] = String(length) }
        fields.merge(headers) { _, value in value }
        return try XCTUnwrap(HTTPURLResponse(url: URL(string: "https://example.test/episode.mp3?token=private")!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: fields))
    }

    private func siblings(of destination: URL) throws -> [String] {
        try FileManager.default.contentsOfDirectory(at: destination.deletingLastPathComponent(), includingPropertiesForKeys: nil).map(\.lastPathComponent).sorted()
    }
}
