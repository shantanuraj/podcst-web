import Foundation
import Observation

@MainActor
@Observable
final class MediaStore {
    private(set) var states: [MediaKey: MediaDownloadState] = [:]
    private(set) var accountID: String?
    private var catalog: [MediaKey: Episode] = [:]

    var downloadedEpisodes: [Episode] { catalog.values.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending } }
    @ObservationIgnored private let rootURL: URL
    @ObservationIgnored private let session: URLSession
    @ObservationIgnored private let quotaBytes: Int64
    @ObservationIgnored private var sources: [MediaKey: HTTPMediaByteSource] = [:]
    @ObservationIgnored private var downloads: [MediaKey: (id: UUID, task: Task<Void, Error>)] = [:]
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var purging = false

    init(accountID: String? = nil, rootURL: URL? = nil, session: URLSession = .shared, quotaBytes: Int64 = 512 * 1024 * 1024) {
        self.accountID = accountID
        self.rootURL = rootURL ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Podcst/Media", isDirectory: true)
        self.session = session
        self.quotaBytes = max(0, quotaBytes)
        restoreStates()
    }

    func key(for episode: Episode) -> MediaKey { MediaKey(accountID: accountID, episode: episode) }
    func status(for episode: Episode) -> MediaDownloadState { states[key(for: episode)] ?? .notDownloaded }

    func download(_ episode: Episode) async throws {
        let token = generation
        let key = key(for: episode)
        if let existing = downloads[key] { return try await existing.task.value }
        guard !purging else { throw MediaFailure.accountChanged }
        catalog[key] = episode
        states[key] = .downloading(received: 0, total: nil)
        let id = UUID()
        let task = Task { @MainActor [weak self] in
            guard let self else { throw MediaFailure.cancelled }
            var source: HTTPMediaByteSource?
            do {
                try Task.checkCancellation()
                let asset = try await self.source(for: episode)
                source = asset
                try Task.checkCancellation()
                guard self.generation == token, self.downloads[key]?.id == id else { throw MediaFailure.cancelled }
                try await asset.markDurable(episode: episode)
                let snapshot = await asset.snapshot()
                try Task.checkCancellation()
                guard self.generation == token, self.downloads[key]?.id == id else { throw MediaFailure.cancelled }
                self.catalog[key] = episode
                self.states[key] = .downloading(received: snapshot.storedBytes, total: snapshot.metadata?.totalBytes)
                _ = try await asset.materialize { [weak self] received, total in
                    await self?.updateProgress(key: key, id: id, generation: token, received: received, total: total)
                }
                try Task.checkCancellation()
                let completed = await asset.snapshot()
                guard self.generation == token else { throw MediaFailure.accountChanged }
                if self.downloads[key]?.id == id {
                    self.downloads[key] = nil
                    self.states[key] = .available(bytes: completed.storedBytes)
                }
                await self.trimCache()
            } catch {
                let failure = Self.failure(error)
                let snapshot = await source?.snapshot()
                if self.generation == token, self.downloads[key]?.id == id {
                    self.downloads[key] = nil
                    self.states[key] = failure == .cancelled ? .paused(received: snapshot?.storedBytes ?? 0, total: snapshot?.metadata?.totalBytes) : .failed(failure)
                }
                throw failure
            }
        }
        downloads[key] = (id, task)
        try await task.value
    }

    func cancel(_ episode: Episode) async {
        let key = key(for: episode)
        guard let download = downloads.removeValue(forKey: key) else { return }
        download.task.cancel()
        guard let source = sources[key] else {
            states[key] = .paused(received: 0, total: nil)
            return
        }
        let token = generation
        let pinned = await source.isPinned()
        guard generation == token, downloads[key] == nil else { return }
        if !pinned { await source.cancel() }
        let snapshot = await source.snapshot()
        guard generation == token, downloads[key] == nil else { return }
        states[key] = .paused(received: snapshot.storedBytes, total: snapshot.metadata?.totalBytes)
    }

    func retry(_ episode: Episode) async throws {
        if status(for: episode) == .failed(.representationChanged) {
            let source = try await source(for: episode)
            try await source.restartRepresentation()
        }
        try await download(episode)
    }

    func remove(_ episode: Episode) async throws {
        let token = generation
        let key = key(for: episode)
        let source = sources[key]
        if let source, await source.isPinned() { throw MediaFailure.pinned }
        guard generation == token else { throw MediaFailure.accountChanged }
        await cancel(episode)
        guard generation == token else { throw MediaFailure.accountChanged }
        if let source { try await source.remove() }
        else {
            let directory = accountDirectory.appendingPathComponent(key.rawValue, isDirectory: true)
            do {
                if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
            } catch { throw MediaFailure.storageUnavailable }
        }
        guard generation == token else { throw MediaFailure.accountChanged }
        sources[key] = nil
        states[key] = nil
        catalog[key] = nil
    }

    func pin(_ episode: Episode) async throws -> MediaAssetLease {
        let token = generation
        let key = key(for: episode)
        let source = try await source(for: episode)
        try await source.pin()
        guard generation == token, !purging else {
            await source.unpin()
            throw MediaFailure.accountChanged
        }
        let fileURL = await source.completeFileURL()
        guard generation == token, !purging else {
            await source.unpin()
            throw MediaFailure.accountChanged
        }
        return MediaAssetLease(key: key, completeFileURL: fileURL, byteSource: source) { [weak self] in
            await self?.trimCache()
        }
    }

    func switchAccount(to accountID: String?) async throws {
        guard self.accountID != accountID else { return }
        var cleanupFailed = false
        do { try await purge() }
        catch MediaFailure.storageUnavailable { cleanupFailed = true }
        self.accountID = accountID
        generation = UUID()
        restoreStates()
        if cleanupFailed { throw MediaFailure.storageUnavailable }
    }

    func purge() async throws {
        guard !purging else { throw MediaFailure.accountChanged }
        purging = true
        defer { purging = false }
        for source in sources.values {
            if await source.isPinned() { throw MediaFailure.pinned }
        }
        generation = UUID()
        for download in downloads.values { download.task.cancel() }
        downloads = [:]
        var cleanupFailed = false
        for source in sources.values {
            do { try await source.retire() }
            catch { cleanupFailed = true }
        }
        sources = [:]
        states = [:]
        catalog = [:]
        do {
            if FileManager.default.fileExists(atPath: accountDirectory.path) { try FileManager.default.removeItem(at: accountDirectory) }
        } catch { cleanupFailed = true }
        if cleanupFailed { throw MediaFailure.storageUnavailable }
    }

    func trimCache() async {
        guard !purging else { return }
        let token = generation
        let directories = (try? FileManager.default.contentsOfDirectory(at: accountDirectory, includingPropertiesForKeys: nil)) ?? []
        var candidates: [(MediaKey, URL, MediaManifest)] = []
        for directory in directories {
            guard let key = Self.diskKey(directory.lastPathComponent) else { continue }
            let snapshot: MediaManifest
            if let source = sources[key] { snapshot = await source.snapshot() }
            else { snapshot = HTTPMediaByteSource.readManifest(directory: directory) }
            if !snapshot.durable { candidates.append((key, directory, snapshot)) }
        }
        guard generation == token else { return }
        var total = candidates.reduce(Int64(0)) { $0 + $1.2.storedBytes }
        for (key, directory, snapshot) in candidates.sorted(by: { $0.2.lastAccess < $1.2.lastAccess }) where total > quotaBytes {
            guard generation == token else { return }
            do {
                if let source = sources[key] {
                    guard try await source.evictIfTransient() else { continue }
                } else { try FileManager.default.removeItem(at: directory) }
                guard generation == token else { return }
                sources[key] = nil
                states[key] = nil
                total -= snapshot.storedBytes
            } catch {
                continue
            }
        }
    }

    private var accountDirectory: URL { rootURL.appendingPathComponent(MediaKey.scope(accountID), isDirectory: true) }

    private func source(for episode: Episode) async throws -> HTTPMediaByteSource {
        guard !purging else { throw MediaFailure.accountChanged }
        let token = generation
        guard let url = episode.audioURL else { throw MediaFailure.invalidSource }
        let key = key(for: episode)
        if let source = sources[key] {
            try await source.updateLocator(url)
            guard generation == token else { throw MediaFailure.accountChanged }
            return source
        }
        let source = try HTTPMediaByteSource(url: url, directory: accountDirectory.appendingPathComponent(key.rawValue, isDirectory: true), session: session)
        sources[key] = source
        return source
    }

    private func restoreStates() {
        let directories = (try? FileManager.default.contentsOfDirectory(at: accountDirectory, includingPropertiesForKeys: nil)) ?? []
        for directory in directories {
            guard let key = Self.diskKey(directory.lastPathComponent) else { continue }
            let manifest = HTTPMediaByteSource.readManifest(directory: directory)
            guard manifest.durable,
                  let data = try? Data(contentsOf: directory.appendingPathComponent("episode.json")),
                  let episode = try? JSONDecoder().decode(Episode.self, from: data),
                  self.key(for: episode) == key else { continue }
            catalog[key] = episode
            states[key] = manifest.isComplete ? .available(bytes: manifest.storedBytes) : .paused(received: manifest.storedBytes, total: manifest.metadata?.totalBytes)
        }
    }

    private func updateProgress(key: MediaKey, id: UUID, generation: UUID, received: Int64, total: Int64?) {
        guard self.generation == generation, downloads[key]?.id == id else { return }
        states[key] = .downloading(received: received, total: total)
    }

    private static func diskKey(_ value: String) -> MediaKey? {
        guard value.count == 64, value.allSatisfy({ $0.isHexDigit && !$0.isUppercase }) else { return nil }
        return MediaKey(rawValue: value)
    }

    private static func failure(_ error: Error) -> MediaFailure {
        if let error = error as? MediaFailure { return error }
        if error is CancellationError || (error as? URLError)?.code == .cancelled { return .cancelled }
        return .invalidResponse
    }
}
