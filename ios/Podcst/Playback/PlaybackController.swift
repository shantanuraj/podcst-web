import AVFoundation
import MediaPlayer
import Observation
import Foundation

public enum PlaybackState: String, Codable, Sendable, Equatable {
    case idle
    case loading
    case playing
    case paused
    case ended
    case failed
}

public struct PlaybackUpdate: Sendable {
    public let episode: Episode
    public let position: TimeInterval
    public let completed: Bool

    public init(episode: Episode, position: TimeInterval, completed: Bool) {
        self.episode = episode
        self.position = position
        self.completed = completed
    }
}

@MainActor
@Observable
public final class PlaybackController {
    public private(set) var queue: [Episode]
    public private(set) var currentIndex: Int
    public private(set) var currentTime: TimeInterval
    public private(set) var duration: TimeInterval
    public private(set) var state: PlaybackState
    public private(set) var rate: Double
    public var onProgress: ((PlaybackUpdate) -> Void)?

    public var currentEpisode: Episode? {
        guard queue.indices.contains(currentIndex) else { return nil }
        return queue[currentIndex]
    }

    public var isPlaying: Bool { state == .playing }

    public static let supportedRates: [Double] = [0.5, 0.75, 1, 1.25, 1.5, 2]

    @ObservationIgnored private let player: AVPlayer
    @ObservationIgnored private let storageURL: URL
    @ObservationIgnored private var itemStatusObservation: NSKeyValueObservation?
    @ObservationIgnored private var periodicTimeObserver: Any?
    @ObservationIgnored private var endObserver: NSObjectProtocol?
    @ObservationIgnored private var interruptionObserver: NSObjectProtocol?
    @ObservationIgnored private var routeChangeObserver: NSObjectProtocol?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var shouldPlay = false
    @ObservationIgnored private var wasPlayingBeforeInterruption = false
    @ObservationIgnored private var nextProgressPosition: TimeInterval = 30
    @ObservationIgnored private var remoteTargets: [Any] = []

    private struct PersistedState: Codable {
        var queue: [Episode]
        var currentIndex: Int
        var currentTime: TimeInterval
        var rate: Double
    }

    public init() {
        self.player = AVPlayer()
        self.storageURL = Self.defaultStorageURL()
        self.queue = []
        self.currentIndex = 0
        self.currentTime = 0
        self.duration = 0
        self.state = .idle
        self.rate = 1
        loadPersistedState()
        configureAudioSession()
        configurePlayerObservers()
        configureRemoteCommands()
        updateNowPlayingInfo()
    }

    public init(persistenceURL: URL) {
        self.player = AVPlayer()
        self.storageURL = persistenceURL
        self.queue = []
        self.currentIndex = 0
        self.currentTime = 0
        self.duration = 0
        self.state = .idle
        self.rate = 1
        loadPersistedState()
        configureAudioSession()
        configurePlayerObservers()
        configureRemoteCommands()
        updateNowPlayingInfo()
    }

    public func restore() async {
        guard player.currentItem == nil, state != .playing else { return }
        loadPersistedState()
        updateNowPlayingInfo()
    }

    public func play(_ episode: Episode, at position: TimeInterval = 0) {
        let targetIndex: Int
        if let existingIndex = queue.firstIndex(where: { $0.identity == episode.identity }) {
            targetIndex = existingIndex
            queue[targetIndex] = episode
        } else {
            queue.append(episode)
            targetIndex = queue.index(before: queue.endIndex)
        }
        currentIndex = targetIndex
        currentTime = max(0, position)
        duration = episode.duration ?? 0
        persist()
        replaceCurrentItem(startingAt: currentTime, autoPlay: true)
    }

    public func toggle() {
        switch state {
        case .playing:
            pause()
        case .paused, .ended, .idle:
            resume()
        case .loading, .failed:
            if currentEpisode != nil { resume() }
        }
    }

    public func pause() {
        guard currentEpisode != nil else { return }
        shouldPlay = false
        player.pause()
        currentTime = player.currentTime().safeSeconds(default: currentTime)
        state = .paused
        persist()
        emitProgress(completed: false)
        updateNowPlayingInfo()
    }

