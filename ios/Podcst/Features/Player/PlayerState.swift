import Foundation
import SwiftUI

enum PlaybackState: Equatable {
    case idle
    case buffering
    case playing
    case paused
}

@Observable
final class PlayerState {
    private let audioService: AudioService
    private let apiClient: APIClient

    private(set) var queue: [Episode] = []
    private(set) var currentTrackIndex: Int = 0
    private(set) var playbackState: PlaybackState = .idle

    private var progressSaveTask: Task<Void, Never>?
    private var lastSavedPosition: TimeInterval = 0

    var currentEpisode: Episode? {
        guard !queue.isEmpty, currentTrackIndex < queue.count else { return nil }
        return queue[currentTrackIndex]
    }

    var isPlaying: Bool {
        audioService.isPlaying
    }

    var currentTime: TimeInterval {
        audioService.currentTime
    }

    var duration: TimeInterval {
        audioService.duration
    }

    var rate: Float {
        get { audioService.rate }
        set { audioService.rate = newValue }
    }

    var progress: Double {
        guard duration > 0 else { return 0 }
        return currentTime / duration
    }

    init(audioService: AudioService, apiClient: APIClient) {
        self.audioService = audioService
        self.apiClient = apiClient

        audioService.onPlaybackEnded = { [weak self] in
            self?.onPlaybackEnded()
        }
    }

    func play(_ episode: Episode, at position: TimeInterval = 0) {
        if let existingIndex = queue.firstIndex(where: { $0.stableId == episode.stableId }) {
            currentTrackIndex = existingIndex
        } else {
            queue.insert(episode, at: 0)
            currentTrackIndex = 0
        }

        playbackState = .buffering
        audioService.play(episode, at: position)
        playbackState = .playing
        startProgressSync()
    }

    func queueEpisode(_ episode: Episode) {
        guard !queue.contains(where: { $0.stableId == episode.stableId }) else { return }
        queue.append(episode)
    }

    func removeFromQueue(at index: Int) {
        guard index < queue.count else { return }
        queue.remove(at: index)

        if index < currentTrackIndex {
            currentTrackIndex -= 1
        } else if index == currentTrackIndex && !queue.isEmpty {
            if currentTrackIndex >= queue.count {
                currentTrackIndex = queue.count - 1
            }
            if let episode = currentEpisode {
                audioService.play(episode)
            }
        }
    }

    func togglePlayback() {
        audioService.togglePlayback()
        playbackState = audioService.isPlaying ? .playing : .paused

        if !audioService.isPlaying {
            saveProgress()
        }
    }

    func pause() {
        audioService.pause()
        playbackState = .paused
        saveProgress()
    }

    func resume() {
        audioService.resume()
        playbackState = .playing
    }

    func seek(to time: TimeInterval) {
        audioService.seek(to: time)
    }

    func seekForward() {
        audioService.seekForward()
    }

    func seekBackward() {
        audioService.seekBackward()
    }

    func skipToNext() {
        guard currentTrackIndex < queue.count - 1 else { return }
        saveProgress(completed: true)
        currentTrackIndex += 1
        if let episode = currentEpisode {
            audioService.play(episode)
            playbackState = .playing
        }
    }

    func skipToPrevious() {
        if currentTime > 3 {
            audioService.seek(to: 0)
        } else if currentTrackIndex > 0 {
            currentTrackIndex -= 1
            if let episode = currentEpisode {
                audioService.play(episode)
                playbackState = .playing
            }
        }
    }

    func stop() {
        saveProgress()
        audioService.stop()
        playbackState = .idle
        stopProgressSync()
    }

    private func onPlaybackEnded() {
        saveProgress(completed: true)

        if currentTrackIndex < queue.count - 1 {
            currentTrackIndex += 1
            if let episode = currentEpisode {
                audioService.play(episode)
            }
        } else {
            playbackState = .idle
        }
    }

    private func startProgressSync() {
        stopProgressSync()

        progressSaveTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled else { break }
                await self?.saveProgress()
            }
        }
    }

    private func stopProgressSync() {
        progressSaveTask?.cancel()
        progressSaveTask = nil
    }

    @MainActor
    func saveProgress(completed: Bool = false) {
        guard let episode = currentEpisode, let episodeId = episode.id else { return }

        let position = Int(currentTime)
        let isCompleted = completed || (duration > 0 && currentTime / duration >= 0.95)

        guard position != Int(lastSavedPosition) || isCompleted else { return }
        lastSavedPosition = currentTime

        Task {
            try? await apiClient.saveProgress(
                episodeId: episodeId,
                position: position,
                completed: isCompleted
            )
        }
    }

    func restoreProgress() async {
        do {
            if let progress = try await apiClient.fetchProgress() {
                await MainActor.run {
                    play(progress.episode, at: TimeInterval(progress.position))
                    pause()
                }
            }
        } catch {
        }
    }
}
