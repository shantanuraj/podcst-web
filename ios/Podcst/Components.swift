import SwiftUI
import UIKit

private struct ArtworkPolicyKey: EnvironmentKey {
    static let defaultValue = ArtworkPolicy.disk
}

extension EnvironmentValues {
    var artworkPolicy: ArtworkPolicy {
        get { self[ArtworkPolicyKey.self] }
        set { self[ArtworkPolicyKey.self] = newValue }
    }
}

struct ArtworkView: View {
    @Environment(\.displayScale) private var displayScale
    @Environment(\.artworkPolicy) private var policy
    let url: URL?
    var fallbackURL: URL? = nil
    var size: CGFloat? = nil

    private var radius: CGFloat {
        guard let size else { return 16 }
        return min(16, max(8, size * 0.09 + 4))
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                GeometryReader { geometry in
                    ArtworkImage(url: url, fallbackURL: fallbackURL,
                                 pixels: ArtworkStore.pixelSize(for: max(geometry.size.width, geometry.size.height), scale: displayScale),
                                 policy: policy)
                }
            }
            .frame(width: size, height: size)
            .clipShape(shape)
            .overlay { shape.strokeBorder(PodcstPalette.rule.opacity(0.8), lineWidth: 1) }
            .accessibilityHidden(true)
    }
}

private struct ArtworkImage: View {
    struct Identity: Hashable {
        let url: URL?
        let fallback: URL?
        let pixels: Int
        let accountID: String?
    }

    let url: URL?
    let fallbackURL: URL?
    let pixels: Int
    let policy: ArtworkPolicy
    @Environment(SessionStore.self) private var session: SessionStore?
    @State private var loaded: (Identity, UIImage)?

    private var identity: Identity {
        Identity(url: url, fallback: fallbackURL, pixels: pixels, accountID: session?.user?.id)
    }

    private var image: UIImage? {
        ArtworkStore.shared.cached(url, pixelSize: pixels)
            ?? ArtworkStore.shared.cached(fallbackURL, pixelSize: pixels)
            ?? (loaded?.0 == identity ? loaded?.1 : nil)
    }

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                PodcstPalette.surface
                Image(systemName: "waveform").foregroundStyle(PodcstPalette.faint)
            }
        }
        .task(id: identity) {
            let requested = identity
            var image = await ArtworkStore.shared.image(url, pixelSize: pixels, policy: policy)
            if image == nil, fallbackURL != url {
                image = await ArtworkStore.shared.image(fallbackURL, pixelSize: pixels, policy: policy)
            }
            guard !Task.isCancelled, let image else { return }
            loaded = (requested, image)
        }
    }
}

struct Equalizer: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let active: Bool

    var body: some View {
        TimelineView(.animation(paused: !active || reduceMotion)) { context in
            let time = context.date.timeIntervalSinceReferenceDate
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(0..<3, id: \.self) { bar in
                    RoundedRectangle(cornerRadius: 1)
                        .fill(PodcstPalette.accent)
                        .frame(width: 3, height: 14 * level(bar, time))
                }
            }
            .frame(height: 14, alignment: .bottom)
        }
        .accessibilityHidden(true)
    }

    private func level(_ bar: Int, _ time: TimeInterval) -> Double {
        guard active, !reduceMotion else { return [0.45, 0.85, 0.3][bar] }
        return 0.25 + 0.75 * abs(sin(time * .pi / 0.8 + Double(bar) * 1.1))
    }
}

struct ProgressLine: View {
    let fraction: Double
    var loading = false

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                PodcstPalette.rule
                if loading {
                    PhaseAnimator([1.0, 0.4]) { opacity in
                        PodcstPalette.tertiary
                            .frame(width: geometry.size.width * fraction)
                            .opacity(opacity)
                    } animation: { _ in .easeInOut(duration: 0.75) }
                } else {
                    PodcstPalette.accent.frame(width: geometry.size.width * fraction)
                }
            }
        }
        .frame(height: 2)
        .accessibilityHidden(true)
    }
}

struct DateBlock: View {
    let date: Date?

    var body: some View {
        VStack(spacing: 2) {
            Text(date?.formatted(.dateTime.month(.abbreviated)) ?? "")
                .eyebrow()
            Text(date?.formatted(.dateTime.day(.twoDigits)) ?? "")
                .font(.serif(.title2))
                .foregroundStyle(PodcstPalette.secondary)
        }
        .frame(width: 40)
        .accessibilityHidden(true)
    }
}

struct RoundIcon: View {
    let systemName: String
    var diameter: CGFloat = 34
    var tint: Color = PodcstPalette.ink

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: diameter * 0.38, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: diameter, height: diameter)
            .overlay { Circle().strokeBorder(PodcstPalette.rule) }
            .contentShape(Circle())
    }
}

struct PodcstButtonStyle: ButtonStyle {
    enum Kind {
        case accent
        case ink
        case surface
        case outline
    }

