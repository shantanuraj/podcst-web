import Foundation

actor HTTPMediaByteSource {
    static let blockSize = 262_144
    private let directory: URL
    private let session: URLSession
    private let maximumAssetBytes: Int64
    private var locator: URL
    private var manifest: MediaManifest
    private var pins = 0
    private var retired = false
    private var epoch = UUID()
    private var readPriority: UInt64 = 0
    private var transfer: (id: UUID, priority: UInt64, range: MediaByteRange?, task: Task<Void, Error>)?

    init(url: URL, directory: URL, session: URLSession = .shared, maximumAssetBytes: Int64 = 4 * 1024 * 1024 * 1024) throws {
        guard ["https", "http"].contains(url.scheme?.lowercased() ?? ""), maximumAssetBytes > 0 else { throw MediaFailure.invalidSource }
        self.locator = url
        self.directory = directory
        self.session = session
        self.maximumAssetBytes = maximumAssetBytes
        manifest = Self.readManifest(directory: directory)
    }

    func updateLocator(_ url: URL) throws {
        guard !retired else { throw MediaFailure.accountChanged }
        guard ["https", "http"].contains(url.scheme?.lowercased() ?? "") else { throw MediaFailure.invalidSource }
        if locator != url {
            locator = url
            transfer?.task.cancel()
            transfer = nil
        }
    }

    func metadata() async throws -> MediaMetadata {
        guard !retired else { throw MediaFailure.accountChanged }
        if let metadata = manifest.metadata { return metadata }
        try await ensure(MediaByteRange(lower: 0, upper: 1))
        guard let metadata = manifest.metadata else { throw MediaFailure.invalidResponse }
        return metadata
    }

    func read(offset: Int64, count: Int, prioritizing: Bool = true) async throws -> Data {
        guard offset >= 0, count >= 0, count <= Self.blockSize, offset <= Int64.max - Int64(count) else { throw MediaFailure.invalidSource }
        if count == 0 { return Data() }
        let metadata = try await metadata()
        guard let total = metadata.totalBytes else { throw MediaFailure.requiresCompleteFile }
        if offset >= total { return Data() }
        let requested = MediaByteRange(lower: offset, upper: min(total, offset + Int64(count)))
        if !manifest.ranges.contains(where: { $0.contains(requested) }) {
            guard metadata.capability == .randomAccess else { throw MediaFailure.requiresCompleteFile }
            let aligned = offset / Int64(Self.blockSize) * Int64(Self.blockSize)
            let upper = min(total, max(requested.upper, aligned + Int64(Self.blockSize)))
            if prioritizing { readPriority &+= 1 }
            try await ensure(MediaByteRange(lower: aligned, upper: upper), priority: prioritizing ? readPriority : 0)
        }
        try Task.checkCancellation()
        do {
            let file = try FileHandle(forReadingFrom: mediaURL)
            defer { try? file.close() }
            try file.seek(toOffset: UInt64(requested.lower))
            guard let data = try file.read(upToCount: Int(requested.count)), data.count == Int(requested.count) else { throw MediaFailure.storageUnavailable }
            return data
        } catch let error as MediaFailure {
            throw error
        } catch {
            throw MediaFailure.storageUnavailable
        }
    }

    func materialize(progress: @escaping @Sendable (Int64, Int64?) async -> Void = { _, _ in }) async throws -> URL {
        guard !retired else { throw MediaFailure.accountChanged }
        if manifest.isComplete { return mediaURL }
        let metadata = try await metadata()
        if metadata.capability == .completeFileRequired {
            try await ensure(nil)
            await progress(manifest.storedBytes, manifest.metadata?.totalBytes)
        } else {
            guard let total = metadata.totalBytes else { throw MediaFailure.invalidResponse }
            while !manifest.isComplete {
                try Task.checkCancellation()
                var offset: Int64 = 0
                for range in manifest.ranges {
                    if range.lower > offset { break }
                    offset = max(offset, range.upper)
                }
                guard offset < total else { throw MediaFailure.invalidResponse }
                try await ensure(MediaByteRange(lower: offset, upper: min(total, offset + Int64(Self.blockSize))))
                await progress(manifest.storedBytes, total)
            }
        }
        guard manifest.isComplete else { throw MediaFailure.invalidResponse }
        return mediaURL
    }

    func completeFileURL() -> URL? { !retired && manifest.isComplete ? mediaURL : nil }
    func snapshot() -> MediaManifest { manifest }
    func isPinned() -> Bool { pins > 0 }

    func pin() throws {
        guard !retired else { throw MediaFailure.accountChanged }
        manifest.lastAccess = Date()
        try persist()
        pins += 1
    }

    func unpin() { pins = max(0, pins - 1) }

    func markDurable(episode: Episode) throws {
        guard !retired else { throw MediaFailure.accountChanged }
        do {
            try Self.prepareDirectory(directory)
            try JSONEncoder().encode(episode).write(to: directory.appendingPathComponent("episode.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            manifest.durable = true
            try persist()
        } catch {
            throw MediaFailure.storageUnavailable
        }
    }

    func cancel() {
        epoch = UUID()
        transfer?.task.cancel()
        transfer = nil
    }

    func evictIfTransient() throws -> Bool {
        guard !manifest.durable, pins == 0 else { return false }
        try remove()
        return true
    }

    func remove() throws {
        guard pins == 0 else { throw MediaFailure.pinned }
        try retire()
    }

    func retire() throws {
        retired = true
        cancel()
        do {
            if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
            manifest = MediaManifest()
        } catch {
            throw MediaFailure.storageUnavailable
        }
    }

    func restartRepresentation() throws {
        guard pins == 0 else { throw MediaFailure.pinned }
        guard !retired else { throw MediaFailure.accountChanged }
        cancel()
        let durable = manifest.durable
        if FileManager.default.fileExists(atPath: mediaURL.path) { try FileManager.default.removeItem(at: mediaURL) }
        manifest = MediaManifest(durable: durable)
        try persist()
    }

    private var mediaURL: URL { directory.appendingPathComponent("media") }

    private func ensure(_ range: MediaByteRange?, priority: UInt64 = 0) async throws {
        let token = epoch
        while true {
            try Task.checkCancellation()
            guard token == epoch else { throw MediaFailure.cancelled }
            guard !retired else { throw MediaFailure.accountChanged }
            if let range, manifest.ranges.contains(where: { $0.contains(range) }) { return }
            if range == nil, manifest.isComplete { return }
            if let active = transfer {
                if priority > active.priority, let range, active.range?.contains(range) != true {
                    active.task.cancel()
                    transfer = nil
                } else {
                    do {
                        try await Self.awaitTransfer(active.task)
                        if transfer?.id == active.id { transfer = nil }
                    }
                    catch {
                        try Task.checkCancellation()
                        guard token == epoch else { throw MediaFailure.cancelled }
                        if transfer?.id == active.id {
                            transfer = nil
                            throw error
                        }
                    }
                    continue
                }
            }
            let id = UUID()
            let task = Task { try await self.fetch(range: range, token: token) }
            transfer = (id, priority, range, task)
            do {
                try await Self.awaitTransfer(task)
                if transfer?.id == id { transfer = nil }
                return
            } catch {
                try Task.checkCancellation()
                let superseded = transfer?.id != id
                if transfer?.id == id { transfer = nil }
                guard token == epoch else { throw MediaFailure.cancelled }
                if Self.isCancellation(error) {
                    if superseded { continue }
                    throw MediaFailure.cancelled
                }
                throw error
            }
        }
    }

    private static func awaitTransfer(_ task: Task<Void, Error>) async throws {
        let waiter = MediaTransferWaiter()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                waiter.install(continuation)
                Task {
                    do { try await task.value; waiter.finish(.success(())) }
                    catch { waiter.finish(.failure(error)) }
                }
            }
        } onCancel: {
            waiter.finish(.failure(CancellationError()))
        }
    }

    private static func isCancellation(_ error: Error) -> Bool {
        error is CancellationError || (error as? URLError)?.code == .cancelled || error as? MediaFailure == .cancelled
    }

    private func fetch(range: MediaByteRange?, token: UUID) async throws {
        var request = URLRequest(url: locator, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        if let range {
            request.setValue("bytes=\(range.lower)-\(range.upper - 1)", forHTTPHeaderField: "Range")
            if let validator = manifest.metadata?.validator { request.setValue(validator, forHTTPHeaderField: "If-Range") }
        }
        let delegate = MediaTransferLimit(maximumBytes: maximumAssetBytes, requiresRange: range != nil)
        let temporary: URL
        let response: URLResponse
        do {
            (temporary, response) = try await session.download(for: request, delegate: delegate)
        } catch {
            guard token == epoch, !Task.isCancelled else { throw MediaFailure.cancelled }
            if let response = delegate.completeFileResponse {
                try requireCompleteFile(response)
                return
            }
            throw error
        }
        defer { try? FileManager.default.removeItem(at: temporary) }
        guard token == epoch, !Task.isCancelled else { throw MediaFailure.cancelled }
        guard let response = response as? HTTPURLResponse else { throw MediaFailure.invalidResponse }
        guard [200, 206].contains(response.statusCode) else { throw MediaFailure.unavailable(response.statusCode) }
        if response.statusCode == 200, range != nil {
            try requireCompleteFile(response)
            return
        }
        let encoding = response.value(forHTTPHeaderField: "Content-Encoding")?.lowercased()
        guard encoding == nil || encoding == "identity" else { throw MediaFailure.invalidResponse }
        let size = (try FileManager.default.attributesOfItem(atPath: temporary.path)[.size] as? NSNumber)?.int64Value ?? 0
        guard size > 0, size <= maximumAssetBytes else { throw MediaFailure.invalidResponse }
        let validator = Self.validator(response)
        if let old = manifest.metadata?.validator, validator != old { throw MediaFailure.representationChanged }
        let previous = manifest
        do {
            let contentType = response.mimeType
            if response.statusCode == 206 {
                guard let requested = range,
                      let header = response.value(forHTTPHeaderField: "Content-Range"),
                      let parsed = Self.contentRange(header),
                      parsed.range.lower == requested.lower,
                      parsed.range.upper == min(requested.upper, parsed.total),
                      parsed.range.count == size else { throw MediaFailure.invalidResponse }
                if let total = manifest.metadata?.totalBytes, total != parsed.total { throw MediaFailure.representationChanged }
                guard parsed.total <= maximumAssetBytes else { throw MediaFailure.invalidResponse }
                manifest.metadata = MediaMetadata(totalBytes: parsed.total, contentType: contentType, validator: validator, capability: validator == nil ? .completeFileRequired : .randomAccess)
                if validator != nil { try copy(temporary, into: parsed.range) }
            } else {
                if let total = manifest.metadata?.totalBytes, total != size, manifest.metadata?.validator != nil { throw MediaFailure.representationChanged }
                manifest.metadata = MediaMetadata(totalBytes: size, contentType: contentType, validator: validator, capability: .completeFileRequired)
                try copy(temporary, into: MediaByteRange(lower: 0, upper: size))
            }
            manifest.lastAccess = Date()
            try persist()
        } catch {
            manifest = previous
            throw error
        }
    }

    private func requireCompleteFile(_ response: HTTPURLResponse) throws {
        let encoding = response.value(forHTTPHeaderField: "Content-Encoding")?.lowercased()
        guard encoding == nil || encoding == "identity" else { throw MediaFailure.invalidResponse }
        let validator = Self.validator(response)
        if let old = manifest.metadata?.validator, old != validator { throw MediaFailure.representationChanged }
        let total = response.expectedContentLength >= 0 ? response.expectedContentLength : nil
        if let total, total <= 0 || total > maximumAssetBytes { throw MediaFailure.invalidResponse }
        if let previous = manifest.metadata?.totalBytes, let total, previous != total, manifest.metadata?.validator != nil { throw MediaFailure.representationChanged }
        let previous = manifest
        manifest.metadata = MediaMetadata(totalBytes: total, contentType: response.mimeType, validator: validator, capability: .completeFileRequired)
        do { try persist() }
        catch { manifest = previous; throw error }
    }

    private static func validator(_ response: HTTPURLResponse) -> String? {
        let etag = response.value(forHTTPHeaderField: "ETag")?.trimmingCharacters(in: .whitespacesAndNewlines)
        return etag.flatMap { $0.hasPrefix("\"") && $0.hasSuffix("\"") ? $0 : nil }
    }

    private func copy(_ temporary: URL, into range: MediaByteRange) throws {
        do {
            try Self.prepareDirectory(directory)
            if !FileManager.default.fileExists(atPath: mediaURL.path) {
                guard FileManager.default.createFile(atPath: mediaURL.path, contents: nil, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else { throw MediaFailure.storageUnavailable }
            }
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: mediaURL.path)
            let input = try FileHandle(forReadingFrom: temporary)
            let output = try FileHandle(forWritingTo: mediaURL)
            defer { try? input.close(); try? output.close() }
            try output.seek(toOffset: UInt64(range.lower))
            while let chunk = try input.read(upToCount: Self.blockSize), !chunk.isEmpty { try output.write(contentsOf: chunk) }
            manifest.insert(range)
            if manifest.isComplete, let total = manifest.metadata?.totalBytes { try output.truncate(atOffset: UInt64(total)) }
            try output.synchronize()
        } catch {
            throw MediaFailure.storageUnavailable
        }
    }

    private func persist() throws {
        do {
            try Self.prepareDirectory(directory)
            try JSONEncoder().encode(manifest).write(to: directory.appendingPathComponent("manifest.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            throw MediaFailure.storageUnavailable
        }
    }

    static func readManifest(directory: URL) -> MediaManifest {
        guard let data = try? Data(contentsOf: directory.appendingPathComponent("manifest.json")),
              var manifest = try? JSONDecoder().decode(MediaManifest.self, from: data) else { return MediaManifest() }
        let size = ((try? FileManager.default.attributesOfItem(atPath: directory.appendingPathComponent("media").path)[.size]) as? NSNumber)?.int64Value ?? 0
        let total = manifest.metadata?.totalBytes ?? 0
        var previous: Int64 = -1
        let valid = total >= 0 && manifest.ranges.allSatisfy { range in
            defer { previous = range.upper }
            return range.lower >= 0 && range.lower > previous && range.upper > range.lower && range.upper <= size && range.upper <= total
        }
        if !valid || (manifest.ranges.isEmpty && size > 0) {
            manifest.metadata = nil
            manifest.ranges = []
        }
        return manifest
    }

    static func prepareDirectory(_ directory: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var url = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try url.setResourceValues(values)
    }

    private static func contentRange(_ header: String) -> (range: MediaByteRange, total: Int64)? {
        let parts = header.split(separator: " ", omittingEmptySubsequences: true)
        guard parts.count == 2, parts[0].lowercased() == "bytes" else { return nil }
        let totalParts = parts[1].split(separator: "/")
        guard totalParts.count == 2, let total = Int64(totalParts[1]), total > 0 else { return nil }
        let bounds = totalParts[0].split(separator: "-")
        guard bounds.count == 2, let lower = Int64(bounds[0]), let last = Int64(bounds[1]), lower >= 0, last >= lower, last < total else { return nil }
        return (MediaByteRange(lower: lower, upper: last + 1), total)
    }
}

private final class MediaTransferLimit: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let maximumBytes: Int64
    private let requiresRange: Bool
    private let lock = NSLock()
    private var rejectedRangeResponse: HTTPURLResponse?

    init(maximumBytes: Int64, requiresRange: Bool) {
        self.maximumBytes = maximumBytes
        self.requiresRange = requiresRange
    }

    var completeFileResponse: HTTPURLResponse? {
        lock.lock()
        defer { lock.unlock() }
        return rejectedRangeResponse
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {}

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        if requiresRange, let response = downloadTask.response as? HTTPURLResponse, response.statusCode == 200 {
            lock.lock()
            rejectedRangeResponse = response
            lock.unlock()
            downloadTask.cancel()
        }
        if totalBytesWritten > maximumBytes || totalBytesExpectedToWrite > maximumBytes { downloadTask.cancel() }
    }
}

private final class MediaTransferWaiter: @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<Void, Error>?
    private var continuation: CheckedContinuation<Void, Error>?

    func install(_ continuation: CheckedContinuation<Void, Error>) {
        lock.lock()
        if let result {
            lock.unlock()
            continuation.resume(with: result)
        } else {
            self.continuation = continuation
            lock.unlock()
        }
    }

    func finish(_ result: Result<Void, Error>) {
        lock.lock()
        guard self.result == nil else { lock.unlock(); return }
        self.result = result
        let continuation = continuation
        self.continuation = nil
        lock.unlock()
        continuation?.resume(with: result)
    }
}
