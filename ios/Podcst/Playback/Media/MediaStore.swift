import Foundation
import Observation

@MainActor
@Observable
final class MediaStore {
    private(set) var accountID: String?

    var states: [MediaKey: MediaDownloadState] { downloads.states }
    var downloadedEpisodes: [Episode] { downloads.episodes }

    @ObservationIgnored private let rootURL: URL
    @ObservationIgnored private let session: URLSession
    @ObservationIgnored private let quotaBytes: Int64
    @ObservationIgnored private let downloads: BackgroundMediaDownloads
    @ObservationIgnored private var sources: [URL: HTTPMediaByteSource] = [:]
    @ObservationIgnored private var removing: Set<MediaKey> = []
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var purging = false

    init(accountID: String? = nil, rootURL: URL? = nil, session: URLSession = .shared, quotaBytes: Int64 = 512 * 1024 * 1024, downloadConfiguration: URLSessionConfiguration? = nil) {
        let rootURL = rootURL ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Podcst/Media", isDirectory: true)
        self.accountID = accountID
        self.rootURL = rootURL
        self.session = session
        self.quotaBytes = max(0, quotaBytes)
        downloads = BackgroundMediaDownloads(accountID: accountID, rootURL: rootURL.appendingPathComponent("downloads", isDirectory: true), configuration: downloadConfiguration)
    }

    func key(for episode: Episode) -> MediaKey { downloads.key(for: episode) }
    func status(for episode: Episode) -> MediaDownloadState { states[key(for: episode)] ?? .notDownloaded }

    func download(_ episode: Episode) async throws {
        guard !purging, !removing.contains(key(for: episode)) else { throw MediaFailure.accountChanged }
        let token = generation
        try await downloads.download(episode)
        guard generation == token else { throw MediaFailure.accountChanged }
        await trimCache()
    }

    func cancel(_ episode: Episode) async {
        guard !purging, !removing.contains(key(for: episode)) else { return }
        await downloads.pause(episode)
    }

    func retry(_ episode: Episode) async throws { try await download(episode) }

    func remove(_ episode: Episode) async throws {
        let token = generation
        let key = key(for: episode)
        guard !purging, removing.insert(key).inserted else { throw MediaFailure.accountChanged }
        defer { removing.remove(key) }
        let cache = cacheDirectory.appendingPathComponent(key.rawValue, isDirectory: true)
        let complete = completeDirectory(for: key)
        let matching = sources.filter { $0.key == cache || $0.key == complete }
        for source in matching.values {
            if await source.isPinned() { throw MediaFailure.pinned }
            guard generation == token else { throw MediaFailure.accountChanged }
        }
        var cleanupFailed = false
        do { try await downloads.remove(episode) }
        catch {
            if downloads.states[key] != nil { throw error }
            cleanupFailed = true
        }
        guard generation == token else { throw MediaFailure.accountChanged }
        for (directory, source) in matching {
            do { try await source.retire() }
            catch { cleanupFailed = true }
            guard generation == token else { throw MediaFailure.accountChanged }
            sources[directory] = nil
        }
        do { try Self.removeDirectory(cache) }
        catch { cleanupFailed = true }
        if cleanupFailed { throw MediaFailure.storageUnavailable }
    }

    func pin(_ episode: Episode) async throws -> MediaAssetLease {
        let token = generation
        let key = key(for: episode)
        let source = try await source(for: episode)
        try await source.pin()
        guard generation == token, !purging, !removing.contains(key) else {
            await source.unpin()
            throw MediaFailure.accountChanged
        }
        let fileURL = await source.completeFileURL()
        guard generation == token, !purging, !removing.contains(key) else {
            await source.unpin()
            throw MediaFailure.accountChanged
        }
        return MediaAssetLease(key: key, completeFileURL: fileURL, byteSource: source) { [weak self] in
            await self?.trimCache()
        }
    }

    func chapterMetadata(for episode: Episode) async -> ChapterMetadata? {
        guard let lease = try? await pin(episode) else { return nil }
        let result: ChapterMetadata?
        do {
            var data = try await lease.byteSource.read(offset: 0, count: 10, prioritizing: false)
            if let size = ID3Chapters.tagSize(data) {
                while data.count < size {
                    try Task.checkCancellation()
                    let bytes = try await lease.byteSource.read(offset: Int64(data.count), count: min(HTTPMediaByteSource.blockSize, size - data.count), prioritizing: false)
                    guard !bytes.isEmpty else { throw MediaFailure.invalidResponse }
                    data.append(bytes)
                }
                let bytes = data
                result = await Task.detached(priority: .utility) { ID3Chapters.parse(bytes) }.value
            } else { result = nil }
        } catch { result = nil }
        await lease.release()
        return Task.isCancelled ? nil : result
    }

