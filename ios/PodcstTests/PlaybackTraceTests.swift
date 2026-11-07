import Foundation
import XCTest
@testable import Podcst

final class PlaybackTraceTests: XCTestCase {
    func testRecordingFlushesOrderedEventsAndRemainsReadableAfterStop() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let recorder = PlaybackTraceRecorder()
        recorder.record("before_start")
        let file = try await recorder.start(directory: directory, labels: ["revision": String(repeating: "a", count: 40)])
        for index in 0..<100 { recorder.record("sample", values: ["index": Double(index)]) }
        let stopped = await recorder.stop()
        XCTAssertEqual(stopped, file)
        recorder.record("after_stop")
        let events = try read(file)
        XCTAssertEqual(events.count, 102)
        XCTAssertEqual(events.first?.event, "trace_start")
        XCTAssertEqual(events.first?.values["schema"], 1)
        XCTAssertEqual(events.last?.event, "trace_stop")
        XCTAssertEqual(events.map(\.sequence), Array(0..<102).map(UInt64.init))
        XCTAssertEqual(events.filter { $0.event == "sample" }.compactMap { $0.values["index"] }, (0..<100).map(Double.init))
        XCTAssertTrue(zip(events, events.dropFirst()).allSatisfy { $0.uptime <= $1.uptime })
        XCTAssertFalse(recorder.isRecording)
        XCTAssertNil(recorder.status.failure)
    }

    func testSensitiveLabelsAndNonFiniteNumbersAreExcluded() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let recorder = PlaybackTraceRecorder()
        let file = try await recorder.start(directory: directory)
        recorder.record("media_request", values: ["elapsed": 0.25, "nan": .nan, "infinite": .infinity], labels: [
            "sourceId": "stable-source", "url": "https://private.example/audio?token=secret", "account": "person@example.com", "path": "/private/path", "multiline": "one\ntwo",
        ])
        _ = await recorder.stop()
        let event = try XCTUnwrap(try read(file).first { $0.event == "media_request" })
        XCTAssertEqual(event.labels, ["sourceId": "stable-source"])
        XCTAssertEqual(event.values, ["elapsed": 0.25])
        let text = try String(contentsOf: file, encoding: .utf8)
        XCTAssertFalse(text.contains("secret"))
        XCTAssertFalse(text.contains("private.example"))
    }

    func testFileLimitStopsCaptureWithAReadableTerminalEvent() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let recorder = PlaybackTraceRecorder(byteLimit: 4096)
        let file = try await recorder.start(directory: directory)
        for index in 0..<100 { recorder.record("sample", values: ["index": Double(index)], labels: ["state": String(repeating: "x", count: 100)]) }
        _ = await recorder.stop()
        XCTAssertLessThanOrEqual(try Data(contentsOf: file).count, 4096)
        XCTAssertEqual(try read(file).last?.event, "trace_limit")
        XCTAssertFalse(recorder.isRecording)
        XCTAssertNotNil(recorder.status.failure)
    }

    func testNewRecordingKeepsPreviousFileAndResetsSequence() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let recorder = PlaybackTraceRecorder()
        let first = try await recorder.start(directory: directory)
        recorder.record("user_glitch")
        _ = await recorder.stop()
        let contents = try Data(contentsOf: first)
        let second = try await recorder.start(directory: directory)
        recorder.record("another_episode")
        _ = await recorder.stop()
        XCTAssertNotEqual(first, second)
        XCTAssertEqual(try Data(contentsOf: first), contents)
        XCTAssertEqual(try read(second).first?.sequence, 0)
        XCTAssertEqual(try read(second).map(\.event), ["trace_start", "another_episode", "trace_stop"])
    }

    func testConcurrentCaptureIsBoundedAndReportsDroppedEvents() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let recorder = PlaybackTraceRecorder(pendingLimit: 4)
        let file = try await recorder.start(directory: directory)
        await withTaskGroup(of: Void.self) { group in
            for producer in 0..<8 {
                group.addTask {
                    for index in 0..<1000 { recorder.record("sample", values: ["producer": Double(producer), "index": Double(index)]) }
                }
            }
        }
        _ = await recorder.stop()
        let events = try read(file)
        let captured = events.filter { $0.event == "sample" }.count
        let dropped = try XCTUnwrap(events.last?.values["droppedEvents"])
        XCTAssertEqual(captured + Int(dropped), 8000)
        XCTAssertEqual(Set(events.map(\.sequence)).count, events.count)
    }

    func testStartingTwiceDoesNotCloseActiveRecording() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let recorder = PlaybackTraceRecorder()
        let first = try await recorder.start(directory: directory)
        do {
            _ = try await recorder.start(directory: directory)
            XCTFail("Expected an existing recording to be retained")
        } catch PlaybackTraceRecorder.Failure.alreadyRecording {}
        recorder.record("still_recording")
        _ = await recorder.stop()
        XCTAssertEqual(try read(first).map(\.event), ["trace_start", "still_recording", "trace_stop"])
    }

    private func temporaryDirectory() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("playback-trace-test-\(UUID().uuidString)", isDirectory: true)
    }

    private func read(_ url: URL) throws -> [PlaybackTraceEvent] {
        try Data(contentsOf: url).split(separator: 10).map { try JSONDecoder().decode(PlaybackTraceEvent.self, from: Data($0)) }
    }
}
