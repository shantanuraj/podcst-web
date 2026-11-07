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
    private var lastTraceSample: TimeInterval = 0

    func load(source: PlaybackSource, at position: TimeInterval, generation: UUID) {
        stop()
        guard let url = source.url else { return }
        let options = url.isFileURL ? source.contentType.map { [AVURLAssetOverrideMIMETypeKey: $0] } : nil
        player.replaceCurrentItem(with: AVPlayerItem(asset: AVURLAsset(url: url, options: options)))
        prepare(at: position, generation: generation)
        trace("avplayer_load", values: ["position": position, "local": url.isFileURL ? 1 : 0])
    }

    func play(atRate rate: Double) {
        guard ready else { return }
        trace("avplayer_play", values: ["requestedRate": rate])
        player.playImmediately(atRate: Float(rate))
    }

    func pause() {
        trace("avplayer_pause")
        player.pause()
    }

    func seek(to position: TimeInterval, generation: UUID) {
        guard hasSource else { return }
        prepare(at: position, generation: generation)
        trace("avplayer_seek", values: ["targetPosition": position])
    }

    func setRate(_ rate: Double) {
        trace("avplayer_rate", values: ["requestedRate": rate])
        player.defaultRate = Float(rate)
        if player.rate != 0 { player.rate = Float(rate) }
    }

    func setEffects(_ effects: AudioEffects) {
        emit(.effects(effects.enabled ? .unavailable("Audio effects are unavailable for this format.") : .inactive))
    }

    func stop() {
        if hasSource { trace("avplayer_stop") }
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
                guard let self, self.generation == generation else { return }
                self.trace("avplayer_time_control")
                guard self.ready else { return }
                self.emit(.playback(isPlaying: self.player.timeControlStatus == .playing))
            }
        }
        observations.time = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.generation == generation, self.ready else { return }
                if PlaybackTraceRecorder.shared.isRecording, PlaybackTraceRecorder.now - self.lastTraceSample >= 1 {
                    self.lastTraceSample = PlaybackTraceRecorder.now
                    self.trace("avplayer_sample")
                }
                self.emit(.position(self.position))
            }
        }
        observations.end = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.generation == generation, self.ready else { return }
                self.emit(.ended)
            }
        }
        observations.buffer = item.observe(\.isPlaybackBufferEmpty, options: [.new]) { [weak self] _, _ in
            Task { @MainActor [weak self] in
                guard let self, self.generation == generation else { return }
                self.trace("avplayer_buffer")
            }
        }
        observations.stall = NotificationCenter.default.addObserver(forName: .AVPlayerItemPlaybackStalled, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.generation == generation else { return }
                self.trace("avplayer_stall")
            }
        }
        observations.access = NotificationCenter.default.addObserver(forName: .AVPlayerItemNewAccessLogEntry, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.generation == generation, PlaybackTraceRecorder.shared.isRecording,
                      let entry = self.player.currentItem?.accessLog()?.events.last else { return }
                self.trace("avplayer_access", values: [
                    "stalls": Double(entry.numberOfStalls), "bytesTransferred": Double(entry.numberOfBytesTransferred),
                    "transferSeconds": entry.transferDuration, "observedBitrate": entry.observedBitrate,
                    "indicatedBitrate": entry.indicatedBitrate, "downloadedSeconds": entry.segmentsDownloadedDuration,
                    "startupSeconds": entry.startupTime, "watchedSeconds": entry.durationWatched
                ])
            }
        }
        observations.error = NotificationCenter.default.addObserver(forName: .AVPlayerItemNewErrorLogEntry, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.generation == generation, PlaybackTraceRecorder.shared.isRecording,
                      let entry = self.player.currentItem?.errorLog()?.events.last else { return }
                self.trace("avplayer_error", values: ["code": Double(entry.errorStatusCode)], labels: ["domain": entry.errorDomain])
            }
        }
    }

    private func handleStatus(generation: UUID) {
        guard let item = player.currentItem else { return }
        trace("avplayer_status", values: ["status": Double(item.status.rawValue)])
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
                    self.trace("avplayer_ready")
                    self.emit(.seeked(self.position))
                    guard self.generation == generation else { return }
                    self.emit(.ready(duration: self.player.currentItem?.duration.playbackSeconds ?? 0))
                }
            }
        case .failed:
            if let error = item.error as NSError? { trace("avplayer_failed", values: ["code": Double(error.code)], labels: ["domain": error.domain]) }
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

    private func trace(_ event: String, values: [String: Double] = [:], labels: [String: String] = [:]) {
        guard PlaybackTraceRecorder.shared.isRecording else { return }
        var values = values
        values["position"] = position
        values["rate"] = Double(player.rate)
        values["timeControlStatus"] = Double(player.timeControlStatus.rawValue)
        if let item = player.currentItem {
            values["bufferEmpty"] = item.isPlaybackBufferEmpty ? 1 : 0
            values["likelyToKeepUp"] = item.isPlaybackLikelyToKeepUp ? 1 : 0
            values["bufferFull"] = item.isPlaybackBufferFull ? 1 : 0
            values["bufferedAhead"] = item.loadedTimeRanges.reduce(0) { longest, value in
                let range = value.timeRangeValue
                guard let start = range.start.playbackSeconds, let end = CMTimeRangeGetEnd(range).playbackSeconds,
                      start <= position, end >= position else { return longest }
                return max(longest, end - position)
            }
        }
        var context = labels
        context["generation"] = generation.uuidString
        switch player.reasonForWaitingToPlay {
        case .toMinimizeStalls: context["waitingReason"] = "minimizeStalls"
        case .evaluatingBufferingRate: context["waitingReason"] = "evaluatingBufferingRate"
        case .noItemToPlay: context["waitingReason"] = "noItem"
        case .none: break
        default: context["waitingReason"] = "other"
        }
        PlaybackTraceRecorder.shared.record(event, values: values, labels: context)
    }
}

private final class AVPlayerObservations {
    let player: AVPlayer
    var status: NSKeyValueObservation?
    var playback: NSKeyValueObservation?
    var buffer: NSKeyValueObservation?
    var time: Any?
    var end: NSObjectProtocol?
    var stall: NSObjectProtocol?
    var access: NSObjectProtocol?
    var error: NSObjectProtocol?

    init(player: AVPlayer) {
        self.player = player
    }

    deinit {
        status?.invalidate()
        playback?.invalidate()
        buffer?.invalidate()
        if let time { player.removeTimeObserver(time) }
        if let end { NotificationCenter.default.removeObserver(end) }
        if let stall { NotificationCenter.default.removeObserver(stall) }
        if let access { NotificationCenter.default.removeObserver(access) }
        if let error { NotificationCenter.default.removeObserver(error) }
    }
}

extension CMTime {
    var playbackSeconds: TimeInterval? {
        let value = seconds
        return value.isFinite && value >= 0 ? value : nil
    }
}
