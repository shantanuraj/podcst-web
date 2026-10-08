import AVKit
import SwiftUI

enum PlayerPanel: String, CaseIterable, Identifiable {
    case chapters = "Chapters"
    case notes = "Notes"
    case upNext = "Up Next"

    var id: String { rawValue }
}

struct NowPlayingView: View {
    @Environment(PlaybackController.self) private var playback
    @Environment(Router.self) private var router
    @State private var panel: PlayerPanel?
    @State private var tint: ArtworkTint?

    private var panels: [PlayerPanel] {
        playback.chapters.isEmpty ? [.notes, .upNext] : PlayerPanel.allCases
    }

    var body: some View {
        Group {
            if let episode = playback.currentEpisode {
                if let clip = playback.clip {
                    ClipPlayer(episode: episode, clip: clip)
                        .transition(.opacity)
                } else if let panel {
                    VStack(spacing: 0) {
                        CompactPlayer(episode: episode) { self.panel = nil }
                        PanelTabs(panels: panels, selection: panel, height: 36) { self.panel = $0 }
                            .padding(.horizontal, 20)
                            .padding(.top, 18)
                        PanelContent(panel: panel, episode: episode)
                    }
                    .transition(.opacity)
                } else {
                    FullPlayer(episode: episode, panels: panels) { panel = $0 }
                        .transition(.opacity)
                }
            } else {
                EmptyState(systemImage: "waveform", title: "Nothing is playing", message: "Start an episode and it will play here.")
                    .frame(maxHeight: .infinity)
            }
        }
        .padding(.top, 22)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background {
            LinearGradient(
                stops: [
                    .init(color: tint.map { Color(light: $0.light, dark: $0.dark) } ?? PodcstPalette.cream, location: 0),
                    .init(color: PodcstPalette.paper, location: panel == nil ? 0.56 : 0.26),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            .animation(.easeInOut(duration: 0.4), value: tint)
        }
        .overlay(alignment: .bottom) {
            if let clip = playback.clip, clip.ended, let episode = playback.currentEpisode {
                ClipEndPanel(episode: episode, clip: clip)
            } else if let toast = router.toast {
                ToastView(toast: toast) { router.toast = nil }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 10)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .foregroundStyle(PodcstPalette.ink)
        .presentationBackground(PodcstPalette.paper)
        .downloadAlerts()
        .shareSheet(Binding { router.sharing } set: { router.sharing = $0 })
        .animation(.snappy(duration: 0.3), value: panel)
        .animation(.snappy, value: playback.clip)
        .animation(.snappy, value: router.toast)
        .onChange(of: panels) { _, available in
            if let panel, !available.contains(panel) { self.panel = available.first }
        }
        .task(id: playback.currentEpisode?.artworkURL) {
            tint = await ArtworkStore.shared.tint(playback.currentEpisode?.artworkURL)
        }
    }
}

private struct FullPlayer: View {
    @Environment(PlaybackController.self) private var playback
    @GestureState private var holdingTitle = false
    let episode: Episode
    let panels: [PlayerPanel]
    let open: (PlayerPanel) -> Void

    var body: some View {
        let chapters = playback.chapters
        VStack(spacing: 0) {
            ArtworkView(url: episode.artworkURL, fallbackURL: URL(string: episode.cover), chapterArtwork: playback.currentChapterArtwork)
                .frame(maxWidth: 300)
                .shadow(color: .black.opacity(0.4), radius: 30, y: 22)
                .padding(.horizontal, 16)
                .frame(minHeight: 140)
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    if let index = playback.currentChapterIndex {
                        Text("Chapter \(index + 1) of \(chapters.count) · \(chapters[index].title)")
                            .eyebrow(PodcstPalette.accent)
                            .lineLimit(1)
                    }
                    Text(episode.title)
                        .font(.serif(.title2))
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                        .gesture(
                            LongPressGesture(minimumDuration: 0.35)
                                .sequenced(before: DragGesture(minimumDistance: 0))
                                .updating($holdingTitle) { value, holding, _ in
                                    if case .second(true, _) = value { holding = true }
                                }
                        )
                        .accessibilityHint("Press and hold to play at double speed")
                    Text(episode.podcastTitle ?? "Podcst")
                        .font(.sans(.subheadline))
                        .foregroundStyle(PodcstPalette.secondary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 8) {
                    StarButton(episode: episode)
                    EpisodeMenu(episode: episode) { open(.notes) }
                }
                .padding(.top, playback.currentChapterIndex == nil ? 2 : 14)
            }
            .padding(.top, 26)
            SeekBar()
                .padding(.top, 20)
            Transport()
                .padding(.top, 14)
            AudioChips()
                .padding(.top, 14)
            Spacer(minLength: 16)
            PanelTabs(panels: panels, selection: nil, height: 40) { panel in
                if let panel { open(panel) }
            }
            .simultaneousGesture(
                DragGesture(minimumDistance: 16).onEnded { value in
                    if value.translation.height < -30, let first = panels.first { open(first) }
                }
            )
            .padding(.bottom, 12)
        }
        .padding(.horizontal, 28)
        .onChange(of: holdingTitle) { _, holding in
            playback.holdDoubleSpeed(holding)
        }
    }
}

private struct ClipPlayer: View {
    @Environment(PlaybackController.self) private var playback
    @Environment(LibraryStore.self) private var library
    let episode: Episode
    let clip: Clip

    var body: some View {
        VStack(spacing: 0) {
            Text(clip.chapter == nil ? "Shared clip" : "Shared chapter")
                .eyebrow(PodcstPalette.accent)
                .padding(.horizontal, 10)
                .frame(height: 26)
                .background(PodcstPalette.accent.opacity(0.18), in: Capsule())
            ArtworkView(url: episode.artworkURL, fallbackURL: URL(string: episode.cover), chapterArtwork: playback.currentChapterArtwork)
                .frame(maxWidth: 270)
                .shadow(color: .black.opacity(0.4), radius: 30, y: 22)
                .padding(.horizontal, 16)
                .padding(.top, 18)
                .frame(minHeight: 140)
            VStack(alignment: .leading, spacing: 4) {
                Text(episode.title)
                    .font(.serif(.title2))
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                Text(episode.podcastTitle ?? "Podcst")
                    .font(.sans(.subheadline))
                    .foregroundStyle(PodcstPalette.secondary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 26)
            if let number = clip.chapter {
                Text("Chapter \(number) · \(playback.chapterTitle(number))")
                    .eyebrow(PodcstPalette.accent)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 18)
            }
            SeekBar()
                .padding(.top, clip.chapter == nil ? 22 : 8)
            ClipPlacement(clip: clip, duration: playback.duration > 0 ? playback.duration : episode.duration ?? 0)
                .padding(.top, 12)
            HStack {
                Button { playback.replayClip() } label: {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.system(size: 24, weight: .medium))
                        .frame(width: 48, height: 48)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(clip.chapter == nil ? "Replay clip" : "Replay chapter")
                Spacer()
                PlayPauseButton(diameter: 72)
                Spacer()
                SpeedMenu()
                    .frame(width: 48)
            }
            .padding(.top, 16)
            Spacer(minLength: 16)
            HStack(spacing: 10) {
                Button("Play full episode") { playback.playFullEpisode() }
                    .buttonStyle(PodcstButtonStyle(kind: .surface))
                if !library.isSubscribed(episode.podcast) {
                    Button("Subscribe") { Task { await library.toggleSubscription(episode.podcast) } }
                        .buttonStyle(PodcstButtonStyle(kind: .surface))
                }
            }
            .padding(.bottom, 12)
        }
        .padding(.horizontal, 28)
    }
}

private struct ClipPlacement: View {
    let clip: Clip
    let duration: TimeInterval

    var body: some View {
        let total = max(duration, clip.end)
        VStack(alignment: .leading, spacing: 6) {
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(PodcstPalette.ink.opacity(0.12)).frame(height: 2)
                    Capsule()
                        .fill(PodcstPalette.accent)
                        .frame(width: max(4, geometry.size.width * (clip.end - clip.start) / total), height: 4)
                        .offset(x: geometry.size.width * clip.start / total)
                }
                .frame(maxHeight: .infinity)
            }
            .frame(height: 4)
            Text("\(Duration.clock(clip.start)) – \(Duration.clock(clip.end)) of \(Duration.seconds(total))")
                .font(.sans(.caption2))
                .monospacedDigit()
                .foregroundStyle(PodcstPalette.muted)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct ClipEndPanel: View {
    @Environment(PlaybackController.self) private var playback
    @Environment(LibraryStore.self) private var library
    @Environment(Router.self) private var router
    let episode: Episode
    let clip: Clip

    private var eyebrow: String {
        guard let number = clip.chapter else { return "Clip ended · \(Duration.clock(clip.start)) – \(Duration.clock(clip.end))" }
        let count = playback.chapters.count
        return count >= number ? "End of chapter \(number) of \(count)" : "End of chapter \(number)"
    }

    private var saved: TimeInterval? {
        guard let progress = library.progress(for: episode), !progress.completed, progress.position > 0 else { return nil }
        return progress.position
    }

    var body: some View {
        let chapters = playback.chapters
        ZStack(alignment: .bottom) {
            Color.black.opacity(0.5)
                .ignoresSafeArea()
            VStack(spacing: 10) {
                Text(eyebrow)
                    .eyebrow()
                Text(clip.chapter.map(playback.chapterTitle) ?? episode.title)
                    .font(.serif(.title2))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 12)
                if let saved {
                    Text("Your saved place in this episode is still \(Duration.clock(saved))")
                        .font(.sans(.footnote))
                        .foregroundStyle(PodcstPalette.tertiary)
                        .multilineTextAlignment(.center)
                }
                Group {
                    if let next = playback.nextClipChapter {
                        Button { playback.playNextClipChapter() } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "play.fill")
                                    .font(.system(size: 14))
                                VStack(alignment: .leading, spacing: 1) {
                                    Text("Next chapter")
                                        .font(.sans(.callout).weight(.semibold))
                                    Text("\(chapters[next].title) · \(Duration.seconds(chapters.end(of: next, duration: playback.duration) - chapters[next].start))")
                                        .font(.sans(.caption))
                                        .opacity(0.85)
                                        .lineLimit(1)
                                }
                                Spacer(minLength: 0)
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 18)
                            .frame(maxWidth: .infinity, minHeight: 60)
                            .background(PodcstPalette.accent, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    } else {
                        Button { playback.resume() } label: {
                            Label("Keep listening from \(Duration.clock(clip.end))", systemImage: "play.fill")
                        }
                        .buttonStyle(PodcstButtonStyle(kind: .accent, height: 52))
                    }
                }
                .padding(.top, 10)
                Button(clip.chapter == nil ? "Replay clip" : "Replay chapter") { playback.replayClip() }
                    .buttonStyle(PodcstButtonStyle(kind: .surface, height: 52))
                Button("Add episode to queue") {
                    router.showingPlayer = false
                    playback.closeClip(enqueueing: true)
                }
                .buttonStyle(PodcstButtonStyle(kind: .surface, height: 52))
                Button {
                    router.showingPlayer = false
                    playback.closeClip()
                } label: {
                    Text("Close")
                        .font(.sans(.callout).weight(.medium))
                        .foregroundStyle(PodcstPalette.secondary)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20)
            .padding(.top, 28)
            .padding(.bottom, 22)
            .background(PodcstPalette.surface, in: RoundedRectangle(cornerRadius: 40, style: .continuous))
            .accessibilityAddTraits(.isModal)
            .padding(8)
            .transition(.move(edge: .bottom))
        }
        .transition(.opacity)
    }
}

private extension PlaybackController {
    func chapterTitle(_ number: Int) -> String {
        chapters.indices.contains(number - 1) ? chapters[number - 1].title : "Chapter \(number)"
    }
}

private struct CompactPlayer: View {
    @Environment(PlaybackController.self) private var playback
    let episode: Episode
    let expand: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            HStack(spacing: 12) {
                Button(action: expand) {
                    HStack(spacing: 12) {
                        ArtworkView(url: episode.artworkURL, fallbackURL: URL(string: episode.cover), size: 56, chapterArtwork: playback.currentChapterArtwork)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(episode.title)
                                .font(.serif(.title3))
                                .lineLimit(1)
                            Text("\(episode.podcastTitle ?? "Podcst") · −\(Duration.clock(playback.remaining))")
                                .font(.sans(.caption))
                                .monospacedDigit()
                                .foregroundStyle(PodcstPalette.secondary)
                                .lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Show the full player")
                Button { playback.skipBackward() } label: {
                    Image(systemName: "gobackward.10")
                        .font(.sans(.title3))
                        .frame(width: 40, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Back 10 seconds")
                PlayPauseButton(diameter: 44)
            }
            SeekBar(compact: true)
        }
        .padding(.horizontal, 20)
        .contentShape(Rectangle())
        .simultaneousGesture(
            DragGesture(minimumDistance: 16).onEnded { value in
                if value.translation.height > 40 { expand() }
            }
        )
    }
}

private struct PanelContent: View {
    @Environment(Router.self) private var router
    let panel: PlayerPanel
    let episode: Episode

    var body: some View {
        ScrollView {
            switch panel {
            case .chapters: ChaptersPanel()
            case .notes: NotesPanel(episode: episode)
            case .upNext: UpNextPanel()
            }
        }
        .scrollIndicators(.hidden)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if panel == .notes {
                HStack(spacing: 10) {
                    Button { router.open(.episode(episode)) } label: {
                        Label("Episode page", systemImage: "chevron.right")
                            .labelStyle(TrailingIconLabelStyle())
                    }
                    Button { router.open(.podcast(episode.podcast)) } label: {
                        Label("Go to podcast", systemImage: "chevron.right")
                            .labelStyle(TrailingIconLabelStyle())
                    }
                }
                .buttonStyle(PodcstButtonStyle(kind: .surface))
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 8)
                .background {
                    LinearGradient(stops: [.init(color: PodcstPalette.paper.opacity(0), location: 0), .init(color: PodcstPalette.paper, location: 0.35)], startPoint: .top, endPoint: .bottom)
                        .ignoresSafeArea()
                }
            }
        }
    }
}

private struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.title
            configuration.icon.font(.sans(.caption).weight(.bold))
        }
    }
}

