import Foundation
import Synchronization

struct PlaybackTraceEvent: Codable, Sendable {
    let sequence: UInt64
    let uptime: TimeInterval
    let event: String
    let values: [String: Double]
    let labels: [String: String]
}

final class PlaybackTraceRecorder: @unchecked Sendable {
    struct Status: Sendable {
        var recording = false
        var dropped = 0
        var failure: String?
    }

    enum Failure: Error {
        case alreadyRecording
        case sizeLimit
    }

    private struct State {
        var session: UUID?
        var pending = 0
        var dropped = 0
        var failure: String?
    }

    static let shared = PlaybackTraceRecorder()
    static var now: TimeInterval { ProcessInfo.processInfo.systemUptime }
    static var directory: URL {
        URL.applicationSupportDirectory.appendingPathComponent("PlaybackTraces", isDirectory: true)
    }

    private let state = Mutex(State())
    private let queue = DispatchQueue(label: "app.podcst.playback-trace", qos: .utility)
    private let byteLimit: Int
    private let pendingLimit: Int
    private var output: FileHandle?
    private var outputSession: UUID?
    private var outputURL: URL?
    private var bytes = 0
    private var sequence: UInt64 = 0
    private var lastSync: TimeInterval = 0

    init(byteLimit: Int = 64 * 1024 * 1024, pendingLimit: Int = 512) {
        self.byteLimit = max(4096, byteLimit)
        self.pendingLimit = max(1, pendingLimit)
    }

    var isRecording: Bool { state.withLock { $0.session != nil } }
    var status: Status {
        state.withLock { Status(recording: $0.session != nil, dropped: $0.dropped, failure: $0.failure) }
    }

    func start(directory: URL = PlaybackTraceRecorder.directory, labels: [String: String] = [:]) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            queue.async { [self] in
                do {
                    guard !isRecording else { throw Failure.alreadyRecording }
                    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                    var folder = directory
                    var resourceValues = URLResourceValues()
                    resourceValues.isExcludedFromBackup = true
                    try folder.setResourceValues(resourceValues)
                    let session = UUID()
                    let url = directory.appendingPathComponent("Podcst-playback-\(session.uuidString).jsonl")
                    guard FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else {
                        throw CocoaError(.fileWriteUnknown)
                    }
                    output = try FileHandle(forWritingTo: url)
                    outputSession = session
                    outputURL = url
                    bytes = 0
                    sequence = 0
                    lastSync = Self.now
                    state.withLock { $0 = State() }
                    try write("trace_start", at: Self.now, values: ["schema": 1, "unixTime": Date().timeIntervalSince1970, "byteLimit": Double(byteLimit)], labels: labels.merging(["session": session.uuidString, "clock": "systemUptime"]) { _, new in new })
                    try output?.synchronize()
                    state.withLock { $0.session = session }
                    continuation.resume(returning: url)
                } catch {
                    if !isRecording { closeAfterFailure() }
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    func record(_ event: String, values: [String: Double] = [:], labels: [String: String] = [:]) {
        let time = Self.now
        state.withLock { state in
            guard let session = state.session else { return }
            guard state.pending < pendingLimit else { state.dropped += 1; return }
            state.pending += 1
            queue.async { [self] in
                defer { self.state.withLock { $0.pending = max(0, $0.pending - 1) } }
                guard outputSession == session, output != nil else { return }
                do {
                    if bytes >= byteLimit - 2048 {
                        let dropped = self.state.withLock { state in
                            state.session = nil
                            state.failure = "Recording reached its 64 MB limit. Start another recording to continue."
                            return state.dropped
                        }
                        try write("trace_limit", at: time, values: ["droppedEvents": Double(dropped)], labels: [:])
                        try close()
                    } else {
                        try write(event, at: time, values: values, labels: labels)
                        if time - lastSync >= 2 {
                            try output?.synchronize()
                            lastSync = time
                        }
                    }
                } catch Failure.sizeLimit {
                    do {
                        let dropped = self.state.withLock { state in
                            state.session = nil
                            state.failure = "Recording reached its 64 MB limit. Start another recording to continue."
                            return state.dropped
                        }
                        try write("trace_limit", at: time, values: ["droppedEvents": Double(dropped)], labels: [:])
                        try close()
                    } catch { closeAfterFailure() }
                } catch {
                    closeAfterFailure()
                }
            }
        }
    }

    func stop() async -> URL? {
        await withCheckedContinuation { continuation in
            state.withLock { state in
                state.session = nil
                queue.async { [self] in
                    let url = outputURL
                    if output != nil {
                        do {
                            let dropped = self.state.withLock { $0.dropped }
                            try write("trace_stop", at: Self.now, values: ["droppedEvents": Double(dropped)], labels: [:])
                            try close()
                        } catch { closeAfterFailure() }
                    }
                    continuation.resume(returning: url)
                }
            }
        }
    }

    private func write(_ event: String, at time: TimeInterval, values: [String: Double], labels: [String: String]) throws {
        let safeKey: (String) -> Bool = { !$0.isEmpty && $0.count <= 64 && $0.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_") } }
        guard safeKey(event) else { return }
        var safeValues: [String: Double] = [:]
        for (key, value) in values.sorted(by: { $0.key < $1.key }) where safeKey(key) && value.isFinite {
            guard safeValues.count < 64 else { break }
            safeValues[key] = value
        }
        var safeLabels: [String: String] = [:]
        for (key, value) in labels.sorted(by: { $0.key < $1.key }) {
            guard safeLabels.count < 24 else { break }
            if safeKey(key), value.utf8.count <= 160, !value.contains("/"), !value.contains("\\"), !value.contains("@"), !value.contains("?"), !value.contains("\n") {
                safeLabels[key] = value
            }
        }
        let record = PlaybackTraceEvent(sequence: sequence, uptime: time, event: event, values: safeValues, labels: safeLabels)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        var data = try encoder.encode(record)
        data.append(10)
        let terminal = event == "trace_stop" || event == "trace_limit"
        guard bytes + data.count <= byteLimit - (terminal ? 0 : 1024) else { throw Failure.sizeLimit }
        try output?.write(contentsOf: data)
        bytes += data.count
        sequence += 1
    }

    private func close() throws {
        try output?.synchronize()
        try output?.close()
        output = nil
        outputSession = nil
    }

    private func closeAfterFailure() {
        try? output?.close()
        output = nil
        outputSession = nil
        state.withLock {
            $0.session = nil
            $0.failure = "Recording stopped because the trace could not be saved. Earlier events may still be available."
        }
    }
}
