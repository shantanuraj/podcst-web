import SwiftUI
import UIKit

enum ShareMode: Hashable, CaseIterable {
    case show
    case episode
    case time
    case chapter
    case clip
}

struct ShareRequest: Identifiable {
    enum Subject {
        case podcast(Podcast)
        case episode(Episode)
    }

    let id = UUID()
    let subject: Subject
    let mode: ShareMode
    var chapter: Int? = nil

    static func podcast(_ podcast: Podcast) -> ShareRequest {
        ShareRequest(subject: .podcast(podcast), mode: .show)
    }

    static func episode(_ episode: Episode, mode: ShareMode = .episode, chapter: Int? = nil) -> ShareRequest {
        ShareRequest(subject: .episode(episode), mode: mode, chapter: chapter)
    }
}

extension View {
    func shareSheet(_ request: Binding<ShareRequest?>) -> some View {
        sheet(item: request) { ShareSheetHost(request: $0) }
    }
}

private struct ShareSheetHost: View {
    @Environment(PlaybackController.self) private var playback
    @Environment(LibraryStore.self) private var library
    let request: ShareRequest

    var body: some View {
        switch request.subject {
        case .podcast(let podcast):
            ShareSheet(request: request, episode: nil, show: podcast, position: 0, playhead: nil, duration: 0, chapters: [])
        case .episode(let episode):
            let playhead = playback.position(of: episode)
            ShareSheet(
                request: request,
                episode: episode,
                show: episode.podcast,
                position: playhead ?? library.progress(for: episode)?.position ?? 0,
                playhead: playhead,
                duration: playhead != nil && playback.duration > 0 ? playback.duration : episode.duration ?? 0,
                chapters: playhead != nil ? playback.chapters : ShowNotesParser.chapters(ShowNotesParser.notes(of: episode))
            )
        }
    }
}

private struct ShareSheet: View {
    private enum TimeField {
        case time, start, end, length

        var title: String {
            switch self {
            case .time, .start: "Start"
            case .end: "End"
            case .length: "Length"
            }
        }
    }

    @Environment(\.dismiss) private var dismiss
    @Environment(PlaybackController.self) private var playback
    let episode: Episode?
    let show: Podcast
    let playhead: TimeInterval?
    let duration: TimeInterval
    let chapters: [Chapter]
    @State private var mode: ShareMode
    @State private var chapter: Int
    @State private var start: TimeInterval
    @State private var clipStart: TimeInterval
    @State private var clipEnd: TimeInterval
    @State private var detent: PresentationDetent
    @State private var editing: TimeField?
    @State private var draft = ""
    @State private var copied = false
    @State private var preview = ClipPreview()

    init(request: ShareRequest, episode: Episode?, show: Podcast, position: TimeInterval, playhead: TimeInterval?, duration: TimeInterval, chapters: [Chapter]) {
        self.episode = episode
        self.show = show
        self.playhead = playhead
        self.duration = duration
        self.chapters = chapters
        let start = position.rounded(.down)
        let mode = request.mode == .chapter && chapters.count < 2 ? .time : request.mode
        _mode = State(initialValue: mode)
        _chapter = State(initialValue: request.chapter ?? chapters.index(at: position) ?? 0)
        _start = State(initialValue: start)
        _clipStart = State(initialValue: start)
        _clipEnd = State(initialValue: duration > 0 ? min(start + 60, duration.rounded(.down)) : start + 60)
        _detent = State(initialValue: Self.detent(for: mode))
    }

    private static func detent(for mode: ShareMode) -> PresentationDetent {
        mode == .chapter || mode == .clip ? .large : .medium
    }

    private var limit: TimeInterval { duration > 0 ? duration.rounded(.down) : TimeInterval(PublicLink.maxSeconds) }

    private var modes: [ShareMode] {
        guard episode != nil else { return [.show] }
        return ShareMode.allCases.filter { $0 != .chapter || chapters.count >= 2 }
    }

