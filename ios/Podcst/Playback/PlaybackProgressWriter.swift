import Foundation

@MainActor
final class PlaybackProgressWriter {
    struct Update: Codable, Equatable, Sendable {
        let episodeID: Int
        let position: TimeInterval
        let completed: Bool
    }

    private let send: @MainActor (Update) async throws -> Void
    private let storageURL: URL?
    private var pending: [Update] = []
    private var inFlight: Update?
    private var worker: Task<Void, Never>?
    private var generation = UUID()
    private var retryRequested = false

    init(storageURL: URL? = nil, send: @escaping @MainActor (Update) async throws -> Void) {
        self.send = send
        self.storageURL = storageURL
        if let storageURL, let data = try? Data(contentsOf: storageURL),
           let updates = try? JSONDecoder().decode([Update].self, from: data) {
            pending = updates.filter { $0.position.isFinite && $0.position >= 0 }
        }
    }

    deinit { worker?.cancel() }

    var hasPendingUpdates: Bool { inFlight != nil || !pending.isEmpty }

    var pendingUpdates: [Update] {
        var updates = pending
        if let inFlight, !updates.contains(where: { $0.episodeID == inFlight.episodeID }) {
            updates.insert(inFlight, at: 0)
        }
        return updates
    }

    func submit(_ update: Update) {
        guard update.position.isFinite, update.position >= 0 else { return }
        pending.removeAll { $0.episodeID == update.episodeID }
        pending.append(update)
        persist()
        start()
    }

    private func start() {
        guard worker == nil, !pending.isEmpty else { return }
        let token = generation
        worker = Task { [weak self] in
            while let self, !Task.isCancelled, self.generation == token, !self.pending.isEmpty {
                self.retryRequested = false
                let next = self.pending.removeFirst()
                self.inFlight = next
                do { try await self.send(next) }
                catch {
                    guard !Task.isCancelled, self.generation == token else { return }
                    if !self.pending.contains(where: { $0.episodeID == next.episodeID }) {
                        self.pending.insert(next, at: 0)
                    }
                    self.inFlight = nil
                    self.persist()
                    if self.retryRequested { continue }
                    self.worker = nil
                    return
                }
                guard !Task.isCancelled, self.generation == token else { return }
                self.inFlight = nil
                self.persist()
            }
            guard let self, self.generation == token else { return }
            self.worker = nil
        }
    }

    func flush() async {
        retryRequested = worker != nil
        start()
        await worker?.value
    }

    func reset() async {
        generation = UUID()
        retryRequested = false
        pending.removeAll()
        inFlight = nil
        persist()
        let previous = worker
        worker = nil
        previous?.cancel()
        await previous?.value
    }

    private func persist() {
        guard let storageURL else { return }
        guard let data = try? JSONEncoder().encode(pendingUpdates) else { return }
        try? FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: storageURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