private struct ChaptersPanel: View {
    @Environment(PlaybackController.self) private var playback

    var body: some View {
        let chapters = playback.chapters
        let current = playback.currentChapterIndex
        ScrollViewReader { proxy in
            LazyVStack(spacing: 0) {
                Text("\(chapters.count) chapters · \(Duration.seconds(playback.duration))")
                    .eyebrow()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.top, 20)
                    .padding(.bottom, 8)
                    .hairline()
                ForEach(chapters.indices, id: \.self) { index in
                    ChapterRow(chapters: chapters, index: index, isCurrent: index == current)
                        .id(index)
                }
            }
            .onAppear { proxy.scrollTo(current, anchor: .center) }
        }
    }
}

private struct ChapterRow: View {
    @Environment(PlaybackController.self) private var playback
    @Environment(Router.self) private var router
    let chapters: [Chapter]
    let index: Int
    let isCurrent: Bool

    var body: some View {
        let chapter = chapters[index]
        let end = chapters.end(of: index, duration: playback.duration)
        let length = max(1, end - chapter.start)
        let played = !isCurrent && end <= playback.currentTime
        let fill = isCurrent ? min(1, max(0, (playback.currentTime - chapter.start) / length)) : 0
        let meta = played ? "Played" : isCurrent ? "\(Duration.seconds(end - playback.currentTime)) left" : nil
        Button {
            playback.seek(to: chapter.start)
            if !playback.isPlaying { playback.resume() }
        } label: {
            HStack(spacing: 14) {
                Text(Duration.clock(chapter.start))
                    .font(.sans(.footnote).weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(isCurrent ? PodcstPalette.accent : PodcstPalette.tertiary)
                    .frame(minWidth: 52, alignment: .leading)
                VStack(alignment: .leading, spacing: 2) {
                    Text(chapter.title)
                        .font(.serif(.body))
                        .multilineTextAlignment(.leading)
                    Text([Duration.seconds(length), meta].compactMap { $0 }.joined(separator: " · "))
                        .font(.sans(.caption))
                        .foregroundStyle(PodcstPalette.tertiary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if isCurrent {
                    Equalizer(active: playback.isPlaying)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
            .background(alignment: .leading) {
                GeometryReader { geometry in
                    PodcstPalette.accent.opacity(0.12).frame(width: geometry.size.width * fill)
                }
            }
            .hairline()
            .opacity(played ? 0.5 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Jump to chapter")
        .contextMenu {
            if let episode = playback.currentEpisode, episode.publicLink != nil {
                Button("Share chapter", systemImage: "square.and.arrow.up") {
                    router.sharing = .episode(episode, mode: .chapter, chapter: index)
                }
            }
        }
    }
}

private struct NotesPanel: View {
    let episode: Episode

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(episode.dateline).eyebrow()
            ShowNotesContent(episode: episode)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.top, 22)
        .padding(.bottom, 20)
    }
}

private struct UpNextPanel: View {
    @Environment(PlaybackController.self) private var playback

    var body: some View {
        let upNext = playback.upNext
        if upNext.isEmpty {
            EmptyState(systemImage: "text.line.first.and.arrowtriangle.forward", title: "Nothing up next", message: "Add episodes to your queue and they will play after this one.")
        } else {
            LazyVStack(spacing: 0) {
                Text(upNext.count == 1 ? "1 episode" : "\(upNext.count) episodes")
                    .eyebrow()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 20)
                    .padding(.bottom, 8)
                    .hairline()
                ForEach(Array(upNext.enumerated()), id: \.element.identity) { offset, episode in
                    QueueRow(episode: episode)
                        .padding(.vertical, 6)
                        .hairline()
                        .contextMenu {
                            Button("Remove from queue", systemImage: "trash", role: .destructive) {
                                playback.removeUpNext(atOffsets: IndexSet(integer: offset))
                            }
                        }
                }
            }
            .padding(.horizontal, 20)
        }
    }
}

private struct StarButton: View {
    @Environment(StarStore.self) private var stars
    let episode: Episode

    var body: some View {
        let starred = stars.contains(episode)
        Button {
            stars.toggle(episode)
        } label: {
            Image(systemName: starred ? "star.fill" : "star")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(starred ? PodcstPalette.accent : PodcstPalette.ink)
                .frame(width: 40, height: 40)
                .background(starred ? PodcstPalette.accentSoft : PodcstPalette.ink.opacity(0.1), in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(!stars.ready || !StarStore.validID(episode.id))
        .sensoryFeedback(.selection, trigger: starred)
        .accessibilityLabel(starred ? "Unstar" : "Star")
    }
}

private struct EpisodeMenu: View {
    @Environment(PlaybackController.self) private var playback
    @Environment(Router.self) private var router
    let episode: Episode
    let showNotes: () -> Void

    var body: some View {
        Menu {
            DownloadMenuActions(episode: episode)
            Button("Show notes", systemImage: "doc.text", action: showNotes)
            Button("Episode page", systemImage: "info.circle") { router.open(.episode(episode)) }
            Button("Go to podcast", systemImage: "square.stack") { router.open(.podcast(episode.podcast)) }
            if episode.publicLink != nil {
                Button("Share", systemImage: "square.and.arrow.up") { router.sharing = .episode(episode, mode: .time) }
            }
            Section {
                Button { router.stop(playback) } label: {
                    Label("Stop playback", systemImage: "stop.fill")
                    Text("Saves your place and keeps the queue")
                }
                Button {
                    if playback.upNext.isEmpty { router.showingPlayer = false }
                    playback.markPlayed()
                } label: {
                    Label("Mark as played", systemImage: "checkmark.circle")
                    Text("Stops and plays the next in queue")
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.sans(.footnote).weight(.bold))
                .frame(width: 34, height: 34)
                .background(PodcstPalette.ink.opacity(0.1), in: Circle())
        }
        .accessibilityLabel("Episode actions")
    }
}

private struct SeekBar: View {
    @Environment(PlaybackController.self) private var playback
    var compact = false
    @State private var scrub: Double?

    private struct Segment {
        let start: TimeInterval
        let length: TimeInterval
    }

    var body: some View {
        let duration = playback.duration
        let clip = playback.clip
        let lower = clip?.start ?? 0
        let span = (clip?.end ?? duration) - lower
        let position = scrub.map { lower + $0 * span } ?? playback.currentTime
        let chapters = clip == nil ? playback.chapters : []
        let segments = chapters.isEmpty || span <= 0
            ? [Segment(start: lower, length: max(span, 1))]
            : chapters.indices.map { Segment(start: chapters[$0].start, length: max(0, chapters.end(of: $0, duration: duration) - chapters[$0].start)) }
        let current = chapters.index(at: position)
        VStack(spacing: 6) {
            GeometryReader { geometry in
                let gap: CGFloat = segments.count > 1 ? 3 : 0
                let available = geometry.size.width - gap * CGFloat(segments.count - 1)
                let total = max(segments.reduce(0) { $0 + $1.length }, 1)
                ZStack(alignment: .leading) {
                    HStack(spacing: gap) {
                        ForEach(segments.indices, id: \.self) { index in
                            let segment = segments[index]
                            let fill = min(1, max(0, (position - segment.start) / max(segment.length, 1)))
                            Capsule()
                                .fill(PodcstPalette.ink.opacity(0.18))
                                .overlay(alignment: .leading) {
                                    GeometryReader { bar in
                                        PodcstPalette.accent.frame(width: bar.size.width * fill)
                                    }
                                }
                                .clipShape(Capsule())
                                .frame(width: available * segment.length / total, height: !compact && index == current && segments.count > 1 ? 6 : 4)
                        }
                    }
                    if !compact {
                        Circle()
                            .fill(PodcstPalette.ink)
                            .frame(width: 14, height: 14)
                            .offset(x: geometry.size.width * (span > 0 ? (position - lower) / span : 0) - 7)
                            .scaleEffect(scrub == nil ? 1 : 1.3)
                    }
                }
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            scrub = min(1, max(0, value.location.x / geometry.size.width))
                        }
                        .onEnded { value in
                            playback.seek(to: lower + min(1, max(0, value.location.x / geometry.size.width)) * span)
                            scrub = nil
                        }
                )
            }
            .frame(height: compact ? 12 : 16)
            if !compact {
                HStack {
                    Text(Duration.clock(position))
                    Spacer()
                    Text(clip.map { "Clip ends \(Duration.clock($0.end))" } ?? "−\(Duration.clock(max(0, duration - position)))")
                }
                .font(.sans(.caption).weight(.medium))
                .monospacedDigit()
                .foregroundStyle(PodcstPalette.tertiary)
            }
        }
        .accessibilityElement()
        .accessibilityLabel("Playback position")
        .accessibilityValue(clip.map { "\(Duration.clock(position)), clip ends \(Duration.clock($0.end))" } ?? "\(Duration.clock(position)) of \(Duration.clock(duration))")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: playback.skipForward()
            case .decrement: playback.skipBackward()
            @unknown default: break
            }
        }
    }
}

private struct Transport: View {
    @Environment(PlaybackController.self) private var playback

    var body: some View {
        let chapters = !playback.chapters.isEmpty
        HStack {
            button("backward.end.fill", label: chapters ? "Previous chapter" : "Previous episode", size: 22, color: PodcstPalette.secondary) { playback.previousChapter() }
            Spacer()
            button("gobackward.10", label: "Back 10 seconds", size: 28) { playback.skipBackward() }
            Spacer()
            PlayPauseButton(diameter: 72)
            Spacer()
            button("goforward.30", label: "Forward 30 seconds", size: 28) { playback.skipForward() }
            Spacer()
            button("forward.end.fill", label: chapters ? "Next chapter" : "Next episode", size: 22, color: PodcstPalette.secondary) { playback.nextChapter() }
        }
    }

    private func button(_ systemName: String, label: String, size: CGFloat, color: Color = PodcstPalette.ink, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: size, weight: .medium))
                .foregroundStyle(color)
                .frame(width: 48, height: 48)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

private struct PlayPauseButton: View {
    @Environment(PlaybackController.self) private var playback
    let diameter: CGFloat

    var body: some View {
        Button { playback.toggle() } label: {
            ZStack {
                Circle().fill(PodcstPalette.ink)
                if playback.state == .loading {
                    ProgressView().tint(PodcstPalette.paper)
                } else {
                    Image(systemName: playback.isPlaybackRequested ? "pause.fill" : "play.fill")
                        .font(.system(size: diameter * 0.42, weight: .bold))
                        .foregroundStyle(PodcstPalette.paper)
                }
            }
            .frame(width: diameter, height: diameter)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(playback.isPlaybackRequested ? "Pause" : "Play")
    }
}

private struct AudioChips: View {
    @Environment(PlaybackController.self) private var playback

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                SpeedMenu()
                effect("Boost", \.volumeBoost)
                effect("Trim silence", \.trimSilence)
                Spacer(minLength: 0)
                AirPlayButton()
                    .frame(width: 44, height: 44)
            }
            if playback.requestedEffects.enabled, case .unavailable(let reason) = playback.audioEffectState {
                Text(reason)
                    .font(.sans(.caption))
                    .foregroundStyle(PodcstPalette.tertiary)
            }
        }
    }

    private func effect(_ title: String, _ effect: WritableKeyPath<AudioEffects, Bool>) -> some View {
        Toggle(title, isOn: Binding { playback.requestedEffects[keyPath: effect] } set: { on in
            var effects = playback.requestedEffects
            effects[keyPath: effect] = on
            playback.setEffects(effects)
        })
        .toggleStyle(ChipToggleStyle())
    }
}

private struct SpeedMenu: View {
    @Environment(PlaybackController.self) private var playback

