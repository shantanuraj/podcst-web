import SwiftUI
import UIKit

enum PodcstPalette {
    static let paper = Color(light: 0xFAF9F7, dark: 0x1C1B1A)
    static let surface = Color(light: 0xFFFFFF, dark: 0x262423)
    static let ink = Color(light: 0x1A1A1A, dark: 0xF2F0ED)
    static let secondary = Color(light: 0x6B6B6B, dark: 0xB0ADA9)
    static let tertiary = Color(light: 0x9A9A9A, dark: 0x8C8882)
    static let muted = Color(light: 0x888888, dark: 0x6B6864)
    static let faint = Color(light: 0xAAAAAA, dark: 0x4D4A46)
    static let rule = Color(light: 0xE8E6E3, dark: 0x33312F)
    static let accent = Color(light: 0xC84B31, dark: 0xE06B52)
    static let accentSoft = Color(light: 0xFDF6F4, dark: 0x2E1D1A)
    static let cream = Color(light: 0xF5F3F0, dark: 0x2A2826)
    static let floating = Color(light: 0xFFFFFF, dark: 0x2C2A28)
    static let floatingRule = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(white: 1, alpha: 0.07) : UIColor(hex: 0xE8E6E3)
    })
    static let floatingShadow = Color(UIColor { traits in
        UIColor(white: 0, alpha: traits.userInterfaceStyle == .dark ? 0.35 : 0.08)
    })

    static func tint(_ hue: ArtworkHue) -> Color {
        Color(UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(hue: hue.hue, saturation: 0.45 * hue.saturation, brightness: 0.34, alpha: 1)
                : UIColor(hue: hue.hue, saturation: 0.14 * hue.saturation, brightness: 0.93, alpha: 1)
        })
    }
}

enum Appearance: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    static let key = "appearance"

    var id: String { rawValue }
    var name: String { rawValue.capitalized }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

extension Color {
    init(light: UInt32, dark: UInt32) {
        self.init(UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

enum Typeface {
    case serif
    case serifItalic
    case sans

    var name: String {
        switch self {
        case .serif: "InstrumentSerif-Regular"
        case .serifItalic: "InstrumentSerif-Italic"
        case .sans: "Inter"
        }
    }

    func size(_ style: Font.TextStyle) -> CGFloat {
        switch (self, style) {
        case (.sans, .largeTitle): 34
        case (.sans, .title): 28
        case (.sans, .title2): 22
        case (.sans, .title3): 20
        case (.sans, .headline), (.sans, .body): 16
        case (.sans, .callout): 15
        case (.sans, .subheadline): 14
        case (_, .largeTitle): 40
        case (_, .title): 32
        case (_, .title2): 24
        case (_, .title3): 20
        case (_, .headline), (_, .body): 18
        case (_, .callout): 16
        case (_, .subheadline): 15
        case (_, .footnote): 13
        case (_, .caption): 12
        case (_, .caption2): 11
        default: 16
        }
    }

    static func uiStyle(_ style: Font.TextStyle) -> UIFont.TextStyle {
        switch style {
        case .largeTitle: .largeTitle
        case .title: .title1
        case .title2: .title2
        case .title3: .title3
        case .headline: .headline
        case .callout: .callout
        case .subheadline: .subheadline
        case .footnote: .footnote
        case .caption: .caption1
        case .caption2: .caption2
        default: .body
        }
    }
}

extension UIFont {
    static func podcst(_ typeface: Typeface, _ style: Font.TextStyle) -> UIFont {
        let uiStyle = Typeface.uiStyle(style)
        let font = UIFont(name: typeface.name, size: typeface.size(style)) ?? .preferredFont(forTextStyle: uiStyle)
        return UIFontMetrics(forTextStyle: uiStyle).scaledFont(for: font)
    }
}

extension Font {
    static func serif(_ style: Font.TextStyle, italic: Bool = false) -> Font {
        let typeface: Typeface = italic ? .serifItalic : .serif
        return .custom(typeface.name, size: typeface.size(style), relativeTo: style)
    }

    static func sans(_ style: Font.TextStyle) -> Font {
        .custom(Typeface.sans.name, size: Typeface.sans.size(style), relativeTo: style)
    }

    static let eyebrow = Font.sans(.caption2).weight(.medium)
}

extension View {
    func podcstPage() -> some View {
        scrollContentBackground(.hidden)
            .background(PodcstPalette.paper)
            .foregroundStyle(PodcstPalette.ink)
    }

    func eyebrow(_ color: Color = PodcstPalette.tertiary) -> some View {
        font(.eyebrow)
            .tracking(0.6)
            .textCase(.uppercase)
            .foregroundStyle(color)
    }

    func hairline(_ visible: Bool = true) -> some View {
        overlay(alignment: .bottom) {
            if visible {
                PodcstPalette.rule.frame(height: 1)
            }
        }
    }

    func callout<S: InsettableShape>(in shape: S) -> some View {
        modifier(Callout(shape: shape))
    }
}

private struct Callout<S: InsettableShape>: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    let shape: S

    func body(content: Content) -> some View {
        content
            .foregroundStyle(PodcstPalette.ink)
            .background(PodcstPalette.paper, in: shape)
            .shadow(color: .black.opacity(0.3), radius: 14, y: 10)
            .environment(\.colorScheme, colorScheme == .dark ? .light : .dark)
    }
}

@MainActor
enum PodcstAppearance {
    static func configure() {
        let bar = UINavigationBar.appearance()
        bar.largeTitleTextAttributes = [.font: UIFont.podcst(.serif, .largeTitle), .kern: -0.6]
        bar.titleTextAttributes = [.font: UIFont.podcst(.serif, .headline)]
        UIBarButtonItem.appearance().setTitleTextAttributes([.font: UIFont.podcst(.sans, .body)], for: .normal)
    }
}
