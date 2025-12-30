import Foundation
import SwiftData

@Observable
final class DownloadService: NSObject {
    private var session: URLSession!
    private let modelContext: ModelContext
    private var activeDownloads: [Int: URLSessionDownloadTask] = [:]
    private var continuations: [Int: CheckedContinuation<URL, Error>] = [:]

    var downloadProgress: [Int: Double] = [:]

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
        super.init()

        let config = URLSessionConfiguration.background(withIdentifier: "com.podcst.downloads")
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        self.session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    func download(_ episode: Episode) async throws -> URL {
        guard let episodeId = episode.id, let url = episode.audioURL else {
            throw DownloadError.invalidEpisode
        }

        if let existingURL = localURL(for: episodeId) {
            return existingURL
        }

        return try await withCheckedThrowingContinuation { continuation in
            continuations[episodeId] = continuation

            let task = session.downloadTask(with: url)
            task.taskDescription = String(episodeId)
            activeDownloads[episodeId] = task
            downloadProgress[episodeId] = 0
            task.resume()
        }
    }

    func cancelDownload(_ episodeId: Int) {
        activeDownloads[episodeId]?.cancel()
        activeDownloads.removeValue(forKey: episodeId)
        downloadProgress.removeValue(forKey: episodeId)
        continuations.removeValue(forKey: episodeId)
    }

    func deleteDownload(_ episodeId: Int) throws {
        let predicate = #Predicate<DownloadedEpisode> { $0.episodeId == episodeId }
        let descriptor = FetchDescriptor(predicate: predicate)

        if let download = try modelContext.fetch(descriptor).first {
            if let localURL = download.localURL {
                try? FileManager.default.removeItem(at: localURL)
            }
            modelContext.delete(download)
            try modelContext.save()
        }
    }

    func deleteAllDownloads() throws {
        let descriptor = FetchDescriptor<DownloadedEpisode>()
        let downloads = try modelContext.fetch(descriptor)

        for download in downloads {
            if let localURL = download.localURL {
                try? FileManager.default.removeItem(at: localURL)
            }
            modelContext.delete(download)
        }

        try modelContext.save()
    }

    func isDownloaded(_ episodeId: Int) -> Bool {
        localURL(for: episodeId) != nil
    }

    func isDownloading(_ episodeId: Int) -> Bool {
        activeDownloads[episodeId] != nil
    }

    func localURL(for episodeId: Int) -> URL? {
        let predicate = #Predicate<DownloadedEpisode> { $0.episodeId == episodeId }
        let descriptor = FetchDescriptor(predicate: predicate)

        guard let download = try? modelContext.fetch(descriptor).first,
              let url = download.localURL,
              FileManager.default.fileExists(atPath: url.path) else {
            return nil
        }

        return url
    }

    private func documentsDirectory() -> URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    private func destinationURL(for episodeId: Int) -> URL {
        documentsDirectory()
            .appendingPathComponent("Downloads", isDirectory: true)
            .appendingPathComponent("\(episodeId).mp3")
    }
}

extension DownloadService: URLSessionDownloadDelegate {
    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        guard let episodeIdString = downloadTask.taskDescription,
              let episodeId = Int(episodeIdString) else { return }

        let destinationURL = destinationURL(for: episodeId)

        do {
            let directory = destinationURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

            if FileManager.default.fileExists(atPath: destinationURL.path) {
                try FileManager.default.removeItem(at: destinationURL)
            }

            try FileManager.default.moveItem(at: location, to: destinationURL)

            let attributes = try FileManager.default.attributesOfItem(atPath: destinationURL.path)
            let fileSize = attributes[.size] as? Int64 ?? 0

            let relativePath = "Downloads/\(episodeId).mp3"
            let download = DownloadedEpisode(
                episodeId: episodeId,
                podcastId: 0,
                localPath: relativePath,
                fileSize: fileSize
            )

            DispatchQueue.main.async { [weak self] in
                self?.modelContext.insert(download)
                try? self?.modelContext.save()

                self?.activeDownloads.removeValue(forKey: episodeId)
                self?.downloadProgress.removeValue(forKey: episodeId)
                self?.continuations[episodeId]?.resume(returning: destinationURL)
                self?.continuations.removeValue(forKey: episodeId)
            }
        } catch {
            DispatchQueue.main.async { [weak self] in
                self?.activeDownloads.removeValue(forKey: episodeId)
                self?.downloadProgress.removeValue(forKey: episodeId)
                self?.continuations[episodeId]?.resume(throwing: error)
                self?.continuations.removeValue(forKey: episodeId)
            }
        }
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        guard let episodeIdString = downloadTask.taskDescription,
              let episodeId = Int(episodeIdString),
              totalBytesExpectedToWrite > 0 else { return }

        let progress = Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)

        DispatchQueue.main.async { [weak self] in
            self?.downloadProgress[episodeId] = progress
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        guard let error,
              let downloadTask = task as? URLSessionDownloadTask,
              let episodeIdString = downloadTask.taskDescription,
              let episodeId = Int(episodeIdString) else { return }

        DispatchQueue.main.async { [weak self] in
            self?.activeDownloads.removeValue(forKey: episodeId)
            self?.downloadProgress.removeValue(forKey: episodeId)
            self?.continuations[episodeId]?.resume(throwing: error)
            self?.continuations.removeValue(forKey: episodeId)
        }
    }
}

enum DownloadError: Error {
    case invalidEpisode
    case downloadFailed
}
