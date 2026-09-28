import AVFoundation
import MediaPlayer
import Observation
import Foundation
import UIKit

private func makeNowPlayingArtwork(data: Data, size: CGSize) -> MPMediaItemArtwork {
    MPMediaItemArtwork(boundsSize: size) { _ in
        UIImage(data: data) ?? UIImage()
    }
}

public enum PlaybackState: String, Codable, Sendable, Equatable {
    case idle
    case loading
    case playing
    case paused
    case ended
    case failed
}

public struct PlaybackUpdate: Codable, Hashable, Sendable {
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
    let audioPreferences: AudioPreferences
    public var rate: Double { audioPreferences.options(for: currentEpisode?.feed).speed }
    var requestedEffects: AudioEffects { audioPreferences.options(for: currentEpisode?.feed).effects }
    public private(set) var isDoubleSpeedHeld = false
    public private(set) var outputName: String?
    private(set) var audioEffectState: AudioEffectState = .inactive
    public var onProgress: ((PlaybackUpdate) -> Void)?

    public var currentEpisode: Episode? {
        guard queue.indices.contains(currentIndex) else { return nil }
        return queue[currentIndex]
    }

    public var isPlaying: Bool { state == .playing }
    public var isPlaybackRequested: Bool { shouldPlay }

    public var upNext: [Episode] {
        guard queue.indices.contains(currentIndex) else { return queue }
        return Array(queue[(currentIndex + 1)...] + queue[..<currentIndex])
    }

    public var remaining: TimeInterval { max(0, duration - currentTime) }

    public var progress: Double { duration > 0 ? min(1, currentTime / duration) : 0 }

    public var chapters: [Chapter] {
        guard let episode = currentEpisode else { return [] }
        if let assetChapters, assetChapters.identity == episode.identity, !assetChapters.chapters.isEmpty {
            return assetChapters.chapters
        }
        if let parsedChapters, parsedChapters.identity == episode.identity { return parsedChapters.chapters }
        let chapters = ShowNotesParser.chapters(ShowNotesParser.notes(of: episode))
        parsedChapters = (episode.identity, chapters)
        return chapters
    }

    public var currentChapterIndex: Int? { chapters.index(at: currentTime) }

    public func position(of episode: Episode) -> TimeInterval? {
        episode.identity == currentEpisode?.identity ? currentTime : nil
    }

    public static let supportedRates: [Double] = [0.5, 0.75, 1, 1.25, 1.5, 2]

    private var assetChapters: (identity: String, chapters: [Chapter])?
    @ObservationIgnored private var parsedChapters: (identity: String, chapters: [Chapter])?
    @ObservationIgnored private let transport: any PlaybackTransport
    @ObservationIgnored private let storageURL: URL
    @ObservationIgnored private let monotonicTime: @MainActor () -> TimeInterval
    @ObservationIgnored private let integratesWithSystem: Bool
    @ObservationIgnored private let nowPlayingInfoSink: (@MainActor ([String: Any]?) -> Void)?
    @ObservationIgnored private var lastNowPlayingUpdate: TimeInterval?
    @ObservationIgnored private let prepareAudioSession: (@Sendable (Bool) async throws -> Void)?
    @ObservationIgnored private var audioSessionTask: Task<Void, Never>?
    @ObservationIgnored private var systemObservers: SystemPlaybackObservers?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var shouldPlay = false
    @ObservationIgnored private var changingAccount = false
    @ObservationIgnored private var wasPlayingBeforeInterruption = false
    @ObservationIgnored private var playingSince: TimeInterval?
    @ObservationIgnored private var elapsedSinceProgress: TimeInterval = 0
    @ObservationIgnored private var isShutdown = false
    @ObservationIgnored private var chaptersTask: Task<Void, Never>?
    @ObservationIgnored private var artworkTask: Task<Void, Never>?
    @ObservationIgnored private var artworkKey: String?
    @ObservationIgnored private var nowPlayingArtwork: MPMediaItemArtwork?

    private var accountID: String?

    private struct PersistedState: Codable {
        var accountID: String?
        var queue: [Episode]
        var currentIndex: Int
        var currentTime: TimeInterval
    }