    private var link: PublicLink? {
        guard let episodeLink = episode?.publicLink else { return show.publicLink }
        switch mode {
        case .show: return PublicLink(podcastId: episodeLink.podcastId)
        case .episode: return episodeLink
        case .time: return episodeLink.with(.time(start))
        case .clip: return episodeLink.with(.clip(clipStart, clipEnd))
        case .chapter:
            guard chapters.indices.contains(chapter) else { return nil }
            return episodeLink.with(.chapter(chapter + 1, chapters[chapter].start, chapters.end(of: chapter, duration: duration)))
        }
    }

    private var title: String { mode == .show ? show.title : episode?.title ?? show.title }

    private var unavailable: String {
        switch mode {
        case .clip: "A clip must be at least one second long."
        case .chapter: "This chapter's length isn't known yet."
        default: "This can't be shared."
        }
    }

    private func label(_ mode: ShareMode) -> String {
        switch mode {
        case .show: "Show"
        case .episode: "Episode"
        case .time: "From \(Duration.clock(start))"
        case .chapter: "Chapter"
        case .clip: "Clip"
        }
    }

    var body: some View {
        let url = link?.url
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("Share")
                        .font(.serif(.title))
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(PodcstPalette.secondary)
                            .frame(width: 30, height: 30)
                            .background(PodcstPalette.rule, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close")
                }
                if modes.count > 1 {
                    ModePicker(modes: modes, selection: $mode, label: label)
                }
                content
            }
            .padding(.horizontal, 20)
            .padding(.top, 24)
            .padding(.bottom, 16)
        }
        .scrollBounceBehavior(.basedOnSize)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            actions(url)
                .padding(.horizontal, 20)
                .padding(.top, 10)
                .padding(.bottom, 8)
                .background(PodcstPalette.surface)
        }
        .foregroundStyle(PodcstPalette.ink)
        .presentationBackground(PodcstPalette.surface)
        .presentationDetents([.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .onChange(of: mode) { _, mode in
            preview.stop()
            withAnimation(.snappy) { detent = Self.detent(for: mode) }
        }
        .onChange(of: clipStart) { preview.stop() }
        .onChange(of: clipEnd) { preview.stop() }
        .onChange(of: url) { copied = false }
        .onDisappear { preview.stop() }
        .task(id: copied) {
            guard copied, (try? await Task.sleep(for: .seconds(1.6))) != nil else { return }
            copied = false
        }
        .alert(editing?.title ?? "", isPresented: Binding { editing != nil } set: { if !$0 { editing = nil } }) {
            TextField("m:ss", text: $draft)
                .keyboardType(.numbersAndPunctuation)
            Button("Set") { apply() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Type a time as m:ss or h:mm:ss.")
        }
    }

    @ViewBuilder
    private var content: some View {
        switch mode {
        case .show:
            PreviewCard(cover: show.artworkURL, eyebrow: "Podcast", title: show.title, footer: "podcst.app")
        case .episode:
            PreviewCard(cover: episode?.artworkURL ?? show.artworkURL, eyebrow: "Episode", title: title, footer: "podcst.app · \(show.title)")
        case .time:
            PreviewCard(cover: episode?.artworkURL ?? show.artworkURL, eyebrow: "Listen from \(Duration.clock(start))", title: title, footer: "podcst.app · \(show.title)")
            startRow
        case .chapter:
            chapterList
        case .clip:
            clipEditor
        }
    }

    private var startRow: some View {
        HStack(spacing: 10) {
            Button { edit(.time, start) } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Starts at")
                        .font(.sans(.footnote))
                        .foregroundStyle(PodcstPalette.tertiary)
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(Duration.clock(start))
                            .font(.sans(.title2).weight(.medium))
                            .monospacedDigit()
                        Text("plays to the end")
                            .font(.sans(.footnote))
                            .foregroundStyle(PodcstPalette.tertiary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Type a start time")
            nudge("−15", by: -15)
            nudge("+15", by: 15)
        }
    }

    private func nudge(_ title: String, by seconds: TimeInterval) -> some View {
        Button { start = min(max(0, start + seconds), max(0, limit - 1)) } label: {
            Text(title)
                .font(.sans(.caption).weight(.semibold))
                .frame(width: 44, height: 44)
                .background(PodcstPalette.rule, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(seconds < 0 ? "Start 15 seconds earlier" : "Start 15 seconds later")
    }

    private var chapterList: some View {
        VStack(spacing: 0) {
            ForEach(chapters.indices, id: \.self) { index in
                let selected = index == chapter
                let item = chapters[index]
                Button { chapter = index } label: {
                    HStack(spacing: 12) {
                        Text(Duration.clock(item.start))
                            .font(.sans(.caption).weight(.medium))
                            .monospacedDigit()
                            .foregroundStyle(selected ? PodcstPalette.accent : PodcstPalette.tertiary)
                            .frame(minWidth: 44, alignment: .leading)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(item.title)
                                .font(.sans(.callout))
                                .foregroundStyle(selected ? PodcstPalette.ink : PodcstPalette.secondary)
                                .lineLimit(1)
                            Text(Duration.seconds(chapters.end(of: index, duration: duration) - item.start))
                                .font(.sans(.caption))
                                .foregroundStyle(PodcstPalette.tertiary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        if selected {
                            Image(systemName: "checkmark")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(PodcstPalette.accent)
                        }
                    }
                    .padding(.horizontal, 14)
                    .frame(minHeight: 52)
                    .hairline(index < chapters.count - 1)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .background(PodcstPalette.paper, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    @ViewBuilder
    private var clipEditor: some View {
        HStack(spacing: 12) {
            ArtworkView(url: episode?.artworkURL, fallbackURL: show.artworkURL, size: 44)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.serif(.headline))
                    .lineLimit(1)
                Text([show.title, duration > 0 ? Duration.seconds(duration) : nil].compactMap { $0 }.joined(separator: " · "))
                    .font(.sans(.caption))
                    .foregroundStyle(PodcstPalette.tertiary)
                    .lineLimit(1)
            }
        }
        Trimmer(start: $clipStart, end: $clipEnd, limit: limit, playhead: preview.position ?? playhead)
        HStack(spacing: 0) {
            field(.start, clipStart)
            field(.end, clipEnd)
            field(.length, clipEnd - clipStart)
        }
        .background(PodcstPalette.paper, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        if let episode, episode.audioURL != nil {
            Button {
                if preview.position != nil {
                    preview.stop()
                } else {
                    if playback.isPlaybackRequested { playback.pause() }
                    preview.play(episode, from: clipStart, to: clipEnd)
                }
            } label: {
                Label(preview.position.map { "Previewing · \(Duration.clock($0))" } ?? "Preview clip", systemImage: preview.position == nil ? "play.fill" : "pause.fill")
                    .font(.sans(.subheadline).weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(PodcstPalette.accent)
                    .padding(.horizontal, 14)
                    .frame(height: 44)
                    .background(PodcstPalette.accentSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(clipEnd <= clipStart)
        }
    }

    private func field(_ field: TimeField, _ value: TimeInterval) -> some View {
        Button { edit(field, value) } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(field.title)
                    .font(.sans(.caption))
                    .foregroundStyle(PodcstPalette.tertiary)
                Text(Duration.clock(value))
                    .font(.sans(.title3).weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(field == .length ? PodcstPalette.secondary : PodcstPalette.ink)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .trailing) {
                if field != .length { PodcstPalette.rule.frame(width: 1) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Type a time")
    }

    private func actions(_ url: URL?) -> some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                Button {
                    UIPasteboard.general.url = url
                    copied = true
                } label: {
                    Label(copied ? "Copied" : "Copy link", systemImage: copied ? "checkmark" : "link")
                }
                .buttonStyle(PodcstButtonStyle(kind: .surface))
                .sensoryFeedback(.success, trigger: copied) { _, copied in copied }
                if let url {
                    ShareLink(item: url, subject: Text(title), message: Text(title)) {
                        Label("Share…", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(PodcstButtonStyle(kind: .accent))
                } else {
                    Button {} label: {
                        Label("Share…", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(PodcstButtonStyle(kind: .accent))
                }
            }
            .disabled(url == nil)
            if url == nil {
                Text(unavailable)
                    .font(.sans(.footnote))
                    .foregroundStyle(PodcstPalette.secondary)
            }
        }
    }

    private func edit(_ field: TimeField, _ value: TimeInterval) {
        draft = Duration.clock(value)
        editing = field
    }

    private func apply() {
        guard let field = editing, let value = ShowNotesParser.seconds(from: draft.trimmingCharacters(in: .whitespaces)) else { return }
        switch field {
        case .time: start = min(value, max(0, limit - 1))
        case .start: clipStart = min(value, clipEnd - 1)
        case .end: clipEnd = min(max(value, clipStart + 1), limit)
        case .length: clipEnd = min(clipStart + max(1, value), limit)
        }
    }
}

private struct ModePicker: View {
    let modes: [ShareMode]
    @Binding var selection: ShareMode
    let label: (ShareMode) -> String

    var body: some View {
        HStack(spacing: 2) {
            ForEach(modes, id: \.self) { mode in
                let selected = mode == selection
                Button { selection = mode } label: {
                    Text(label(mode))
                        .font(.sans(.caption).weight(selected ? .semibold : .medium))
                        .monospacedDigit()
                        .foregroundStyle(selected ? PodcstPalette.ink : PodcstPalette.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .frame(maxWidth: .infinity, minHeight: 30)
                        .background(selected ? PodcstPalette.rule : .clear, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(2)
        .background(PodcstPalette.paper, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
    }
}

private struct PreviewCard: View {
    let cover: URL?
    let eyebrow: String
    let title: String
    let footer: String
    @State private var tint: ArtworkTint?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .bottom, spacing: 12) {
                ArtworkView(url: cover, size: 64)
                    .shadow(color: .black.opacity(0.3), radius: 10, y: 8)
                VStack(alignment: .leading, spacing: 3) {
                    Text(eyebrow).eyebrow(PodcstPalette.secondary)
                    Text(title)
                        .font(.serif(.title3))
                        .lineLimit(2)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 120, alignment: .bottomLeading)
            .background {
                LinearGradient(colors: [tint.map { Color(light: $0.light, dark: $0.dark) } ?? PodcstPalette.cream, PodcstPalette.cream], startPoint: .topLeading, endPoint: .bottomTrailing)
            }
            Text(footer)
                .font(.sans(.caption))
                .foregroundStyle(PodcstPalette.tertiary)
                .lineLimit(1)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
        }
        .background(PodcstPalette.paper)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
        .task(id: cover) { tint = await ArtworkStore.shared.tint(cover) }
    }
}

private struct Trimmer: View {
    private enum Handle {
        case start, end
    }

    @Binding var start: TimeInterval
    @Binding var end: TimeInterval
    let limit: TimeInterval
    let playhead: TimeInterval?
    @State private var frozen: ClosedRange<TimeInterval>?
    @State private var dragging: Handle?
    private let grip: CGFloat = 14

    private var window: ClosedRange<TimeInterval> {
        if let frozen { return frozen }
        let span = min(max(480, (end - start) * 1.5), max(limit, 1))
        let lower = max(0, min((start + end - span) / 2, limit - span))
        return lower...(lower + span)
    }

    var body: some View {
        let window = window
        let span = window.upperBound - window.lowerBound
        VStack(spacing: 10) {
            GeometryReader { geometry in
                let usable = max(1, geometry.size.width - grip * 2)
                let x = { (time: TimeInterval) in grip + CGFloat((time - window.lowerBound) / span) * usable }
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(PodcstPalette.ink.opacity(0.14))
                        .frame(height: 6)
                        .padding(.horizontal, grip)
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(PodcstPalette.accent.opacity(0.16))
                        .overlay {
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .strokeBorder(PodcstPalette.accent, lineWidth: 2.5)
                        }
                        .frame(width: max(0, x(end) - x(start)) + grip * 2)
                        .offset(x: x(start) - grip)
                    if let playhead, window.contains(playhead) {
                        Capsule()
                            .fill(PodcstPalette.ink)
                            .frame(width: 2)
                            .offset(x: x(playhead) - 1)
                            .allowsHitTesting(false)
                    }
                    handle(.start, window: window, usable: usable)
                        .offset(x: x(start) - grip)
                    handle(.end, window: window, usable: usable)
                        .offset(x: x(end))
                }
                .frame(maxHeight: .infinity)
                .coordinateSpace(.named("trimmer"))
            }
            .frame(height: 64)
            HStack {
                Text(Duration.clock(window.lowerBound))
                Spacer()
                Text(Duration.clock(window.upperBound))
            }
            .font(.sans(.caption2).weight(.medium))
            .monospacedDigit()
            .foregroundStyle(PodcstPalette.muted)
            GeometryReader { geometry in
                let total = max(limit, window.upperBound)
                ZStack(alignment: .leading) {
                    Capsule().fill(PodcstPalette.ink.opacity(0.12)).frame(height: 2)
                    Capsule()
                        .fill(PodcstPalette.accent)
                        .frame(width: max(4, geometry.size.width * span / total), height: 4)
                        .offset(x: geometry.size.width * window.lowerBound / total)
                }
                .frame(maxHeight: .infinity)
            }
            .frame(height: 4)
            .accessibilityHidden(true)
        }
        .padding(14)
        .background(PodcstPalette.paper, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .sensoryFeedback(.selection, trigger: Int(start)) { _, _ in dragging == .start }
        .sensoryFeedback(.selection, trigger: Int(end)) { _, _ in dragging == .end }
    }

    private func handle(_ handle: Handle, window: ClosedRange<TimeInterval>, usable: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
            .fill(PodcstPalette.accent)
            .overlay { Capsule().fill(.white).frame(width: 3, height: 16) }
            .frame(width: grip)
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle().inset(by: -12))
            .gesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .named("trimmer"))
                    .onChanged { value in
                        if dragging == nil {
                            frozen = window
                            dragging = handle
                        }
                        let time = (window.lowerBound + Double((value.location.x - grip) / usable) * (window.upperBound - window.lowerBound)).rounded()
                        switch handle {
                        case .start: start = min(max(0, time), end - 1)
                        case .end: end = max(min(limit, time), start + 1)
                        }
                    }
                    .onEnded { _ in
                        dragging = nil
                        withAnimation(.snappy) { frozen = nil }
                    }
            )
            .accessibilityElement()
            .accessibilityLabel(handle == .start ? "Clip start" : "Clip end")
            .accessibilityValue(Duration.clock(handle == .start ? start : end))
            .accessibilityAdjustableAction { direction in
                let step: TimeInterval = direction == .increment ? 1 : -1
                switch handle {
                case .start: start = min(max(0, start + step), end - 1)
                case .end: end = max(min(limit, end + step), start + 1)
                }
            }
    }
}

@MainActor
@Observable
private final class ClipPreview {
    private(set) var position: TimeInterval?
    @ObservationIgnored private let transport = AVPlayerTransport()
    @ObservationIgnored private var end: TimeInterval = 0
    @ObservationIgnored private var request = UUID()

    init() {
        transport.onUpdate = { [weak self] update in self?.handle(update.event) }
    }

    func play(_ episode: Episode, from start: TimeInterval, to end: TimeInterval) {
        stop()
        let request = UUID()
        self.request = request
        self.end = end
        position = start
        Task {
            try? await PlaybackAudioSession.prepare(forPlayback: true)
            guard self.request == request, self.position != nil else { return }
            self.transport.load(source: .episode(episode), at: start, generation: request)
        }
    }

    func stop() {
        request = UUID()
        transport.stop()
        position = nil
    }

    private func handle(_ event: PlaybackTransportEvent) {
        guard position != nil else { return }
        switch event {
        case .ready: transport.play(atRate: 1)
        case .position(let time): if time >= end { stop() } else { position = time }
        case .ended, .failed: stop()
        default: break
        }
    }
}
