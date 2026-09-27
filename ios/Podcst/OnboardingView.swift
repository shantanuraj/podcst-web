import SwiftUI

struct OnboardingView: View {
    @Environment(APIClient.self) private var api
    @Environment(SessionStore.self) private var session
    @AppStorage(DiscoveryRegion.key) private var region = DiscoveryRegion.detected.rawValue
    @State private var covers: [Podcast] = []
    @State private var isWorking = false
    let finish: () -> Void

    private var regionName: String {
        DiscoveryRegion(rawValue: region)?.name ?? region.uppercased()
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            CoverMosaic(podcasts: covers)
            LinearGradient(
                stops: [
                    .init(color: PodcstPalette.paper.opacity(0), location: 0),
                    .init(color: PodcstPalette.paper.opacity(0.55), location: 0.32),
                    .init(color: PodcstPalette.paper, location: 0.52),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            VStack(alignment: .leading, spacing: 20) {
                Text("Podcst")
                    .font(.custom(Typeface.serifItalic.name, fixedSize: 72))
                    .tracking(-1.4)
                Text("A beautiful way to discover and listen to podcasts")
                    .font(.serif(.title3))
                    .foregroundStyle(PodcstPalette.secondary)
                    .frame(maxWidth: 280, alignment: .leading)
                VStack(alignment: .leading, spacing: 10) {
                    Text("Top charts from").eyebrow()
                    Menu {
                        Picker("Region", selection: $region) {
                            ForEach(DiscoveryRegion.allCases) { option in
                                Text(option.name).tag(option.rawValue)
                            }
                        }
                    } label: {
                        HStack(spacing: 8) {
                            Text(regionName)
                            Image(systemName: "chevron.down")
                                .font(.sans(.caption).weight(.bold))
                                .foregroundStyle(PodcstPalette.tertiary)
                        }
                        .font(.sans(.subheadline).weight(.medium))
                        .foregroundStyle(PodcstPalette.ink)
                        .padding(.leading, 14)
                        .padding(.trailing, 12)
                        .padding(.vertical, 8)
                        .overlay { Capsule().strokeBorder(PodcstPalette.rule) }
                    }
                    .accessibilityLabel("Chart region, \(regionName)")
                }
                .padding(.top, 6)
                VStack(spacing: 10) {
                    Button("Sign in with a passkey") {
                        Task {
                            isWorking = true
                            await session.signInWithPasskey()
                            isWorking = false
                            if session.user != nil { finish() }
                        }
                    }
                    .buttonStyle(PodcstButtonStyle(kind: .accent, height: 54))
                    .disabled(isWorking)
                    Button("Start listening", action: finish)
                        .buttonStyle(PodcstButtonStyle(kind: .outline, height: 54))
                }
                .padding(.top, 8)
                Text(session.error ?? "Subscriptions and playback progress follow you across devices.")
                    .font(.sans(.caption))
                    .foregroundStyle(session.error == nil ? PodcstPalette.tertiary : PodcstPalette.accent)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, 28)
            .padding(.bottom, 20)
        }
        .background(PodcstPalette.paper)
        .foregroundStyle(PodcstPalette.ink)
        .task(id: region) {
            covers = api.cachedTop(locale: region, limit: 30) ?? covers
            if let top = try? await api.top(locale: region, limit: 30) { covers = top }
        }
    }
}

private struct CoverMosaic: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let podcasts: [Podcast]

    private let columns = 4
    private let spacing: CGFloat = 12

    private var cycle: [URL?] {
        let urls = podcasts.prefix(12).map(\.artworkURL)
        let count = urls.count - urls.count % columns
        return count > 0 ? Array(urls.prefix(count)) : Array(repeating: nil, count: 12)
    }

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width + 120
            let tile = (width - spacing * CGFloat(columns - 1)) / CGFloat(columns)
            let cycle = cycle
            let cycleHeight = CGFloat(cycle.count / columns) * (tile + spacing)
            let repeats = Int((geometry.size.height / max(cycleHeight, 1)).rounded(.up)) + 1
            let rows = Array(repeating: cycle, count: repeats).flatMap { $0 }.chunked(columns)
            TimelineView(.animation(paused: reduceMotion)) { context in
                let shift = reduceMotion ? 0 : (context.date.timeIntervalSinceReferenceDate * 9).truncatingRemainder(dividingBy: max(cycleHeight, 1))
                VStack(spacing: spacing) {
                    ForEach(rows.indices, id: \.self) { row in
                        HStack(spacing: spacing) {
                            ForEach(rows[row].indices, id: \.self) { column in
                                ArtworkView(url: rows[row][column])
                                    .frame(width: tile)
                            }
                        }
                    }
                }
                .frame(width: width, alignment: .top)
                .offset(x: -60, y: -40 - shift)
            }
            .rotationEffect(.degrees(-8))
        }
        .opacity(0.9)
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private extension Array {
    func chunked(_ size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map { Array(self[$0..<Swift.min($0 + size, count)]) }
    }
}