    init(transport: any PlaybackTransport, persistenceURL: URL = PlaybackController.defaultStorageURL(), accountID: String? = nil, preferences: AudioPreferences? = nil, monotonicTime: @escaping @MainActor () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }, integratesWithSystem: Bool = false, prepareAudioSession: (@Sendable (Bool) async throws -> Void)? = nil, nowPlayingInfoSink: (@MainActor ([String: Any]?) -> Void)? = nil) {
        self.accountID = accountID
        self.transport = transport
        self.storageURL = persistenceURL
        self.monotonicTime = monotonicTime
        self.integratesWithSystem = integratesWithSystem
        if let nowPlayingInfoSink {
            self.nowPlayingInfoSink = nowPlayingInfoSink
        } else if integratesWithSystem {
            self.nowPlayingInfoSink = { MPNowPlayingInfoCenter.default().nowPlayingInfo = $0 }
        } else {
            self.nowPlayingInfoSink = nil
        }
        self.prepareAudioSession = prepareAudioSession ?? (integratesWithSystem ? PlaybackAudioSession.prepare : nil)
        self.queue = []
        self.currentIndex = 0
        self.currentTime = 0
        self.duration = 0
        self.state = .idle
        self.audioPreferences = preferences ?? AudioPreferences(storageURL: persistenceURL.appendingPathExtension("audio"))
        loadPersistedState()
        transport.onUpdate = { [weak self] update in self?.handleTransport(update) }
        audioPreferences.onChange = { [weak self] in self?.applyAudioOptions() }
        if integratesWithSystem {
            systemObservers = SystemPlaybackObservers()
            configureSystemObservers()
            configureRemoteCommands()
            updateOutputName()
        }
        updateNowPlayingInfo()
    }

    deinit {
        audioSessionTask?.cancel()
        artworkTask?.cancel()
        chaptersTask?.cancel()
        let transport = transport
        Task { @MainActor in transport.shutdown() }
    }

    public func shutdown() {
        guard !isShutdown else { return }
        saveOutgoingProgress()
        persist()
        isShutdown = true
        stopPlayback()
        transport.shutdown()
        systemObservers = nil
        artworkTask?.cancel()
        chaptersTask?.cancel()
        artworkTask = nil
        chaptersTask = nil
        onProgress = nil
        nowPlayingInfoSink?(nil)
    }

    public func restore() async {
        guard !changingAccount, !isShutdown, !transport.hasSource, state != .playing else { return }
        loadPersistedState()
        updateNowPlayingInfo()
    }

    public func play(_ episode: Episode, at position: TimeInterval = 0) {
        guard !changingAccount, !isShutdown else { return }
        saveOutgoingProgress()
        let targetIndex: Int
        if let existingIndex = queue.firstIndex(where: { $0.identity == episode.identity }) {
            targetIndex = existingIndex
            queue[targetIndex] = episode
        } else {
            queue.append(episode)
            targetIndex = queue.index(before: queue.endIndex)
        }
        currentIndex = targetIndex
        currentTime = position.isFinite ? max(0, position) : 0
        duration = episode.duration ?? 0
        persist()
        replaceCurrentItem(startingAt: currentTime, autoPlay: true)
    }

    public func restore(_ episode: Episode, at position: TimeInterval) {
        guard !changingAccount, !isShutdown else { return }
        saveOutgoingProgress()
        if let existingIndex = queue.firstIndex(where: { $0.identity == episode.identity }) {
            currentIndex = existingIndex
            queue[existingIndex] = episode
        } else {
            queue.append(episode)
            currentIndex = queue.index(before: queue.endIndex)
        }
        currentTime = position.isFinite ? max(0, position) : 0
        duration = episode.duration ?? 0
        persist()
        replaceCurrentItem(startingAt: currentTime, autoPlay: false)
    }

    public func toggle() {
        if shouldPlay { pause() } else { resume() }
    }

    public func pause() {
        wasPlayingBeforeInterruption = false
        guard !isShutdown, currentEpisode != nil else { return }
        shouldPlay = false
        cancelAudioSessionTask()
        transport.pause()
        if transport.hasSource { currentTime = transport.position }
        transition(to: .paused)
        persist()
        emitProgress(completed: false)
        updateNowPlayingInfo()
    }

    public func resume() {
        guard !changingAccount, !isShutdown, currentEpisode != nil, state != .playing else { return }
        guard !shouldPlay || audioSessionTask == nil else { return }
        wasPlayingBeforeInterruption = false
        shouldPlay = true
        if !transport.hasSource || state == .ended || state == .failed {
            replaceCurrentItem(startingAt: currentTime, autoPlay: true)
            return
        }
        transition(to: .loading)
        withPreparedAudioSession(forPlayback: true) { [weak self] in
            guard let self else { return }
            self.transport.play(atRate: self.effectiveRate)
        }
        updateNowPlayingInfo()
    }

    public func seek(to position: TimeInterval) {
        guard !changingAccount, !isShutdown, currentEpisode != nil, position.isFinite else { return }
        let clamped = max(0, position)
        currentTime = clamped
        generation = UUID()
        transition(to: shouldPlay ? .loading : .paused)
        if transport.hasSource {
            transport.seek(to: clamped, generation: generation)
        } else {
            emitProgress(completed: false)
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
        skip(by: 30)
    }

    public func previousChapter() {
        guard let index = currentChapterIndex else { return previous() }
        let chapter = chapters[index]
        if currentTime - chapter.start > 3 || index == 0 {
            seek(to: chapter.start)
        } else {
            seek(to: chapters[index - 1].start)
        }
    }

    public func nextChapter() {
        let chapters = chapters
        guard let next = chapters.first(where: { $0.start > currentTime + 0.5 }) else { return self.next() }
        seek(to: next.start)
    }

    public func holdDoubleSpeed(_ held: Bool) {
        guard !isShutdown, isDoubleSpeedHeld != held else { return }
        isDoubleSpeedHeld = held
        applyRate()
    }

    public func setRate(_ newRate: Double) {
        guard !isShutdown, Self.supportedRates.contains(where: { abs($0 - newRate) < 0.0001 }) else { return }
        let feed = currentEpisode?.feed
        var options = audioPreferences.options(for: feed)
        options.speed = newRate
        audioPreferences.set(options, for: feed.flatMap { audioPreferences.hasOverride(for: $0) ? $0 : nil })
    }

    private func applyAudioOptions() {
        guard !isShutdown else { return }
        applyRate()
        transport.setEffects(requestedEffects)
    }

    private var effectiveRate: Double { isDoubleSpeedHeld ? 2 : rate }

    private func applyRate() {
        transport.setRate(effectiveRate)
        updateNowPlayingInfo()
    }

    public func next() {
        guard !changingAccount, !isShutdown, !queue.isEmpty else { return }
        saveOutgoingProgress()
        let nextIndex = currentIndex + 1 < queue.count ? currentIndex + 1 : 0
        currentIndex = nextIndex
        currentTime = 0
        duration = queue[nextIndex].duration ?? 0
        persist()
        replaceCurrentItem(startingAt: 0, autoPlay: true)
    }

    public func previous() {
        guard !changingAccount, !isShutdown, !queue.isEmpty else { return }
        saveOutgoingProgress()
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
        if removedCurrent { saveOutgoingProgress() }
        offsets.sorted(by: >).forEach { index in
            if queue.indices.contains(index) { queue.remove(at: index) }
        }
        if queue.isEmpty {
            stopPlayback()
            currentIndex = 0
            currentTime = 0
            duration = 0
            transition(to: .idle)
            persist()
            updateNowPlayingInfo()
            return
        }
        if removedCurrent {
            currentIndex = min(currentIndex, queue.count - 1)
            currentTime = 0
            duration = queue[currentIndex].duration ?? 0
            stopPlayback()
            transition(to: .paused)
        } else {
            let removedBeforeCurrent = offsets.filter { $0 < currentIndex }.count
            currentIndex = max(0, currentIndex - removedBeforeCurrent)
        }
        persist()
        updateNowPlayingInfo()
    }

    public func removeUpNext(atOffsets offsets: IndexSet) {
        rotateToCurrent()
        remove(atOffsets: IndexSet(offsets.map { $0 + 1 }))
    }

    public func moveUpNext(fromOffsets offsets: IndexSet, toOffset destination: Int) {
        rotateToCurrent()
        move(fromOffsets: IndexSet(offsets.map { $0 + 1 }), toOffset: destination + 1)
    }

    private func rotateToCurrent() {
        guard queue.indices.contains(currentIndex), currentIndex > 0 else { return }
        queue = Array(queue[currentIndex...] + queue[..<currentIndex])
        currentIndex = 0
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

    func beginAccountChange() {
        pause()
        changingAccount = true
        onProgress = nil
        stopPlayback()
    }

    func switchAccount(to id: String?) {
        defer { changingAccount = false }
        guard accountID != id else { return }
        onProgress = nil
        clear()
        accountID = id
        persist()
    }

    public func clear() {
        saveOutgoingProgress()
        stopPlayback()
        queue.removeAll(keepingCapacity: false)
        currentIndex = 0
        currentTime = 0
        duration = 0
        transition(to: .idle)
        persist()
        updateNowPlayingInfo()
    }

    private var effectiveDuration: TimeInterval {
        duration > 0 ? duration : currentEpisode?.duration ?? 0
    }

    private func replaceCurrentItem(startingAt position: TimeInterval, autoPlay: Bool) {
        stopPlayback()
        guard let episode = currentEpisode, let url = episode.audioURL else {
            transition(to: .failed)
            return
        }
        shouldPlay = autoPlay
        transition(to: .loading)
        currentTime = position.isFinite ? max(0, position) : 0
        duration = episode.duration ?? 0
        elapsedSinceProgress = 0
        withPreparedAudioSession(forPlayback: autoPlay) { [weak self] in
            guard let self else { return }
            self.applyAudioOptions()
            self.transport.load(source: .episode(episode), at: self.currentTime, generation: self.generation)
            self.transport.setEffects(self.requestedEffects)
            if self.integratesWithSystem {
                self.loadChapters(from: AVURLAsset(url: url), identity: episode.identity)
            }
        }
        persist()
        updateNowPlayingInfo()
    }

    private func handleTransport(_ update: PlaybackTransportUpdate) {
        guard !isShutdown, update.generation == generation, currentEpisode != nil else { return }
        switch update.event {
        case .effects(let state):
            audioEffectState = state
        case .duration(let duration):
            if duration.isFinite, duration >= 0 { self.duration = duration }
        case .ready(let duration):
            if duration.isFinite, duration > 0 { self.duration = duration }
            if shouldPlay, audioSessionTask == nil {
                transport.play(atRate: effectiveRate)
            } else if !shouldPlay {
                transition(to: .paused)
            }
        case .position(let position):
            guard position.isFinite, position >= 0 else { return }
            currentTime = position
            if let playingSince, elapsedSinceProgress + monotonicTime() - playingSince >= 30 {
                emitProgress(completed: false)
                persist()
            }
            updateNowPlayingInfo(periodic: true)
            return
        case .playback(let isPlaying):
            transition(to: shouldPlay ? (isPlaying ? .playing : .loading) : .paused)
        case .seeked(let position):
            guard position.isFinite, position >= 0 else { return }
            currentTime = position
            emitProgress(completed: false)
            persist()
        case .ended:
            finishCurrentEpisode()
        case .failed:
            cancelAudioSessionTask()
            shouldPlay = false
            transition(to: .failed)
            persist()
        }
        updateNowPlayingInfo()
    }

    private func transition(to newState: PlaybackState) {
        guard state != newState else { return }
        let now = monotonicTime()
        if let playingSince { elapsedSinceProgress += max(0, now - playingSince) }
        playingSince = newState == .playing ? now : nil
        state = newState
    }

    private func saveOutgoingProgress() {
        guard transport.hasSource else { return }
        currentTime = transport.position
        emitProgress(completed: false)
    }

    private func configureSystemObservers() {
        systemObservers?.interruption = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: AVAudioSession.sharedInstance(), queue: .main) { [weak self] notification in
            let typeRaw = (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue
            let optionsRaw = (notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? NSNumber)?.uintValue
            Task { @MainActor [weak self] in
                self?.handleInterruption(typeRaw: typeRaw, optionsRaw: optionsRaw)
            }
        }
        systemObservers?.routeChange = NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: AVAudioSession.sharedInstance(), queue: .main) { [weak self] notification in
            let reasonRaw = (notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue
            Task { @MainActor [weak self] in
                self?.updateOutputName()
                self?.handleRouteChange(reasonRaw: reasonRaw)
            }
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
            transition(to: .idle)
            shouldPlay = false
            stopPlayback()
            persist()
            updateNowPlayingInfo()
        }
    }

    private func stopPlayback() {
        cancelAudioSessionTask()
        shouldPlay = false
        wasPlayingBeforeInterruption = false
        generation = UUID()
        chaptersTask?.cancel()
        chaptersTask = nil
        transport.stop()
        transition(to: .idle)
    }

    private func emitProgress(completed: Bool) {
        guard let episode = currentEpisode else { return }
        elapsedSinceProgress = 0
        playingSince = state == .playing ? monotonicTime() : nil
        onProgress?(PlaybackUpdate(episode: episode, position: currentTime, completed: completed))
    }

    private func withPreparedAudioSession(forPlayback: Bool, perform action: @escaping @MainActor () -> Void) {
        cancelAudioSessionTask()
        guard let prepareAudioSession else {
            action()
            return
        }
        audioSessionTask = Task { [weak self] in
            do {
                try Task.checkCancellation()
                try await prepareAudioSession(forPlayback)
                guard !Task.isCancelled, let self, !self.isShutdown, !self.changingAccount else { return }
                self.audioSessionTask = nil
                action()
            } catch {
                guard !Task.isCancelled, let self, !self.isShutdown, !self.changingAccount else { return }
                self.audioSessionTask = nil
                self.shouldPlay = false
                self.transition(to: .failed)
                self.persist()
                self.updateNowPlayingInfo()
            }
        }
    }

    private func cancelAudioSessionTask() {
        audioSessionTask?.cancel()
        audioSessionTask = nil
    }

    func handleInterruption(typeRaw: UInt?, optionsRaw: UInt?) {
        guard !isShutdown, let typeRaw, let type = AVAudioSession.InterruptionType(rawValue: typeRaw) else { return }
        switch type {
        case .began:
            let resumeAfterInterruption = shouldPlay
            pause()
            wasPlayingBeforeInterruption = resumeAfterInterruption
        case .ended:
            let options = optionsRaw.map { AVAudioSession.InterruptionOptions(rawValue: $0) } ?? []
            if wasPlayingBeforeInterruption, options.contains(.shouldResume) { resume() }
            wasPlayingBeforeInterruption = false
        @unknown default:
            break
        }
    }

    private func updateOutputName() {
        outputName = AVAudioSession.sharedInstance().currentRoute.outputs
            .first { [.airPlay, .HDMI, .carAudio].contains($0.portType) }?
            .portName
    }

    private func loadChapters(from asset: AVURLAsset, identity: String) {
        chaptersTask?.cancel()
        chaptersTask = Task { [weak self] in
            let chapters = await Self.chapters(in: asset)
            guard !Task.isCancelled, let self, self.currentEpisode?.identity == identity else { return }
            self.assetChapters = (identity, chapters)
        }
    }

    private nonisolated static func chapters(in asset: AVURLAsset) async -> [Chapter] {
        guard let groups = try? await asset.loadChapterMetadataGroups(bestMatchingPreferredLanguages: Locale.preferredLanguages) else { return [] }
        var chapters: [Chapter] = []
        for group in groups {
            let title = try? await AVMetadataItem.metadataItems(from: group.items, filteredByIdentifier: .commonIdentifierTitle).first?.load(.stringValue)
            let start = group.timeRange.start.playbackSeconds ?? 0
            chapters.append(Chapter(title: title ?? "Chapter \(chapters.count + 1)", start: start))
        }
        return chapters.count >= 2 ? chapters : []
    }

    func handleRouteChange(reasonRaw: UInt?) {
        guard let reasonRaw, let reason = AVAudioSession.RouteChangeReason(rawValue: reasonRaw) else { return }
        if reason == .oldDeviceUnavailable, shouldPlay { pause() }
    }

    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.isEnabled = true
        center.pauseCommand.isEnabled = true
        center.togglePlayPauseCommand.isEnabled = true
        center.nextTrackCommand.isEnabled = true
        center.previousTrackCommand.isEnabled = true
        center.changePlaybackPositionCommand.isEnabled = true
        systemObservers?.remoteTargets.append((center.playCommand, center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in self?.resume() }
            return .success
        }))
        systemObservers?.remoteTargets.append((center.pauseCommand, center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in self?.pause() }
            return .success
        }))
        systemObservers?.remoteTargets.append((center.togglePlayPauseCommand, center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in self?.toggle() }
            return .success
        }))
        systemObservers?.remoteTargets.append((center.nextTrackCommand, center.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in self?.next() }
            return .success
        }))
        systemObservers?.remoteTargets.append((center.previousTrackCommand, center.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in self?.previous() }
            return .success
        }))
        systemObservers?.remoteTargets.append((center.changePlaybackPositionCommand, center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            Task { @MainActor [weak self] in self?.seek(to: event.positionTime) }
            return .success
        }))
    }

    private func updateNowPlayingInfo(periodic: Bool = false) {
        guard let nowPlayingInfoSink, !isShutdown else { return }
        let now = monotonicTime()
        if periodic, let lastNowPlayingUpdate, now - lastNowPlayingUpdate < 1 { return }
        lastNowPlayingUpdate = now
        guard let episode = currentEpisode else {
            artworkTask?.cancel()
            artworkTask = nil
            artworkKey = nil
            nowPlayingArtwork = nil
            nowPlayingInfoSink(nil)
            return
        }
        let key = artworkKey(for: episode)
        if artworkKey != key {
            artworkKey = key
            nowPlayingArtwork = nil
            requestArtwork(for: episode, key: key)
        }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: episode.title,
            MPNowPlayingInfoPropertyPlaybackRate: state == .playing ? effectiveRate : 0,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: currentTime
        ]
        if let podcastTitle = episode.podcastTitle { info[MPMediaItemPropertyAlbumTitle] = podcastTitle }
        if let author = episode.author { info[MPMediaItemPropertyArtist] = author }
        if effectiveDuration > 0 { info[MPMediaItemPropertyPlaybackDuration] = effectiveDuration }
        if let nowPlayingArtwork { info[MPMediaItemPropertyArtwork] = nowPlayingArtwork }
        nowPlayingInfoSink(info)
    }

    private func artworkKey(for episode: Episode) -> String {
        [episode.identity, episode.episodeArt ?? "", episode.cover].joined(separator: "\u{001F}")
    }

    private func requestArtwork(for episode: Episode, key: String) {
        artworkTask?.cancel()
        let urls = [episode.episodeArt, episode.cover]
            .compactMap { $0 }
            .compactMap(URL.init(string:))
            .reduce(into: [URL]()) { urls, url in
                if !urls.contains(url) { urls.append(url) }
            }
        guard !urls.isEmpty else { return }
        let identity = episode.identity
        artworkTask = Task { [weak self] in
            guard let self else { return }
            for url in urls {
                guard !Task.isCancelled else { return }
                if let image = await ArtworkStore.shared.image(url) {
                    guard !Task.isCancelled,
                          self.artworkKey == key,
                          self.currentEpisode?.identity == identity else { return }
                    guard let data = image.jpegData(compressionQuality: 0.9) else { return }
                    self.nowPlayingArtwork = makeNowPlayingArtwork(data: data, size: image.size)
                    self.updateNowPlayingInfo()
                    return
                }
            }
        }
    }

    private func persist() {
        let snapshot = PersistedState(accountID: accountID, queue: queue, currentIndex: currentIndex, currentTime: currentTime)
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        do {
            try FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: storageURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            var file = storageURL
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try file.setResourceValues(values)
        } catch {
            return
        }
    }

    private func loadPersistedState() {
        guard let data = try? Data(contentsOf: storageURL), let persisted = try? JSONDecoder().decode(PersistedState.self, from: data) else { return }
        guard persisted.accountID == accountID else { return }
        queue = persisted.queue
        currentIndex = queue.isEmpty ? 0 : min(max(0, persisted.currentIndex), queue.count - 1)
        currentTime = max(0, persisted.currentTime)
        duration = currentEpisode?.duration ?? 0
        transition(to: queue.isEmpty ? .idle : .paused)
    }

    static func defaultStorageURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("Podcst", isDirectory: true).appendingPathComponent("playback.json")
    }
}

enum PlaybackAudioSession {
    private static let queue = DispatchQueue(label: "app.podcst.audio-session", qos: .userInitiated)

    static func prepare(forPlayback: Bool) async throws {
        try Task.checkCancellation()
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            queue.async {
                do {
                    let session = AVAudioSession.sharedInstance()
                    if session.category != .playback || session.mode != .spokenAudio || !session.categoryOptions.isEmpty {
                        try session.setCategory(.playback, mode: .spokenAudio)
                    }
                    if forPlayback { try session.setActive(true) }
                    continuation.resume()
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
        try Task.checkCancellation()
    }
}

private final class SystemPlaybackObservers {
    var interruption: NSObjectProtocol?
    var routeChange: NSObjectProtocol?
    var remoteTargets: [(MPRemoteCommand, Any)] = []

    deinit {
        if let interruption { NotificationCenter.default.removeObserver(interruption) }
        if let routeChange { NotificationCenter.default.removeObserver(routeChange) }
        for (command, target) in remoteTargets { command.removeTarget(target) }
    }
}
