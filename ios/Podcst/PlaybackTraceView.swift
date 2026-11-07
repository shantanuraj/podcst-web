import AVFoundation
import Network
import SwiftUI
import UIKit

@MainActor
@Observable
final class PlaybackTraceController {
    struct Recording: Identifiable {
        let url: URL
        let date: Date
        let bytes: Int
        var id: URL { url }
    }

    static let shared = PlaybackTraceController()
    private(set) var isRecording = false
    private(set) var busy = false
    private(set) var recordings: [Recording] = []
    private(set) var markerCount = 0
    private(set) var error: String?
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var network: NWPathMonitor?
    @ObservationIgnored private var observers: [NSObjectProtocol] = []
    @ObservationIgnored private var currentURL: URL?
    @ObservationIgnored private weak var playback: PlaybackController?

    func refresh() {
        let urls = (try? FileManager.default.contentsOfDirectory(at: PlaybackTraceRecorder.directory, includingPropertiesForKeys: [.creationDateKey, .fileSizeKey])) ?? []
        recordings = urls.filter { $0.pathExtension == "jsonl" && $0 != currentURL }.compactMap { url in
            guard let values = try? url.resourceValues(forKeys: [.creationDateKey, .fileSizeKey]) else { return nil }
            return Recording(url: url, date: values.creationDate ?? .distantPast, bytes: values.fileSize ?? 0)
        }.sorted { $0.date > $1.date }
    }

    func start(playback: PlaybackController) async {
        guard !isRecording, !busy else { return }
        refresh()
        guard recordings.count < 10 else {
            error = "Share and delete an older recording before starting another."
            return
        }
        busy = true
        defer { busy = false }
        error = nil
        do {
            var labels = [
                "appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
                "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown",
                "systemVersion": UIDevice.current.systemVersion,
                "deviceModel": hardwareModel,
                "configuration": "unknown",
            ]
            let metadataURL = Bundle.main.url(forResource: "PlaybackTraceBuild", withExtension: "json")
                ?? Bundle.main.url(forResource: "AudioLabBuild", withExtension: "json")
            if let url = metadataURL,
               let data = try? Data(contentsOf: url),
               let build = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                for key in ["revision", "configuration", "builtAt"] { if let value = build[key] as? String { labels[key] = value } }
                if let dirty = build["workingTreeDirty"] as? Bool { labels["workingTreeDirty"] = String(dirty) }
            }
            currentURL = try await PlaybackTraceRecorder.shared.start(labels: labels)
            self.playback = playback
            markerCount = 0
            isRecording = true
            monitorNotifications()
            let monitor = NWPathMonitor()
            monitor.pathUpdateHandler = { path in
                PlaybackTraceRecorder.shared.record("network_path", values: ["satisfied": path.status == .satisfied ? 1 : 0, "expensive": path.isExpensive ? 1 : 0, "constrained": path.isConstrained ? 1 : 0], labels: ["interface": path.usesInterfaceType(.wifi) ? "wifi" : path.usesInterfaceType(.cellular) ? "cellular" : path.usesInterfaceType(.wiredEthernet) ? "wired" : "other"])
            }
            network = monitor
            monitor.start(queue: DispatchQueue(label: "app.podcst.playback-trace.network", qos: .utility))
            sample(elapsed: 0)
            task = Task { [weak self] in
                var previous = PlaybackTraceRecorder.now
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(1)) } catch { return }
                    guard let self else { return }
                    let now = PlaybackTraceRecorder.now
                    self.sample(elapsed: now - previous)
                    previous = now
                    let status = PlaybackTraceRecorder.shared.status
                    if !status.recording {
                        self.error = status.failure
                        await self.stop()
                        return
                    }
                }
            }
        } catch {
            self.error = "Couldn’t start a playback recording. Check available storage and try again."
        }
    }

    func stop() async {
        guard isRecording else { return }
        busy = true
        task?.cancel()
        task = nil
        network?.cancel()
        network = nil
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers = []
        _ = await PlaybackTraceRecorder.shared.stop()
        currentURL = nil
        playback = nil
        isRecording = false
        busy = false
        error = PlaybackTraceRecorder.shared.status.failure ?? error
        refresh()
    }

    func markGlitch() {
        guard isRecording else { return }
        markerCount += 1
        PlaybackTraceRecorder.shared.record("user_glitch", values: playbackValues.merging(["marker": Double(markerCount)]) { _, new in new })
    }

    func delete(_ recording: Recording) {
        do { try FileManager.default.removeItem(at: recording.url); refresh() }
        catch { self.error = "Couldn’t delete this recording." }
    }

    private var playbackValues: [String: Double] {
        guard let playback else { return [:] }
        var values = ["position": playback.currentTime, "duration": playback.duration, "playing": playback.isPlaying ? 1.0 : 0.0, "requested": playback.isPlaybackRequested ? 1.0 : 0.0, "active": playback.isActive ? 1.0 : 0.0]
        if let id = playback.currentEpisode?.id { values["episodeId"] = Double(id) }
        if let id = playback.currentEpisode?.podcastId { values["podcastId"] = Double(id) }
        return values
    }

    private func sample(elapsed: TimeInterval) {
        let session = AVAudioSession.sharedInstance()
        var values = playbackValues
        values["mainTickSeconds"] = elapsed
        values["outputSampleRate"] = session.sampleRate
        values["ioBufferSeconds"] = session.ioBufferDuration
        values["outputLatencySeconds"] = session.outputLatency
        values["thermalState"] = Double(ProcessInfo.processInfo.thermalState.rawValue)
        values["lowPower"] = ProcessInfo.processInfo.isLowPowerModeEnabled ? 1 : 0
        values["applicationState"] = Double(UIApplication.shared.applicationState.rawValue)
        PlaybackTraceRecorder.shared.record("phone_sample", values: values, labels: ["route": session.currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: ","), "playbackState": playback?.state.rawValue ?? "unavailable"])
    }

    private func monitorNotifications() {
        let names: [(Notification.Name, String)] = [
            (AVAudioSession.interruptionNotification, "audio_interruption"),
            (AVAudioSession.routeChangeNotification, "audio_route_change"),
            (AVAudioSession.mediaServicesWereResetNotification, "audio_services_reset"),
            (UIApplication.didEnterBackgroundNotification, "app_background"),
            (UIApplication.willEnterForegroundNotification, "app_foreground"),
            (UIApplication.didReceiveMemoryWarningNotification, "memory_warning"),
            (ProcessInfo.thermalStateDidChangeNotification, "thermal_change"),
        ]
        observers = names.map { name, event in
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { notification in
                var values: [String: Double] = [:]
                for key in [AVAudioSessionInterruptionTypeKey, AVAudioSessionInterruptionOptionKey, AVAudioSessionRouteChangeReasonKey] {
                    if let number = notification.userInfo?[key] as? NSNumber { values[key] = number.doubleValue }
                }
                PlaybackTraceRecorder.shared.record(event, values: values)
            }
        }
    }

    private var hardwareModel: String {
        if let simulator = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] { return "simulator-\(simulator)" }
        var system = utsname()
        uname(&system)
        return withUnsafeBytes(of: &system.machine) { bytes in
            String(decoding: bytes.prefix { $0 != 0 }, as: UTF8.self)
        }
    }
}

