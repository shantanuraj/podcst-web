import SwiftUI

enum PodcstPalette {
    static let paper = Color(red: 0.11, green: 0.106, blue: 0.102)
    static let surface = Color(red: 0.149, green: 0.141, blue: 0.133)
    static let ink = Color(red: 0.949, green: 0.941, blue: 0.929)
    static let secondary = Color(red: 0.69, green: 0.678, blue: 0.655)
    static let tertiary = Color(red: 0.55, green: 0.533, blue: 0.51)
    static let rule = Color(red: 0.2, green: 0.192, blue: 0.18)
    static let accent = Color(red: 0.878, green: 0.42, blue: 0.322)
    static let accentSoft = Color(red: 0.18, green: 0.114, blue: 0.102)
}

struct PodcstThemeKey: EnvironmentKey {
    static let defaultValue = PodcstTheme()
}

struct PodcstTheme {
    let paper = PodcstPalette.paper
    let surface = PodcstPalette.surface
    let ink = PodcstPalette.ink
    let secondary = PodcstPalette.secondary
    let tertiary = PodcstPalette.tertiary
    let rule = PodcstPalette.rule
    let accent = PodcstPalette.accent
}

extension EnvironmentValues {
    var podcstTheme: PodcstTheme {
        get { self[PodcstThemeKey.self] }
        set { self[PodcstThemeKey.self] = newValue }
    }
}

extension View {
    func podcstPage() -> some View {
        scrollContentBackground(.hidden)
            .background(PodcstPalette.paper)
            .foregroundStyle(PodcstPalette.ink)
    }
}
