import AVFoundation
import Foundation

@MainActor
final class AVPlayerTransport: PlaybackTransport {
    var onUpdate: (@MainActor (PlaybackTransportUpdate) -> Void)?
    var hasSource: Bool { player.currentItem != nil }
    var position: TimeInterval {
        guard ready else { return targetPosition }
        return player.currentTime().playbackSeconds ?? targetPosition
    }

    private let player = AVPlayer()
    private var observations: AVPlayerObservations?
    private var generation = UUID()
    private var targetPosition: TimeInterval = 0
    private var ready = false
    private var seeking = false

    func load(source: PlaybackSource, at position: TimeInterval, generation: UUID) {
        stop()
        guard let url = source.url else { return }
        let options = url.isFileURL ? source.contentType.map { [AVURLAssetOverrideMIMETypeKey: $0] } : nil
        player.replaceCurrentItem(with: AVPlayerItem(asset: AVURLAsset(url: url, options: options)))
        prepare(at: position, generation: generation)
    }

    func play(atRate rate: Double) {
        guard ready else { return }
        player.playImmediately(atRate: Float(rate))
    }

    func pause() {
        player.pause()
    }

    func seek(to position: TimeInterval, generation: UUID) {
        guard hasSource else { return }
        prepare(at: position, generation: generation)
    }

    func setRate(_ rate: Double) {
        player.defaultRate = Float(rate)
        if player.rate != 0 { player.rate = Float(rate) }
    }

    func setEffects(_ effects: AudioEffects) {
        emit(.effects(effects.enabled ? .unavailable("Audio effects are unavailable for this format.") : .inactive))
    }

    func stop() {
        generation = UUID()
        observations = nil
        player.pause()
        player.currentItem?.cancelPendingSeeks()
        player.replaceCurrentItem(with: nil)
        ready = false
        seeking = false
        targetPosition = 0
    }

    func shutdown() {
        onUpdate = nil
        stop()
    }

    private func prepare(at position: TimeInterval, generation: UUID) {
        observations = nil
        self.generation = generation
        ready = false
        seeking = false
        targetPosition = position
        player.pause()
        guard let item = player.currentItem else { return }
        item.cancelPendingSeeks()
        let observations = AVPlayerObservations(player: player)
        self.observations = observations
        observations.status = item.observe(\.status, options: [.initial, .new]) { [weak self] _, _ in
            Task { @MainActor [weak self] in
                guard let self, self.generation == generation else { return }
                self.handleStatus(generation: generation)
            }
        }
        observations.playback = player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            Task { @MainActor [weak self] in
                guard let self, self.generation == generation, self.ready else { return }
                self.emit(.playback(isPlaying: self.player.timeControlStatus == .playing))
            }
        }
        observations.time = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.generation == generation, self.ready else { return }
                self.emit(.position(self.position))
            }
        }
        observations.end = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.generation == generation, self.ready else { return }
                self.emit(.ended)
            }
        }
    }

    private func handleStatus(generation: UUID) {
        guard let item = player.currentItem else { return }
        switch item.status {
        case .readyToPlay:
            guard !ready, !seeking else { return }
            seeking = true
            player.seek(to: CMTime(seconds: targetPosition, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] finished in
                Task { @MainActor [weak self] in
                    guard let self, self.generation == generation else { return }
                    self.seeking = false
                    guard finished else { self.emit(.failed); return }
                    self.ready = true
                    self.emit(.seeked(self.position))
                    guard self.generation == generation else { return }
                    self.emit(.ready(duration: self.player.currentItem?.duration.playbackSeconds ?? 0))
                }
            }
        case .failed:
            ready = false
            emit(.failed)
        case .unknown:
            break
        @unknown default:
            emit(.failed)
        }
    }

    private func emit(_ event: PlaybackTransportEvent) {
        onUpdate?(PlaybackTransportUpdate(generation: generation, event: event))
    }
}

private final class AVPlayerObservations {
    let player: AVPlayer
    var status: NSKeyValueObservation?
    var playback: NSKeyValueObservation?
    var time: Any?
    var end: NSObjectProtocol?

    init(player: AVPlayer) {
        self.player = player
    }

    deinit {
        status?.invalidate()
        playback?.invalidate()
        if let time { player.removeTimeObserver(time) }
        if let end { NotificationCenter.default.removeObserver(end) }
    }
}

extension CMTime {
    var playbackSeconds: TimeInterval? {
        let value = seconds
        return value.isFinite && value >= 0 ? value : nil
    }
}