    var body: some View {
        Menu {
            Picker("Playback speed", selection: Binding { playback.rate } set: { playback.setRate($0) }) {
                ForEach(PlaybackController.supportedRates, id: \.self) { speed in
                    Text("\(speed, specifier: "%g")×").tag(speed)
                }
            }
        } label: {
            Text(playback.isDoubleSpeedHeld ? "2×" : "\(playback.rate, specifier: "%g")×")
                .monospacedDigit()
                .chip(selected: playback.isDoubleSpeedHeld, strong: true)
        }
        .accessibilityLabel("Playback speed")
        .accessibilityValue("\(playback.rate, specifier: "%g") times")
    }
}

private struct ChipToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            configuration.label.chip(selected: configuration.isOn, strong: false)
        }
        .buttonStyle(.plain)
    }
}

private extension View {
    func chip(selected: Bool, strong: Bool) -> some View {
        font(.sans(.footnote).weight(selected || strong ? .semibold : .medium))
            .foregroundStyle(selected ? PodcstPalette.accent : strong ? PodcstPalette.ink : PodcstPalette.secondary)
            .padding(.horizontal, 12)
            .frame(minHeight: 32)
            .background(selected ? PodcstPalette.accentSoft : PodcstPalette.ink.opacity(0.07), in: Capsule())
            .frame(minHeight: 44)
            .contentShape(Rectangle())
    }
}

private struct PanelTabs: View {
    let panels: [PlayerPanel]
    let selection: PlayerPanel?
    let height: CGFloat
    let select: (PlayerPanel?) -> Void

    var body: some View {
        HStack(spacing: 4) {
            ForEach(panels) { panel in
                let selected = panel == selection
                Button { select(selected ? nil : panel) } label: {
                    Text(panel.rawValue)
                        .font(.sans(.subheadline).weight(selected ? .semibold : .medium))
                        .foregroundStyle(selected ? PodcstPalette.paper : selection == nil ? PodcstPalette.ink : PodcstPalette.secondary)
                        .frame(maxWidth: .infinity, minHeight: height)
                        .background(selected ? PodcstPalette.ink : .clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(4)
        .background(PodcstPalette.ink.opacity(0.07), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

private struct AirPlayButton: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let picker = AVRoutePickerView()
        picker.prioritizesVideoDevices = false
        picker.tintColor = UIColor(PodcstPalette.secondary)
        picker.activeTintColor = UIColor(PodcstPalette.accent)
        return picker
    }

    func updateUIView(_ picker: AVRoutePickerView, context: Context) {}
}
