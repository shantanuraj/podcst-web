import SwiftUI
import UIKit

extension Router {
    func star(_ episode: Episode, _ starred: Bool, in stars: StarStore) {
        let saved = starred ? stars.star(episode) : stars.unstar(episode)
        guard saved else { toast = Toast(title: stars.error ?? "Unable to save this change"); return }
        let undo = Toast.Action(title: "Undo", emphasized: false) { [weak self] in self?.star(episode, !starred, in: stars) }
        toast = starred
            ? Toast(title: "Starred", systemImage: "star.fill", actions: [Toast.Action(title: "Add to list…") { [weak self] in self?.listing = episode }, undo])
            : Toast(title: "Removed from Starred", systemImage: "star", actions: [undo])
    }
}

struct ListTile: View {
    let systemImage: String
    var size: CGFloat = 32

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: size * 0.44, weight: .semibold))
            .foregroundStyle(PodcstPalette.accent)
            .frame(width: size, height: size)
            .background(PodcstPalette.accentSoft, in: RoundedRectangle(cornerRadius: size / 4, style: .continuous))
            .accessibilityHidden(true)
    }
}

struct AddToListSheet: View {
    @Environment(StarStore.self) private var stars
    @Environment(\.dismiss) private var dismiss
    let episode: Episode

    var body: some View {
        let starred = stars.contains(episode)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                ArtworkView(url: episode.artworkURL, fallbackURL: URL(string: episode.cover), size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Add to list")
                        .font(.serif(.title3))
                        .accessibilityAddTraits(.isHeader)
                    Text([episode.title, episode.podcastTitle].compactMap { $0 }.joined(separator: " · "))
                        .font(.sans(.caption))
                        .foregroundStyle(PodcstPalette.tertiary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Button("Done") { dismiss() }
                    .font(.sans(.body).weight(.semibold))
                    .foregroundStyle(PodcstPalette.accent)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .padding(.leading, 20)
            .padding(.trailing, 12)
            .padding(.bottom, 14)
            .hairline()
            Button {
                if starred { stars.unstar(episode) } else { stars.star(episode) }
            } label: {
                HStack(spacing: 12) {
                    ListTile(systemImage: EpisodeList.starred.systemImage, size: 36)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(EpisodeList.starred.title)
                            .font(.sans(.body).weight(.medium))
                        Text(stars.stars.count == 1 ? "1 episode" : "\(stars.stars.count) episodes")
                            .font(.sans(.caption))
                            .foregroundStyle(PodcstPalette.tertiary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: starred ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 24))
                        .foregroundStyle(starred ? PodcstPalette.accent : PodcstPalette.faint)
                }
                .padding(.horizontal, 16)
                .frame(height: 60)
                .background(PodcstPalette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!stars.ready || !StarStore.validID(episode.id))
            .accessibilityAddTraits(starred ? .isSelected : [])
            .padding(.horizontal, 16)
            .padding(.top, 14)
            Text("Removing an episode from a list doesn’t delete its download or progress.")
                .font(.sans(.caption))
                .foregroundStyle(PodcstPalette.tertiary)
                .padding(.horizontal, 20)
                .padding(.top, 14)
            Spacer(minLength: 0)
        }
        .padding(.top, 24)
        .foregroundStyle(PodcstPalette.ink)
        .background(PodcstPalette.paper)
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }
}

struct EpisodeSwipe: ViewModifier {
    struct Action {
        let title: String
        let systemImage: String
        let perform: () -> Void
    }

    let leading: Action
    var trailing: Action?
    @State private var offset: CGFloat = 0
    private static let threshold: CGFloat = 72

    private var armed: Bool { abs(offset) > Self.threshold }

    func body(content: Content) -> some View {
        content
            .background(PodcstPalette.paper)
            .offset(x: offset)
            .background {
                if offset != 0, let action = offset > 0 ? leading : trailing {
                    let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
                    VStack(spacing: 4) {
                        Image(systemName: action.systemImage)
                            .font(.system(size: 18, weight: .semibold))
                        Text(action.title)
                            .font(.sans(.caption2).weight(.medium))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 18)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: offset > 0 ? .leading : .trailing)
                    .background(PodcstPalette.accent.opacity(armed ? 1 : 0.75), in: shape)
                    .accessibilityHidden(true)
                }
            }
            .gesture(HorizontalPan { translation in
                offset = translation > 0 || trailing != nil ? translation : 0
            } ended: { translation in
                if translation > Self.threshold { leading.perform() }
                if translation < -Self.threshold { trailing?.perform() }
                withAnimation(.snappy) { offset = 0 }
            })
            .sensoryFeedback(.impact, trigger: armed) { _, armed in armed }
    }
}

private struct HorizontalPan: UIGestureRecognizerRepresentable {
    let changed: (CGFloat) -> Void
    let ended: (CGFloat) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let recognizer = UIPanGestureRecognizer()
        recognizer.delegate = context.coordinator
        return recognizer
    }

    func handleUIGestureRecognizerAction(_ recognizer: UIPanGestureRecognizer, context: Context) {
        let translation = recognizer.translation(in: recognizer.view).x
        switch recognizer.state {
        case .changed: changed(translation)
        case .ended: ended(translation)
        case .cancelled, .failed: ended(0)
        default: break
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard let pan = recognizer as? UIPanGestureRecognizer else { return false }
            let velocity = pan.velocity(in: pan.view)
            return abs(velocity.x) > abs(velocity.y) * 1.5 && pan.location(in: nil).x > 28
        }
    }
}
