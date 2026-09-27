import ImageIO
import SwiftUI
import UIKit

struct ArtworkHue: Hashable, Sendable {
    let hue: CGFloat
    let saturation: CGFloat
}

@MainActor
final class ArtworkStore {
    static let shared = ArtworkStore()

    private let images: NSCache<NSURL, UIImage> = {
        let cache = NSCache<NSURL, UIImage>()
        cache.countLimit = 160
        cache.totalCostLimit = 64 * 1024 * 1024
        return cache
    }()
    private var hues: [URL: ArtworkHue] = [:]
    private var requests: [URL: Task<UIImage?, Never>] = [:]

    func cached(_ url: URL?) -> UIImage? {
        url.flatMap { images.object(forKey: $0 as NSURL) }
    }

    func image(_ url: URL?) async -> UIImage? {
        guard let url else { return nil }
        if let cached = images.object(forKey: url as NSURL) { return cached }
        if let request = requests[url] { return await request.value }
        let request = Task.detached(priority: .utility) { await Self.fetch(url) }
        requests[url] = request
        let image = await request.value
        requests[url] = nil
        if let image {
            let pixels = image.size.width * image.scale * image.size.height * image.scale
            images.setObject(image, forKey: url as NSURL, cost: Int(pixels) * 4)
        }
        return image
    }

    func hue(_ url: URL?) async -> ArtworkHue? {
        guard let url else { return nil }
        if let hue = hues[url] { return hue }
        guard let image = await image(url) else { return nil }
        let hue = await Task.detached(priority: .utility) { Self.averageHue(image) }.value
        hues[url] = hue
        return hue
    }

    private nonisolated static func fetch(_ url: URL) async -> UIImage? {
        guard let (data, response) = try? await URLSession.shared.data(from: url),
              let http = response as? HTTPURLResponse,
              200..<300 ~= http.statusCode,
              let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        let options = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: 1024,
        ] as CFDictionary
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options).map { UIImage(cgImage: $0) }
    }

    private nonisolated static func averageHue(_ image: UIImage) -> ArtworkHue? {
        guard let cgImage = image.cgImage else { return nil }
        let side = 12
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        let drawn = pixels.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(data: buffer.baseAddress, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.interpolationQuality = .medium
            context.draw(cgImage, in: CGRect(x: 0, y: 0, width: side, height: side))
            return true
        }
        guard drawn else { return nil }
        let count = CGFloat(side * side * 255)
        let channel = { (offset: Int) in CGFloat(stride(from: offset, to: pixels.count, by: 4).reduce(0) { $0 + Int(pixels[$1]) }) / count }
        var hue: CGFloat = 0
        var saturation: CGFloat = 0
        var brightness: CGFloat = 0
        var alpha: CGFloat = 0
        UIColor(red: channel(0), green: channel(1), blue: channel(2), alpha: 1).getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: &alpha)
        return ArtworkHue(hue: hue, saturation: min(1, saturation * 1.8))
    }
}

struct ArtworkView: View {
    let url: URL?
    var size: CGFloat? = nil
    @State private var loaded: (url: URL, image: UIImage)?

    private var image: UIImage? {
        if let loaded, loaded.url == url { return loaded.image }
        return ArtworkStore.shared.cached(url)
    }

    private var radius: CGFloat {
        guard let size else { return 16 }
        return min(16, max(8, size * 0.09 + 4))
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    ZStack {
                        PodcstPalette.surface
                        Image(systemName: "waveform").foregroundStyle(PodcstPalette.faint)
                    }
                }
            }
            .frame(width: size, height: size)
            .clipShape(shape)
            .overlay { shape.strokeBorder(PodcstPalette.rule.opacity(0.8), lineWidth: 1) }
            .task(id: url) {
                guard let url, let image = await ArtworkStore.shared.image(url) else { return }
                loaded = (url, image)
            }
            .accessibilityHidden(true)
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