struct PlaybackTraceView: View {
    @Environment(PlaybackController.self) private var playback
    @State private var trace = PlaybackTraceController.shared

    var body: some View {
        List {
            Section {
                Text("Record playback timing while you listen, including with the screen locked. Tap Mark glitch when you hear a problem; it’s also in the Now Playing menu.")
                Text("Recordings contain playback and network timing, public episode IDs, device model and audio settings. They contain no audio, account details or media URLs. Nothing is uploaded automatically.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if trace.isRecording {
                    Label("Recording playback", systemImage: "record.circle")
                        .foregroundStyle(PodcstPalette.accent)
                    Button("Mark glitch (\(trace.markerCount))") { trace.markGlitch() }
                    Button("Stop and save") { Task { await trace.stop() } }
                } else {
                    Button("Start recording") { Task { await trace.start(playback: playback) } }
                }
            }
            .disabled(trace.busy)
            if let error = trace.error {
                Section { Text(error).foregroundStyle(.red) }
            }
            Section {
                ForEach(trace.recordings) { recording in
                    ShareLink(item: recording.url) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(recording.date, format: .dateTime.month().day().hour().minute().second())
                            Text("Share recording · \(ByteCountFormatter.string(fromByteCount: Int64(recording.bytes), countStyle: .file))")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .swipeActions {
                        Button("Delete", role: .destructive) { trace.delete(recording) }
                    }
                }
                if trace.recordings.isEmpty { Text("Saved recordings appear here.").foregroundStyle(.secondary) }
            } header: {
                Text("Saved recordings")
            } footer: {
                Text("Up to 10 recordings, 64 MB each. Stop and save before sharing. If the app closes, reopen this screen to share the partial recording; start a new recording to continue.")
            }
        }
        .navigationTitle("Playback diagnostics")
        .task { trace.refresh() }
    }
}
