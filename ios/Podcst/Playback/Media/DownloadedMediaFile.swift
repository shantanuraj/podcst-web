import Foundation

enum DownloadedMediaFile {
    static let maximumBytes: Int64 = 4 * 1024 * 1024 * 1024

    static func manifest(in directory: URL) -> MediaManifest? {
        let manifest = HTTPMediaByteSource.readManifest(directory: directory)
        guard manifest.isComplete,
              let total = manifest.metadata?.totalBytes,
              total <= maximumBytes,
              let attributes = try? FileManager.default.attributesOfItem(atPath: directory.appendingPathComponent("media").path),
              attributes[.type] as? FileAttributeType == .typeRegular,
              (attributes[.size] as? NSNumber)?.int64Value == total else { return nil }
        return manifest
    }

    static func install(from temporary: URL, response: HTTPURLResponse?, in directory: URL) throws -> MediaManifest {
        guard let response else { throw MediaFailure.invalidResponse }
        guard [200, 206].contains(response.statusCode) else { throw MediaFailure.unavailable(response.statusCode) }
        let encoding = response.value(forHTTPHeaderField: "Content-Encoding")?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard encoding == nil || encoding == "identity" else { throw MediaFailure.invalidResponse }
        let attributes: [FileAttributeKey: Any]
        do { attributes = try FileManager.default.attributesOfItem(atPath: temporary.path) }
        catch { throw MediaFailure.storageUnavailable }
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              let size = (attributes[.size] as? NSNumber)?.int64Value,
              size > 0, size <= maximumBytes else { throw MediaFailure.invalidResponse }
        let lengthHeader = response.value(forHTTPHeaderField: "Content-Length")
        let length = lengthHeader.flatMap { integer($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
        if lengthHeader != nil, length == nil { throw MediaFailure.invalidResponse }
        if response.statusCode == 200 {
            guard length == nil || length == size,
                  response.expectedContentLength < 0 || response.expectedContentLength == size else { throw MediaFailure.invalidResponse }
        } else {
            guard let header = response.value(forHTTPHeaderField: "Content-Range"),
                  let suffix = contentRange(header),
                  suffix.total == size,
                  suffix.last == size - 1,
                  length == nil || length == size - suffix.lower else { throw MediaFailure.invalidResponse }
        }
        let etag = response.value(forHTTPHeaderField: "ETag")?.trimmingCharacters(in: .whitespacesAndNewlines)
        let validator = etag.flatMap { $0.hasPrefix("\"") && $0.hasSuffix("\"") ? $0 : nil }
        let manifest = MediaManifest(
            metadata: MediaMetadata(totalBytes: size, contentType: response.mimeType, validator: validator, capability: .completeFileRequired),
            ranges: [MediaByteRange(lower: 0, upper: size)],
            durable: true
        )
        let manager = FileManager.default
        guard !manager.fileExists(atPath: directory.path) else { throw MediaFailure.storageUnavailable }
        let stage = directory.deletingLastPathComponent().appendingPathComponent(".download-\(UUID())", isDirectory: true)
        defer { try? manager.removeItem(at: stage) }
        do {
            try HTTPMediaByteSource.prepareDirectory(stage)
            let media = stage.appendingPathComponent("media")
            try manager.moveItem(at: temporary, to: media)
            try manager.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: media.path)
            let file = try FileHandle(forWritingTo: media)
            defer { try? file.close() }
            try file.synchronize()
            try JSONEncoder().encode(manifest).write(to: stage.appendingPathComponent("manifest.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            try manager.moveItem(at: stage, to: directory)
        } catch {
            throw MediaFailure.storageUnavailable
        }
        return manifest
    }

    static func contentRange(_ header: String) -> (lower: Int64, last: Int64, total: Int64)? {
        let parts = header.split(whereSeparator: { $0 == " " || $0 == "\t" })
        guard parts.count == 2, parts[0].lowercased() == "bytes" else { return nil }
        let totalParts = parts[1].split(separator: "/", omittingEmptySubsequences: false)
        guard totalParts.count == 2, let total = integer(String(totalParts[1])), total > 0 else { return nil }
        let bounds = totalParts[0].split(separator: "-", omittingEmptySubsequences: false)
        guard bounds.count == 2,
              let lower = integer(String(bounds[0])),
              let last = integer(String(bounds[1])),
              lower <= last, last < total else { return nil }
        return (lower, last, total)
    }

    private static func integer(_ value: String) -> Int64? {
        guard !value.isEmpty, value.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }) else { return nil }
        return Int64(value)
    }
}