    func switchAccount(to accountID: String?) async throws {
        guard self.accountID != accountID else { return }
        var cleanupFailed = false
        do { try await purge() }
        catch MediaFailure.storageUnavailable { cleanupFailed = true }
        self.accountID = accountID
        generation = UUID()
        downloads.switchAccount(to: accountID)
        if cleanupFailed { throw MediaFailure.storageUnavailable }
    }

    func purge() async throws {
        guard !purging, removing.isEmpty else { throw MediaFailure.accountChanged }
        purging = true
        defer { purging = false }
        for source in sources.values {
            if await source.isPinned() { throw MediaFailure.pinned }
        }
        generation = UUID()
        var cleanupFailed = false
        do { try await downloads.purge() }
        catch { cleanupFailed = true }
        for source in sources.values {
            do { try await source.retire() }
            catch { cleanupFailed = true }
        }
        sources = [:]
        do { try Self.removeDirectory(cacheDirectory) }
        catch { cleanupFailed = true }
        if cleanupFailed { throw MediaFailure.storageUnavailable }
    }

    func reconcileDownloads() async {
        guard !purging else { return }
        await downloads.reconcile()
    }

    func handleBackgroundEvents(identifier: String, completionHandler: @escaping () -> Void) {
        downloads.handleEvents(identifier: identifier, completionHandler: completionHandler)
    }

    func trimCache() async {
        guard !purging else { return }
        let token = generation
        let directories = (try? FileManager.default.contentsOfDirectory(at: cacheDirectory, includingPropertiesForKeys: nil)) ?? []
        var candidates: [(URL, MediaManifest)] = []
        for directory in directories {
            guard let key = Self.diskKey(directory.lastPathComponent), !removing.contains(key) else { continue }
            let snapshot: MediaManifest
            if let source = sources[directory] { snapshot = await source.snapshot() }
            else { snapshot = HTTPMediaByteSource.readManifest(directory: directory) }
            if !snapshot.durable { candidates.append((directory, snapshot)) }
        }
        guard generation == token else { return }
        var total = candidates.reduce(Int64(0)) { $0 + $1.1.storedBytes }
        for (directory, snapshot) in candidates.sorted(by: { $0.1.lastAccess < $1.1.lastAccess }) where total > quotaBytes {
            guard generation == token else { return }
            do {
                if let source = sources[directory] {
                    guard try await source.evictIfTransient() else { continue }
                } else { try Self.removeDirectory(directory) }
                guard generation == token else { return }
                sources[directory] = nil
                total -= snapshot.storedBytes
            } catch {
                continue
            }
        }
    }

    private var cacheDirectory: URL {
        rootURL.appendingPathComponent("cache", isDirectory: true).appendingPathComponent(MediaKey.scope(accountID), isDirectory: true)
    }

    private func completeDirectory(for key: MediaKey) -> URL {
        rootURL.appendingPathComponent("downloads", isDirectory: true)
            .appendingPathComponent(MediaKey.scope(accountID), isDirectory: true)
            .appendingPathComponent(key.rawValue, isDirectory: true)
            .appendingPathComponent("complete", isDirectory: true)
    }

    private func source(for episode: Episode) async throws -> HTTPMediaByteSource {
        let key = key(for: episode)
        guard !purging, !removing.contains(key) else { throw MediaFailure.accountChanged }
        let token = generation
        guard let url = episode.audioURL else { throw MediaFailure.invalidSource }
        let complete = completeDirectory(for: key)
        let directory = DownloadedMediaFile.manifest(in: complete) != nil ? complete : cacheDirectory.appendingPathComponent(key.rawValue, isDirectory: true)
        if let source = sources[directory] {
            try await source.updateLocator(url)
            guard generation == token, !purging, !removing.contains(key) else { throw MediaFailure.accountChanged }
            return source
        }
        let source = try HTTPMediaByteSource(url: url, directory: directory, session: session)
        sources[directory] = source
        return source
    }

    private static func diskKey(_ value: String) -> MediaKey? {
        guard value.count == 64, value.allSatisfy({ $0.isHexDigit && !$0.isUppercase }) else { return nil }
        return MediaKey(rawValue: value)
    }

    private static func removeDirectory(_ directory: URL) throws {
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
    }
}