    public func resume() {
        guard currentEpisode != nil else { return }
        do { try AVAudioSession.sharedInstance().setActive(true) } catch { state = .failed; return }
        shouldPlay = true
        if player.currentItem == nil {
            replaceCurrentItem(startingAt: currentTime, autoPlay: true)
            return
        }
        if state == .ended || state == .failed {
            replaceCurrentItem(startingAt: currentTime, autoPlay: true)
            return
        }
        player.playImmediately(atRate: Float(rate))
        state = .playing
        updateNowPlayingInfo()
    }

    public func seek(to position: TimeInterval) {
        guard currentEpisode != nil else { return }
        let upperBound = effectiveDuration
        let clamped = max(0, upperBound > 0 ? min(position, upperBound) : position)
        currentTime = clamped
        let time = CMTime(seconds: clamped, preferredTimescale: 600)
        let token = generation
        player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                guard self.generation == token else { return }
                self.currentTime = self.player.currentTime().safeSeconds(default: clamped)
                self.persist()
                self.updateNowPlayingInfo()
            }
        }
        persist()
        updateNowPlayingInfo()
    }

    public func skip(by seconds: TimeInterval) {
        seek(to: currentTime + seconds)
    }

    public func skipBackward() {
        skip(by: -10)
    }

    public func skipForward() {
        skip(by: 10)
    }

    public func setRate(_ newRate: Double) {
        guard Self.supportedRates.contains(where: { abs($0 - newRate) < 0.0001 }) else { return }
        rate = newRate
        player.defaultRate = Float(newRate)
        if state == .playing {
            player.rate = Float(newRate)
        }
        persist()
        updateNowPlayingInfo()
    }

    public func next() {
        guard !queue.isEmpty else { return }
        let nextIndex = currentIndex + 1 < queue.count ? currentIndex + 1 : 0
        currentIndex = nextIndex
        currentTime = 0
        duration = queue[nextIndex].duration ?? 0
        persist()
        replaceCurrentItem(startingAt: 0, autoPlay: true)
    }

    public func previous() {
        guard !queue.isEmpty else { return }
        let previousIndex = currentIndex > 0 ? currentIndex - 1 : queue.count - 1
        currentIndex = previousIndex
        currentTime = 0
        duration = queue[previousIndex].duration ?? 0
        persist()
        replaceCurrentItem(startingAt: 0, autoPlay: true)
    }

    public func enqueue(_ episode: Episode, next: Bool = false) {
        if queue.contains(where: { $0.identity == episode.identity }) { return }
        if next, !queue.isEmpty {
            let insertion = min(currentIndex + 1, queue.count)
            queue.insert(episode, at: insertion)
        } else {
            queue.append(episode)
        }
        if currentEpisode == nil {
            currentIndex = queue.index(before: queue.endIndex)
            duration = episode.duration ?? 0
        }
        persist()
        updateNowPlayingInfo()
    }

    public func remove(atOffsets offsets: IndexSet) {
        guard !offsets.isEmpty, !queue.isEmpty else { return }
        let removedCurrent = offsets.contains(currentIndex)
        offsets.sorted(by: >).forEach { index in
            if queue.indices.contains(index) { queue.remove(at: index) }
        }
        if queue.isEmpty {
            stopPlayback()
            currentIndex = 0
            currentTime = 0
            duration = 0
            state = .idle
            persist()
            updateNowPlayingInfo()
            return
        }
        if removedCurrent {
            currentIndex = min(currentIndex, queue.count - 1)
            currentTime = 0
            duration = queue[currentIndex].duration ?? 0
            stopPlayback()
            state = .paused
        } else {
            let removedBeforeCurrent = offsets.filter { $0 < currentIndex }.count
            currentIndex = max(0, currentIndex - removedBeforeCurrent)
        }
        persist()
        updateNowPlayingInfo()
    }

    public func move(fromOffsets offsets: IndexSet, toOffset destination: Int) {
        guard let source = offsets.first, offsets.count == 1, queue.indices.contains(source) else { return }
        let oldCurrentIndex = currentIndex
        let boundedDestination = max(0, min(destination, queue.count))
        let episode = queue.remove(at: source)
        let insertion = source < boundedDestination ? boundedDestination - 1 : boundedDestination
        queue.insert(episode, at: min(insertion, queue.count))
        if oldCurrentIndex == source {
            currentIndex = min(insertion, queue.count - 1)
        } else if source < oldCurrentIndex {
            currentIndex = oldCurrentIndex - 1
            if insertion <= currentIndex { currentIndex += 1 }
        } else if insertion <= oldCurrentIndex {
            currentIndex = oldCurrentIndex + 1
        }
        persist()
        updateNowPlayingInfo()
    }

    public func clear() {
        stopPlayback()
        queue.removeAll(keepingCapacity: false)
        currentIndex = 0
        currentTime = 0
        duration = 0
        state = .idle
        persist()
        updateNowPlayingInfo()
    }

    private var effectiveDuration: TimeInterval {
        if duration > 0 { return duration }
        if let itemDuration = player.currentItem?.duration.safeSeconds(default: 0), itemDuration > 0 {
            return itemDuration
        }
        return currentEpisode?.duration ?? 0
    }

    private func replaceCurrentItem(startingAt position: TimeInterval, autoPlay: Bool) {
        guard let episode = currentEpisode, let url = episode.audioURL else {
            state = .failed
            shouldPlay = false
            return
        }
        shouldPlay = autoPlay
        state = .loading
        let token = UUID()
        generation = token
        itemStatusObservation?.invalidate()
        itemStatusObservation = nil
        player.pause()
        let item = AVPlayerItem(url: url)
        player.replaceCurrentItem(with: item)
        let clampedPosition = max(0, position)
        currentTime = clampedPosition
        if let episodeDuration = episode.duration, episodeDuration > 0 {
            duration = episodeDuration
        } else {
            duration = 0
        }
        itemStatusObservation = item.observe(\.status, options: [.initial, .new]) { [weak self, weak item] _, _ in
            Task { @MainActor [weak self, weak item] in
                guard let self, let item, self.generation == token, self.player.currentItem === item else { return }
                self.handleItemStatus(item, startingAt: clampedPosition, autoPlay: autoPlay)
            }
        }
        player.seek(to: CMTime(seconds: clampedPosition, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        persist()
        updateNowPlayingInfo()
    }

    private func handleItemStatus(_ item: AVPlayerItem, startingAt position: TimeInterval, autoPlay: Bool) {
        switch item.status {
        case .readyToPlay:
            let itemDuration = item.duration.safeSeconds(default: 0)
            if itemDuration > 0 { duration = itemDuration }
            if autoPlay {
                player.playImmediately(atRate: Float(rate))
                state = .playing
            } else {
                state = .paused
            }
            nextProgressPosition = currentTime + 30
            updateNowPlayingInfo()
        case .failed:
            shouldPlay = false
            state = .failed
            persist()
        case .unknown:
            state = .loading
        @unknown default:
            state = .failed
        }
        _ = position
    }

    private func configurePlayerObservers() {
        periodicTimeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] time in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.handleTime(time)
            }
        }
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main) { [weak self] notification in
            let itemIdentifier = (notification.object as AnyObject?).map(ObjectIdentifier.init)
            Task { @MainActor [weak self] in
                guard let self,
                      let itemIdentifier,
                      let currentItem = self.player.currentItem,
                      ObjectIdentifier(currentItem) == itemIdentifier else { return }
                self.finishCurrentEpisode()
            }
        }
        interruptionObserver = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: AVAudioSession.sharedInstance(), queue: .main) { [weak self] notification in
            let typeRaw = (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue
            let optionsRaw = (notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? NSNumber)?.uintValue
            Task { @MainActor [weak self] in
                self?.handleInterruption(typeRaw: typeRaw, optionsRaw: optionsRaw)
            }
        }
        routeChangeObserver = NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: AVAudioSession.sharedInstance(), queue: .main) { [weak self] notification in
            let reasonRaw = (notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue
            Task { @MainActor [weak self] in
                self?.handleRouteChange(reasonRaw: reasonRaw)
            }
        }
    }

    private func handleTime(_ time: CMTime) {
        guard player.currentItem != nil else { return }
        let seconds = time.safeSeconds(default: currentTime)
        if seconds.isFinite {
            currentTime = max(0, seconds)
            if state == .playing, currentTime >= nextProgressPosition {
                emitProgress(completed: false)
                nextProgressPosition = currentTime + 30
                persist()
            }
            updateNowPlayingInfo()
        }
    }

    private func finishCurrentEpisode() {
        guard currentEpisode != nil else { return }
        currentTime = effectiveDuration
        emitProgress(completed: true)
        if queue.count > 1 {
            queue.remove(at: currentIndex)
            currentIndex = min(currentIndex, queue.count - 1)
            currentTime = 0
            duration = queue[currentIndex].duration ?? 0
            replaceCurrentItem(startingAt: 0, autoPlay: true)
        } else {
            queue.removeAll(keepingCapacity: false)
            currentIndex = 0
            duration = 0
            state = .idle
            shouldPlay = false
            player.pause()
            player.replaceCurrentItem(with: nil)
            persist()
            updateNowPlayingInfo()
        }
    }

    private func stopPlayback() {
        shouldPlay = false
        generation = UUID()
        itemStatusObservation?.invalidate()
        itemStatusObservation = nil
        player.pause()
        player.replaceCurrentItem(with: nil)
        state = .idle
    }

    private func emitProgress(completed: Bool) {
        guard let episode = currentEpisode else { return }
        onProgress?(PlaybackUpdate(episode: episode, position: currentTime, completed: completed))
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .spokenAudio, options: [.allowAirPlay, .allowBluetoothA2DP])
            try session.setActive(true)
        } catch {
            state = .failed
        }
    }

    private func handleInterruption(typeRaw: UInt?, optionsRaw: UInt?) {
        guard let typeRaw, let type = AVAudioSession.InterruptionType(rawValue: typeRaw) else { return }
        switch type {
        case .began:
            wasPlayingBeforeInterruption = state == .playing
            if wasPlayingBeforeInterruption { pause() }
        case .ended:
            let options = optionsRaw.map { AVAudioSession.InterruptionOptions(rawValue: $0) } ?? []
            if wasPlayingBeforeInterruption, options.contains(.shouldResume) { resume() }
            wasPlayingBeforeInterruption = false
        @unknown default:
            break
        }
    }

    private func handleRouteChange(reasonRaw: UInt?) {
        guard let reasonRaw, let reason = AVAudioSession.RouteChangeReason(rawValue: reasonRaw) else { return }
        if reason == .oldDeviceUnavailable, state == .playing { pause() }
    }

    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.isEnabled = true
        center.pauseCommand.isEnabled = true
        center.togglePlayPauseCommand.isEnabled = true
        center.nextTrackCommand.isEnabled = true
        center.previousTrackCommand.isEnabled = true
        center.changePlaybackPositionCommand.isEnabled = true
        remoteTargets.append(center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in self?.resume() }
            return .success
        })
        remoteTargets.append(center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in self?.pause() }
            return .success
        })
        remoteTargets.append(center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in self?.toggle() }
            return .success
        })
        remoteTargets.append(center.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in self?.next() }
            return .success
        })
        remoteTargets.append(center.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in self?.previous() }
            return .success
        })
        remoteTargets.append(center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            Task { @MainActor [weak self] in self?.seek(to: event.positionTime) }
            return .success
        })
    }

    private func updateNowPlayingInfo() {
        guard let episode = currentEpisode else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: episode.title,
            MPNowPlayingInfoPropertyPlaybackRate: state == .playing ? rate : 0,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: currentTime
        ]
        if let podcastTitle = episode.podcastTitle { info[MPMediaItemPropertyAlbumTitle] = podcastTitle }
        if let author = episode.author { info[MPMediaItemPropertyArtist] = author }
        if effectiveDuration > 0 { info[MPMediaItemPropertyPlaybackDuration] = effectiveDuration }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func persist() {
        let snapshot = PersistedState(queue: queue, currentIndex: currentIndex, currentTime: currentTime, rate: rate)
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        do {
            try FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: storageURL, options: [.atomic])
        } catch {
            return
        }
    }

    private func loadPersistedState() {
        guard let data = try? Data(contentsOf: storageURL), let persisted = try? JSONDecoder().decode(PersistedState.self, from: data) else { return }
        queue = persisted.queue
        currentIndex = queue.isEmpty ? 0 : min(max(0, persisted.currentIndex), queue.count - 1)
        currentTime = max(0, persisted.currentTime)
        rate = Self.supportedRates.min { abs($0 - persisted.rate) < abs($1 - persisted.rate) } ?? 1
        duration = currentEpisode?.duration ?? 0
        state = queue.isEmpty ? .idle : .paused
    }

    private static func defaultStorageURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("Podcst", isDirectory: true).appendingPathComponent("playback.json")
    }
}

private extension CMTime {
    var safeSeconds: TimeInterval { safeSeconds(default: 0) }

    func safeSeconds(default fallback: TimeInterval) -> TimeInterval {
        let value = seconds
        guard value.isFinite, value >= 0 else { return fallback }
        return value
    }
}
