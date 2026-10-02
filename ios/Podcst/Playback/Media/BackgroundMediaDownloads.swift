import Foundation
import Network
import Observation
import UIKit

struct MediaDownloadRecord: Codable {
    enum Intent: Codable, Equatable {
        case requested
        case paused
        case failed(MediaFailure)
    }

    var episode: Episode
    var id = UUID()
    var intent: Intent = .requested
    var resumeData: Data?
    var received: Int64 = 0
    var total: Int64?
}

@MainActor
@Observable
final class BackgroundMediaDownloads {
    private(set) var states: [MediaKey: MediaDownloadState] = [:]
    private var records: [MediaKey: MediaDownloadRecord] = [:]
    var episodes: [Episode] { records.values.map(\.episode).sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending } }

    @ObservationIgnored private let rootURL: URL
    @ObservationIgnored private var accountID: String?
    @ObservationIgnored private let configuration: URLSessionConfiguration
    @ObservationIgnored private var session: URLSession?
    @ObservationIgnored private let delegate = MediaDownloadDelegate()
    @ObservationIgnored private var tasks: [MediaKey: URLSessionDownloadTask] = [:]
    @ObservationIgnored private var recoveryRequests: Set<Int> = []
    @ObservationIgnored private var waiters: [UUID: [CheckedContinuation<Void, Error>]] = [:]
    @ObservationIgnored private var pauses: [MediaKey: Task<Void, Never>] = [:]
    @ObservationIgnored private var reconciliation: Task<Void, Never>?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var purging = false
    @ObservationIgnored private var removing: Set<MediaKey> = []
    @ObservationIgnored private var removalRevisions: [MediaKey: UUID] = [:]
    @ObservationIgnored private var completionHandler: (() -> Void)?
    @ObservationIgnored private let monitor = NWPathMonitor()

    init(accountID: String?, rootURL: URL, configuration: URLSessionConfiguration? = nil) {
        self.accountID = accountID
        self.rootURL = rootURL
        let configuration = configuration ?? Self.backgroundConfiguration()
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        self.configuration = configuration
        restore()
        delegate.owner = self
    }

    private func connect() -> URLSession {
        if let session { return session }
        let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: .main)
        self.session = session
        if configuration.identifier != nil {
            monitor.pathUpdateHandler = { [weak self] path in
                guard path.status == .satisfied else { return }
                Task { @MainActor [weak self] in await self?.reconcile() }
            }
            monitor.start(queue: DispatchQueue(label: "app.podcst.download-connectivity"))
        }
        return session
    }

    static func backgroundConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.background(withIdentifier: (Bundle.main.bundleIdentifier ?? "app.podcst.ios") + ".media-downloads")
        configuration.sessionSendsLaunchEvents = true
        configuration.isDiscretionary = false
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForResource = 7 * 24 * 60 * 60
        return configuration
    }

    func reconcile() async {
        guard !purging else { return }
        if let reconciliation { await reconciliation.value; return }
        let work = Task { await restoreTasks() }
        reconciliation = work
        await work.value
        reconciliation = nil
    }

    func download(_ episode: Episode) async throws {
        let token = generation
        let key = key(for: episode)
        let revision = removalRevisions[key]
        await reconcile()
        await pauses[key]?.value
        guard token == generation, !purging, !removing.contains(key), removalRevisions[key] == revision else { throw MediaFailure.accountChanged }
        if case .available = states[key] { return }
        if tasks[key] == nil {
            var record = records[key] ?? MediaDownloadRecord(episode: episode)
            if record.episode.audioURL != episode.audioURL { record.resumeData = nil }
            record.episode = episode
            record.intent = .requested
            records[key] = record
            try start(key)
        }
        guard let id = records[key]?.id else { throw MediaFailure.cancelled }
        try await withCheckedThrowingContinuation { waiters[id, default: []].append($0) }
    }

    func pause(_ episode: Episode) async {
        let token = generation
        guard !purging else { return }
        let key = key(for: episode)
        if let pause = pauses[key] { await pause.value; return }
        guard var record = records[key], DownloadedMediaFile.manifest(in: completeDirectory(key)) == nil else { return }
        let active = tasks.removeValue(forKey: key)
        if let active { recoveryRequests.remove(active.taskIdentifier) }
        record.intent = .paused
        if case .downloading(let received, let total) = states[key] {
            record.received = received
            record.total = total
        }
        records[key] = record
        states[key] = .paused(received: record.received, total: record.total)
        do { try persist(key) }
        catch { states[key] = .failed(.storageUnavailable) }
        finish(record.id, result: .failure(MediaFailure.cancelled))
        let id = record.id
        let pause = Task { [weak self] in
            guard let self else { return }
            defer { if self.generation == token { self.pauses[key] = nil } }
            let task: URLSessionDownloadTask?
            if let active { task = active }
            else {
                let existing = await self.connect().allTasks
                task = existing.first { self.matching($0) == key } as? URLSessionDownloadTask
            }
            guard let task else { return }
            let data = await withCheckedContinuation { continuation in
                task.cancel { continuation.resume(returning: $0) }
            }
            guard self.generation == token, self.records[key]?.id == id, self.records[key]?.intent == .paused else { return }
            self.records[key]?.resumeData = data
            if data == nil { self.records[key]?.received = 0 }
            do { try self.persist(key) }
            catch { self.states[key] = .failed(.storageUnavailable); return }
            self.states[key] = .paused(received: self.records[key]?.received ?? 0, total: self.records[key]?.total)
        }
        pauses[key] = pause
        await pause.value
    }

    func remove(_ episode: Episode) async throws {
        let token = generation
        let key = key(for: episode)
        guard !purging, removing.insert(key).inserted else { throw MediaFailure.accountChanged }
        defer { removing.remove(key) }
        removalRevisions[key] = UUID()
        await pause(episode)
        guard generation == token, !purging else { throw MediaFailure.accountChanged }
        let removed = accountDirectory.appendingPathComponent(".removed-\(UUID())", isDirectory: true)
        if FileManager.default.fileExists(atPath: directory(key).path) {
            do { try FileManager.default.moveItem(at: directory(key), to: removed) }
            catch { throw MediaFailure.storageUnavailable }
        }
        records[key] = nil
        states[key] = nil
        do { try removeDirectory(removed) }
        catch { throw MediaFailure.storageUnavailable }
    }

    func purge() async throws {
        guard !purging, removing.isEmpty else { throw MediaFailure.accountChanged }
        purging = true
        defer { purging = false }
        generation = UUID()
        await reconciliation?.value
        let existing = await connect().allTasks
        for task in existing { task.cancel() }
        tasks = [:]
        recoveryRequests = []
        for id in Array(waiters.keys) { finish(id, result: .failure(MediaFailure.accountChanged)) }
        records = [:]
        states = [:]
        removalRevisions = [:]
        for pause in pauses.values { await pause.value }
        pauses = [:]
        do { try removeDirectory(accountDirectory) }
        catch { throw MediaFailure.storageUnavailable }
    }

    func switchAccount(to accountID: String?) {
        self.accountID = accountID
        generation = UUID()
        restore()
        Task { [weak self] in await self?.reconcile() }
    }

    func handleEvents(identifier: String, completionHandler: @escaping () -> Void) {
        guard identifier == configuration.identifier else { completionHandler(); return }
        self.completionHandler = completionHandler
        _ = connect()
    }

    fileprivate func finishedEvents() {
        let completion = completionHandler
        completionHandler = nil
        completion?()
    }

    fileprivate func progress(_ task: URLSessionDownloadTask, received: Int64, expected: Int64) {
        guard let key = matching(task), records[key]?.intent == .requested else { return }
        if received > DownloadedMediaFile.maximumBytes || expected > DownloadedMediaFile.maximumBytes {
            fail(key, error: .invalidResponse)
            task.cancel()
            return
        }
        states[key] = .downloading(received: max(0, received), total: expected > 0 ? expected : nil)
    }

    fileprivate func received(_ task: URLSessionDownloadTask, location: URL) {
        guard let key = matching(task), records[key]?.intent == .requested else { return }
        if case .available = states[key] { return }
        do {
            let manifest = try DownloadedMediaFile.install(from: location, response: task.response as? HTTPURLResponse, in: completeDirectory(key))
            records[key]?.resumeData = nil
            try? persist(key)
            states[key] = .available(bytes: manifest.storedBytes)
            tasks[key] = nil
            recoveryRequests.remove(task.taskIdentifier)
            if let id = records[key]?.id { finish(id, result: .success(())) }
        } catch {
            let failure = error as? MediaFailure ?? .storageUnavailable
            let wasResuming = records[key]?.resumeData != nil
            records[key]?.resumeData = nil
            if wasResuming, failure == .invalidResponse || failure == .unavailable(416) {
                records[key]?.received = 0
                records[key]?.total = nil
                try? start(key)
            } else {
                fail(key, error: failure)
            }
        }
    }

    fileprivate func completed(_ task: URLSessionTask, error: Error?) {
        guard let key = matching(task), records[key]?.intent == .requested else { return }
        let recoveryRequested = recoveryRequests.remove(task.taskIdentifier) != nil
        if case .available = states[key] { return }
        tasks[key] = nil
        guard let failure = error else { fail(key, error: .invalidResponse); return }
        let error = failure as NSError
        let wasResuming = records[key]?.resumeData != nil
        let resumeData = error.userInfo[NSURLSessionDownloadTaskResumeData] as? Data
        records[key]?.resumeData = resumeData
        if case .downloading(let received, let total) = states[key] {
            records[key]?.received = resumeData == nil ? 0 : received
            records[key]?.total = total
        }
        if error.domain == NSURLErrorDomain, Self.interruptedCodes.contains(error.code) {
            do {
                try persist(key)
                if recoveryRequested {
                    try start(key)
                    return
                }
                states[key] = .paused(received: records[key]?.received ?? 0, total: records[key]?.total)
                if let id = records[key]?.id { finish(id, result: .failure(MediaFailure.cancelled)) }
            } catch { fail(key, error: .storageUnavailable) }
        } else if wasResuming, error.domain == NSURLErrorDomain {
            records[key]?.resumeData = nil
            records[key]?.received = 0
            records[key]?.total = nil
            try? start(key)
        } else {
            fail(key, error: .invalidResponse)
        }
    }

    private static let interruptedCodes: Set<Int> = [NSURLErrorCancelled, NSURLErrorTimedOut, NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost, NSURLErrorNetworkConnectionLost, NSURLErrorDNSLookupFailed, NSURLErrorNotConnectedToInternet, NSURLErrorInternationalRoamingOff, NSURLErrorCallIsActive, NSURLErrorDataNotAllowed, NSURLErrorBackgroundSessionWasDisconnected]

    private func restoreTasks() async {
        let token = generation
        let existing = await connect().allTasks
        guard token == generation, !purging else { return }
        var adopted: [MediaKey: URLSessionDownloadTask] = [:]
        for task in existing {
            guard let download = task as? URLSessionDownloadTask, let key = matching(task),
                  records[key]?.intent == .requested, adopted[key] == nil,
                  DownloadedMediaFile.manifest(in: completeDirectory(key)) == nil,
                  task.state != .canceling, task.state != .completed else { task.cancel(); continue }
            if tasks[key]?.taskIdentifier != download.taskIdentifier {
                var received = download.countOfBytesReceived
                var expected = download.countOfBytesExpectedToReceive
                if let response = download.response as? HTTPURLResponse, response.statusCode == 206,
                   let header = response.value(forHTTPHeaderField: "Content-Range"),
                   let range = DownloadedMediaFile.contentRange(header) {
                    expected = range.total
                    if range.total <= DownloadedMediaFile.maximumBytes { received += range.lower }
                } else if download.response == nil, records[key]?.resumeData != nil {
                    received = max(received, records[key]?.received ?? 0)
                    expected = records[key]?.total ?? expected
                }
                progress(download, received: received, expected: expected)
            }
            guard records[key]?.intent == .requested else { continue }
            adopted[key] = download
            recoveryRequests.insert(download.taskIdentifier)
            if download.state == .suspended { download.resume() }
        }
        tasks = adopted
        recoveryRequests.formIntersection(adopted.values.map(\.taskIdentifier))
        for key in Array(records.keys) where tasks[key] == nil && records[key]?.intent == .requested && !removing.contains(key) {
            if let manifest = DownloadedMediaFile.manifest(in: completeDirectory(key)) {
                states[key] = .available(bytes: manifest.storedBytes)
            } else {
                try? start(key)
            }
        }
    }

    private func start(_ key: MediaKey) throws {
        guard var record = records[key] else { throw MediaFailure.cancelled }
        guard let url = record.episode.audioURL, ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
            fail(key, error: .invalidSource)
            throw MediaFailure.invalidSource
        }
        let previousID = record.id
        record.id = UUID()
        if record.resumeData == nil { record.received = 0; record.total = nil }
        if let pending = waiters.removeValue(forKey: previousID) { waiters[record.id] = pending }
        records[key] = record
        do {
            try persist(key)
            try removeDirectory(completeDirectory(key))
        } catch {
            fail(key, error: .storageUnavailable)
            throw MediaFailure.storageUnavailable
        }
        let task: URLSessionDownloadTask
        let session = connect()
        if let data = record.resumeData {
            task = session.downloadTask(withResumeData: data)
        } else {
            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
            request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
            task = session.downloadTask(with: request)
        }
        task.taskDescription = descriptor(key, id: record.id)
        tasks[key] = task
        states[key] = .downloading(received: record.received, total: record.total)
        task.resume()
    }

    private func fail(_ key: MediaKey, error: MediaFailure) {
        records[key]?.intent = .failed(error)
        if let task = tasks[key] { recoveryRequests.remove(task.taskIdentifier) }
        tasks[key] = nil
        do { try persist(key); states[key] = .failed(error) }
        catch { states[key] = .failed(.storageUnavailable) }
        if let id = records[key]?.id { finish(id, result: .failure(error)) }
    }

    private func finish(_ id: UUID, result: Result<Void, Error>) {
        for waiter in waiters.removeValue(forKey: id) ?? [] { waiter.resume(with: result) }
    }

    private var accountDirectory: URL { rootURL.appendingPathComponent(MediaKey.scope(accountID), isDirectory: true) }
    private func key(for episode: Episode) -> MediaKey { MediaKey(accountID: accountID, episode: episode) }
    private func directory(_ key: MediaKey) -> URL { accountDirectory.appendingPathComponent(key.rawValue, isDirectory: true) }
    private func completeDirectory(_ key: MediaKey) -> URL { directory(key).appendingPathComponent("complete", isDirectory: true) }
    private func descriptor(_ key: MediaKey, id: UUID) -> String { "\(MediaKey.scope(accountID))/\(key.rawValue)/\(id.uuidString)" }

    private func matching(_ task: URLSessionTask) -> MediaKey? {
        guard !purging, let description = task.taskDescription else { return nil }
        let parts = description.split(separator: "/")
        guard parts.count == 3, parts[0] == MediaKey.scope(accountID) else { return nil }
        let key = MediaKey(rawValue: String(parts[1]))
        guard let record = records[key], description == descriptor(key, id: record.id) else { return nil }
        if let active = tasks[key], active.taskIdentifier != task.taskIdentifier { return nil }
        return key
    }

    private func persist(_ key: MediaKey) throws {
        guard let record = records[key] else { return }
        try HTTPMediaByteSource.prepareDirectory(directory(key))
        try JSONEncoder().encode(record).write(to: directory(key).appendingPathComponent("transfer.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private func restore() {
        records = [:]
        states = [:]
        let directories = (try? FileManager.default.contentsOfDirectory(at: accountDirectory, includingPropertiesForKeys: nil)) ?? []
        for directory in directories {
            if directory.lastPathComponent.hasPrefix(".removed-") {
                try? removeDirectory(directory)
                continue
            }
            guard let data = try? Data(contentsOf: directory.appendingPathComponent("transfer.json")),
                  let record = try? JSONDecoder().decode(MediaDownloadRecord.self, from: data),
                  key(for: record.episode).rawValue == directory.lastPathComponent else { continue }
            let key = key(for: record.episode)
            records[key] = record
            if let manifest = DownloadedMediaFile.manifest(in: completeDirectory(key)) {
                states[key] = .available(bytes: manifest.storedBytes)
            } else if case .failed(let failure) = record.intent {
                states[key] = .failed(failure)
            } else {
                states[key] = .paused(received: record.received, total: record.total)
            }
        }
    }

    private func removeDirectory(_ directory: URL) throws {
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
    }

    deinit {
        monitor.cancel()
        session?.finishTasksAndInvalidate()
    }
}

@MainActor
private final class MediaDownloadDelegate: NSObject, @preconcurrency URLSessionDownloadDelegate {
    weak var owner: BackgroundMediaDownloads?

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        owner?.received(downloadTask, location: location)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        owner?.progress(downloadTask, received: totalBytesWritten, expected: totalBytesExpectedToWrite)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didResumeAtOffset fileOffset: Int64, expectedTotalBytes: Int64) {
        owner?.progress(downloadTask, received: fileOffset, expected: expectedTotalBytes)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        owner?.completed(task, error: error)
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        owner?.finishedEvents()
    }
}

@MainActor
final class MediaDownloadAppDelegate: NSObject, UIApplicationDelegate {
    var media: MediaStore?

    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        guard let media else { completionHandler(); return }
        media.handleBackgroundEvents(identifier: identifier, completionHandler: completionHandler)
    }
}
