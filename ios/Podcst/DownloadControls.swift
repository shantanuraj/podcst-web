import Observation
import SwiftUI

struct DownloadMenuActions: View {
    @Environment(MediaStore.self) private var media
    @Environment(DownloadAlertState.self) private var alerts
    let episode: Episode

    var body: some View {
        switch media.status(for: episode) {
        case .notDownloaded:
            action("Download episode", systemImage: "arrow.down.circle", operation: .download)
        case .downloading:
            action("Pause download", systemImage: "pause.circle", operation: .pause)
            remove
        case .paused:
            action("Resume download", systemImage: "arrow.down.circle", operation: .retry)
            remove
        case .failed:
            action("Retry download", systemImage: "arrow.clockwise", operation: .retry)
            remove
        case .available:
            remove
        }
    }

    private var remove: some View {
        Button("Remove download", systemImage: "trash", role: .destructive) {
            perform(.remove)
        }
    }

    private func action(_ title: String, systemImage: String, operation: DownloadOperation) -> some View {
        Button(title, systemImage: systemImage) { perform(operation) }
    }

    private func perform(_ operation: DownloadOperation) {
        Task { await operation.perform(for: episode, media: media, alerts: alerts) }
    }
}

struct DownloadButton: View {
    let episode: Episode
    var compact = false

    var body: some View {
        DownloadActionButton(episode: episode, compact: compact)
            .downloadAlerts()
    }
}

private struct DownloadActionButton: View {
    @Environment(MediaStore.self) private var media
    @Environment(DownloadAlertState.self) private var alerts
    let episode: Episode
    let compact: Bool

    private var status: MediaDownloadState { media.status(for: episode) }

    var body: some View {
        Group {
            if case .available = status {
                Menu {
                    DownloadMenuActions(episode: episode)
                } label: {
                    label
                }
                .accessibilityLabel("Download options for \(episode.title)")
            } else {
                Button {
                    Task { await operation.perform(for: episode, media: media, alerts: alerts) }
                } label: {
                    label
                }
                .accessibilityLabel("\(actionTitle) for \(episode.title)")
            }
        }
        .buttonStyle(.plain)
        .accessibilityValue(status.downloadDescription)
    }

    private var label: some View {
        HStack(spacing: 8) {
            ZStack {
                if case .downloading = status {
                    if let progress = status.downloadProgress {
                        Circle()
                            .stroke(PodcstPalette.rule, lineWidth: 2)
                        Circle()
                            .trim(from: 0, to: progress)
                            .stroke(PodcstPalette.accent, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                        Image(systemName: "pause.fill")
                            .font(.system(size: 8, weight: .semibold))
                    } else {
                        Image(systemName: "pause.circle")
                    }
                } else {
                    Image(systemName: symbol)
                }
            }
            .frame(width: 22, height: 22)
            .accessibilityHidden(true)
            if !compact {
                Text(buttonTitle)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .font(.sans(.footnote).weight(.semibold))
        .foregroundStyle(PodcstPalette.accent)
        .padding(.horizontal, compact ? 0 : 12)
        .frame(minWidth: 44, minHeight: 44)
        .background(PodcstPalette.accentSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .contentShape(Rectangle())
    }

    private var operation: DownloadOperation {
        switch status {
        case .downloading: .pause
        case .paused, .failed: .retry
        case .notDownloaded: .download
        case .available: .remove
        }
    }

    private var actionTitle: String {
        switch status {
        case .notDownloaded: "Download"
        case .downloading: "Pause download"
        case .paused: "Resume download"
        case .failed: "Retry download"
        case .available: "Download options"
        }
    }

    private var buttonTitle: String {
        switch status {
        case .notDownloaded: "Download"
        case .downloading: status.downloadProgress.map { $0.formatted(.percent.precision(.fractionLength(0))) } ?? "Downloading"
        case .paused: "Resume"
        case .failed: "Retry"
        case .available: "Downloaded"
        }
    }

    private var symbol: String {
        switch status {
        case .available: "checkmark.circle.fill"
        case .failed: "arrow.clockwise"
        case .paused: "arrow.down.circle"
        case .notDownloaded: "arrow.down"
        case .downloading: "pause.circle"
        }
    }
}

extension MediaDownloadState {
    var downloadProgress: Double? {
        switch self {
        case .downloading(let received, let total), .paused(let received, let total):
            guard let total, total > 0 else { return nil }
            return min(1, max(0, Double(received) / Double(total)))
        default:
            return nil
        }
    }

    var downloadedBytes: Int64? {
        guard case .available(let bytes) = self else { return nil }
        return bytes
    }

    var downloadDescription: String {
        switch self {
        case .notDownloaded:
            return "Not downloaded"
        case .downloading(let received, let total):
            return "Downloading · \(Self.byteProgress(received: received, total: total))"
        case .paused(let received, let total):
            return "Paused · \(Self.byteProgress(received: received, total: total))"
        case .available(let bytes):
            return "Available offline · \(Self.byteCount(bytes))"
        case .failed:
            return "Download failed"
        }
    }

    private static func byteProgress(received: Int64, total: Int64?) -> String {
        guard let total, total > 0 else { return byteCount(received) }
        return "\(byteCount(received)) of \(byteCount(total))"
    }

    private static func byteCount(_ value: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: max(0, value), countStyle: .file)
    }
}

enum DownloadOperation {
    case download
    case pause
    case retry
    case remove

    @MainActor
    func perform(for episode: Episode, media: MediaStore, alerts: DownloadAlertState) async {
        let accountID = media.accountID
        do {
            switch self {
            case .download: try await media.download(episode)
            case .pause: await media.cancel(episode)
            case .retry: try await media.retry(episode)
            case .remove: try await media.remove(episode)
            }
        } catch {
            guard media.accountID == accountID,
                  !(error is CancellationError),
                  (error as? MediaFailure) != .cancelled else { return }
            alerts.message = Self.message(for: error)
        }
    }

    private static func message(for error: Error) -> String {
        switch error as? MediaFailure {
        case .invalidSource:
            "This episode doesn’t have a downloadable audio file."
        case .representationChanged:
            "The episode’s audio has changed. Retry to download the current version."
        case .storageUnavailable:
            "This download couldn’t be saved or removed. Check available storage and try again."
        case .pinned:
            "This episode is still in use by the player. Play another episode before removing its download."
        case .unsupportedMedia:
            "This audio format isn’t supported for downloading."
        case .accountChanged:
            "Your account changed. Please try again."
        default:
            "The download couldn’t be completed. Check your connection and try again."
        }
    }
}

@MainActor
@Observable
final class DownloadAlertState {
    var message: String?
}

private struct DownloadAlertsModifier: ViewModifier {
    @State private var alerts = DownloadAlertState()

    func body(content: Content) -> some View {
        content
            .environment(alerts)
            .alert("Download", isPresented: Binding(
                get: { alerts.message != nil },
                set: { if !$0 { alerts.message = nil } }
            )) {
                Button("OK", role: .cancel) { alerts.message = nil }
            } message: {
                Text(alerts.message ?? "")
            }
    }
}

extension View {
    func downloadAlerts() -> some View {
        modifier(DownloadAlertsModifier())
    }
}