    var kind: Kind
    var height: CGFloat = 48

    func makeBody(configuration: Configuration) -> some View {
        Chrome(configuration: configuration, kind: kind, height: height)
    }

    private struct Chrome: View {
        @Environment(\.isEnabled) private var isEnabled
        let configuration: Configuration
        let kind: Kind
        let height: CGFloat

        var body: some View {
            let shape = RoundedRectangle(cornerRadius: height >= 48 ? 14 : 12, style: .continuous)
            configuration.label
                .font(.sans(.subheadline).weight(.semibold))
                .lineLimit(1)
                .padding(.horizontal, 14)
                .frame(maxWidth: .infinity, minHeight: height)
                .foregroundStyle(foreground)
                .background(background, in: shape)
                .overlay {
                    if kind == .surface || kind == .outline { shape.strokeBorder(PodcstPalette.rule) }
                }
                .contentShape(shape)
                .opacity(isEnabled ? (configuration.isPressed ? 0.7 : 1) : 0.45)
        }

        private var foreground: Color {
            switch kind {
            case .accent: .white
            case .ink: PodcstPalette.paper
            case .surface, .outline: PodcstPalette.ink
            }
        }

        private var background: Color {
            switch kind {
            case .accent: PodcstPalette.accent
            case .ink: PodcstPalette.ink
            case .surface: PodcstPalette.surface
            case .outline: .clear
            }
        }
    }
}

struct FieldChrome: ViewModifier {
    var highlighted = false

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        content
            .padding(.horizontal, 16)
            .frame(minHeight: 52)
            .background(PodcstPalette.surface, in: shape)
            .overlay { shape.strokeBorder(highlighted ? PodcstPalette.accent : PodcstPalette.rule) }
    }
}

extension View {
    func screenHeader<Trailing: View>(_ title: String, @ViewBuilder trailing: () -> Trailing) -> some View {
        modifier(ScreenHeader(title: title, trailing: trailing()))
    }
}

private struct ScreenHeader<Trailing: View>: ViewModifier {
    let title: String
    let trailing: Trailing

    func body(content: Content) -> some View {
        content
            .navigationTitle(title)
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) {
                HStack {
                    Text(title)
                        .font(.serif(.largeTitle))
                        .tracking(-0.8)
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                    trailing
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 4)
                .background(PodcstPalette.paper)
            }
    }
}

struct SectionHeader<Trailing: View>: View {
    let title: String
    let trailing: Trailing

    init(_ title: String, @ViewBuilder trailing: () -> Trailing = { EmptyView() }) {
        self.title = title
        self.trailing = trailing()
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.serif(.title2))
                .accessibilityAddTraits(.isHeader)
            Spacer()
            trailing
        }
        .padding(.bottom, 8)
        .hairline()
    }
}

struct ErrorRow: View {
    let message: String
    let retry: () async -> Void

    var body: some View {
        HStack {
            Text(message).font(.sans(.subheadline)).foregroundStyle(PodcstPalette.secondary)
            Spacer()
            Button("Retry") { Task { await retry() } }
                .foregroundStyle(PodcstPalette.accent)
        }
        .padding(14)
        .background(PodcstPalette.accentSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct EmptyState: View {
    let systemImage: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 42, weight: .light))
                .foregroundStyle(PodcstPalette.tertiary)
            Text(title)
                .font(.serif(.title2))
            Text(message)
                .font(.sans(.subheadline))
                .foregroundStyle(PodcstPalette.secondary)
                .frame(maxWidth: 300)
        }
        .multilineTextAlignment(.center)
        .padding(28)
    }
}

enum Duration {
    static func seconds(_ value: Double) -> String {
        let minutes = max(1, Int((value / 60).rounded()))
        if minutes < 60 { return "\(minutes) min" }
        if minutes % 60 == 0 { return "\(minutes / 60) hr" }
        return "\(minutes / 60) hr \(minutes % 60) min"
    }

    static func clock(_ value: Double) -> String {
        let total = max(0, Int(value.rounded(.down)))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60
        if hours > 0 { return String(format: "%d:%02d:%02d", hours, minutes, seconds) }
        return String(format: "%02d:%02d", minutes, seconds)
    }
}

extension Episode {
    var byline: String {
        [podcastTitle, author].compactMap { $0 }.filter { !$0.isEmpty }.reduce(into: [String]()) { names, name in
            if !names.contains(name) { names.append(name) }
        }.joined(separator: " · ")
    }

    var dateline: String {
        [published?.formatted(.dateTime.year().month(.abbreviated).day()), duration.flatMap { $0 > 0 ? Duration.seconds($0) : nil }]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    var podcast: Podcast {
        Podcast(id: podcastId, feed: feed, title: podcastTitle ?? "", author: author ?? "", cover: cover, thumbnail: cover)
    }
}
