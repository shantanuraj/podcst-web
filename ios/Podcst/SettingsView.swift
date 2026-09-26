import Foundation
import SwiftUI

struct SettingsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(LibraryStore.self) private var library
    @Environment(\.dismiss) private var dismiss
    @AppStorage("appearance") private var appearance = "system"

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if let user = session.user {
                        Label(user.email, systemImage: "person.crop.circle.fill")
                            .foregroundStyle(PodcstPalette.ink)
                        Button("Sign out", role: .destructive) {
                            Task { await session.signOut(); dismiss() }
                        }
                    } else {
                        Button {
                            showingLogin = true
                        } label: {
                            Label("Sign in to sync", systemImage: "person.crop.circle")
                        }
                    }
                } header: {
                    Text("Account")
                } footer: {
                    Text("Subscriptions and playback progress follow you across devices.")
                }

                Section("Appearance") {
                    Picker("Theme", selection: $appearance) {
                        Text("System").tag("system")
                        Text("Light").tag("light")
                        Text("Dark").tag("dark")
                    }
                }

                Section("Discovery") {
                    Picker("Region", selection: $region) {
                        ForEach(DiscoveryRegion.allCases) { option in
                            Text(option.name).tag(option.rawValue)
                        }
                    }
                }

                Section("Library") {
                    ShareLink(item: opml) {
                        Label("Export subscriptions", systemImage: "square.and.arrow.up")
                    }
                    .disabled(library.podcasts.isEmpty)
                }

                Section {
                    LabeledContent("Version", value: "1.0")
                    Link("Podcst on the web", destination: URL(string: "https://podcst.app")!)
                } header: {
                    Text("About")
                }
            }
            .scrollContentBackground(.hidden)
            .background(PodcstPalette.paper)
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .sheet(isPresented: $showingLogin) { LoginView() }
        }
        .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
    }

    @State private var showingLogin = false
    @AppStorage("region") private var region = "us"

    private var opml: String {
        let rows = library.podcasts.map {
            let title = $0.title.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "\"", with: "&quot;")
            let feed = $0.feed.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "\"", with: "&quot;")
            return "<outline text=\"\(title)\" xmlUrl=\"\(feed)\" type=\"rss\"/>"
        }.joined()
        return "<?xml version=\"1.0\" encoding=\"utf-8\"?><opml version=\"1.0\"><head><title>Podcst Subscriptions</title></head><body>\(rows)</body></opml>"
    }
}

enum DiscoveryRegion: String, CaseIterable, Identifiable {
    case us
    case nl
    case ca
    case kr
    case my
    case `in`
    case mx
    case fr
    case se
    case no

    var id: String { rawValue }

    var name: String {
        switch self {
        case .us: "United States"
        case .nl: "Netherlands"
        case .ca: "Canada"
        case .kr: "South Korea"
        case .my: "Malaysia"
        case .in: "India"
        case .mx: "Mexico"
        case .fr: "France"
        case .se: "Sweden"
        case .no: "Norway"
        }
    }
}

struct LoginView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var code = ""
    @State private var codeSent = false
    @State private var isWorking = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Sign in to keep subscriptions and listening progress in sync.")
                        .font(.subheadline)
                        .foregroundStyle(PodcstPalette.secondary)
                    TextField("Email address", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    if codeSent {
                        TextField("Verification code", text: $code)
                            .textContentType(.oneTimeCode)
                            .keyboardType(.numberPad)
                    }
                }
                if let error = session.error {
                    Section { Text(error).foregroundStyle(.red) }
                }
                Section {
                    Button(codeSent ? "Sign in" : "Email me a code") {
                        Task { await submit() }
                    }
                    .disabled(email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (codeSent && code.isEmpty) || isWorking)
                    if !codeSent {
                        Button {
                            Task {
                                isWorking = true
                                await session.signInWithPasskey(email: email.isEmpty ? nil : email)
                                isWorking = false
                                if session.user != nil { dismiss() }
                            }
                        } label: {
                            Label("Use a passkey", systemImage: "faceid")
                        }
                        .disabled(isWorking)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(PodcstPalette.paper)
            .navigationTitle("Sign in")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func submit() async {
        isWorking = true
        defer { isWorking = false }
        if codeSent {
            await session.signIn(email: email, code: code)
            if session.user != nil { dismiss() }
        } else {
            await session.sendCode(email: email)
            if session.error == nil { codeSent = true }
        }
    }
}

struct NowPlayingView: View {
    @Environment(PlaybackController.self) private var playback
    @Environment(\.dismiss) private var dismiss
    @State private var page = 0

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button { dismiss() } label: {
                    Image(systemName: "chevron.down")
                        .font(.body.weight(.semibold))
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Close player")
                Picker("Player view", selection: $page) {
                    Text("Now Playing").tag(0)
                    Text("Show Notes").tag(1)
                }
                .pickerStyle(.segmented)
                .accessibilityHint("Swipe horizontally to change player view")
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 10)
            TabView(selection: $page) {
                NowPlayingControls()
                    .tag(0)
                NowPlayingDetails()
                    .tag(1)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
        }
        .background(PodcstPalette.paper.ignoresSafeArea())
        .foregroundStyle(PodcstPalette.ink)
        .presentationBackground(PodcstPalette.paper)
    }
}

private struct NowPlayingControls: View {
    @Environment(PlaybackController.self) private var playback

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                ArtworkView(url: playback.currentEpisode?.artworkURL, size: 280)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
                VStack(spacing: 6) {
                    Text(playback.currentEpisode?.title ?? "")
                        .font(.system(.title2, design: .serif))
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                    Text(playback.currentEpisode?.podcastTitle ?? "Podcst")
                        .font(.subheadline)
                        .foregroundStyle(PodcstPalette.secondary)
                        .lineLimit(1)
                }
                VStack(spacing: 8) {
                    Slider(value: Binding(get: {
                        min(playback.currentTime, max(playback.duration, 1))
                    }, set: { playback.seek(to: $0) }), in: 0...max(playback.duration, 1))
                    HStack {
                        Text(Duration.clock(playback.currentTime))
                        Spacer()
                        Text(Duration.clock(playback.duration))
                    }
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(PodcstPalette.tertiary)
                }
                .tint(PodcstPalette.accent)
                HStack(spacing: 14) {
                    playerButton("backward.end.fill", label: "Previous episode") { playback.previous() }
                    playerButton("gobackward.10", label: "Back 10 seconds") { playback.skipBackward() }
                    Button { playback.toggle() } label: {
                        Image(systemName: playback.isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 27, weight: .bold))
                            .foregroundStyle(PodcstPalette.paper)
                            .frame(width: 76, height: 76)
                            .background(Circle().fill(PodcstPalette.ink))
                    }
                    .accessibilityLabel(playback.isPlaying ? "Pause" : "Play")
                    playerButton("goforward.30", label: "Forward 30 seconds") { playback.skipForward() }
                    playerButton("forward.end.fill", label: "Next episode") { playback.next() }
                }
                .foregroundStyle(PodcstPalette.ink)
                .frame(maxWidth: .infinity)
                Menu {
                    ForEach(PlaybackController.supportedRates, id: \.self) { rate in
                        Button("\(rate, specifier: "%g")×") { playback.setRate(rate) }
                    }
                } label: {
                    HStack {
                        Label("Playback speed", systemImage: "speedometer")
                        Spacer()
                        Text("\(playback.rate, specifier: "%g")×")
                            .fontWeight(.semibold)
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.caption.weight(.bold))
                    }
                    .foregroundStyle(PodcstPalette.secondary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .background(PodcstPalette.surface, in: RoundedRectangle(cornerRadius: 16))
                }
                .accessibilityLabel("Playback speed, \(playback.rate, specifier: "%g") times")
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 28)
        }
        .scrollIndicators(.hidden)
    }

    private func playerButton(_ systemName: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.title3.weight(.semibold))
                .frame(width: 48, height: 48)
        }
        .accessibilityLabel(label)
    }

}

private struct NowPlayingDetails: View {
    @Environment(PlaybackController.self) private var playback

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let episode = playback.currentEpisode {
                    HStack(alignment: .top, spacing: 14) {
                        ArtworkView(url: episode.artworkURL, size: 76)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(episode.title)
                                .font(.headline)
                                .lineLimit(3)
                            if let podcastTitle = episode.podcastTitle {
                                Text(podcastTitle)
                                    .font(.subheadline)
                                    .foregroundStyle(PodcstPalette.secondary)
                            }
                        }
                    }
                    ShowNotesContent(episode: episode)
                } else {
                    ContentUnavailableView("Nothing is playing", systemImage: "waveform", description: Text("Start an episode to see its show notes here."))
                }
            }
            .padding(24)
        }
        .scrollIndicators(.hidden)
    }
}

struct ShowNotesContent: View {
    @Environment(PlaybackController.self) private var playback
    let episode: Episode

    private var notes: String {
        episode.showNotes.isEmpty ? episode.summary ?? "" : episode.showNotes
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline) {
                Text("Show Notes")
                    .font(.system(.title2, design: .serif))
                Spacer()
                HStack(spacing: 10) {
                    if let published = episode.published {
                        Text(published, format: .dateTime.year().month(.abbreviated).day())
                    }
                    if let duration = episode.duration, duration > 0 {
                        Text(Duration.seconds(duration))
                    }
                }
                .font(.caption)
                .foregroundStyle(PodcstPalette.tertiary)
            }
            if notes.isEmpty {
                Text("No show notes were provided for this episode.")
                    .foregroundStyle(PodcstPalette.secondary)
            } else {
                Text(ShowNotesParser.attributedString(notes))
                    .font(.body)
                    .lineSpacing(5)
                    .tint(PodcstPalette.accent)
                    .textSelection(.enabled)
            }
            if let link = episode.link, let url = URL(string: link) {
                Link(destination: url) {
                    Label("Open episode website", systemImage: "safari")
                        .font(.subheadline.weight(.medium))
                }
                .foregroundStyle(PodcstPalette.accent)
            }
        }
        .environment(\.openURL, OpenURLAction { url in
            guard url.scheme == "podcst", url.host == "timestamp", let timestamp = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "value" })?.value, let seconds = ShowNotesParser.seconds(from: timestamp) else {
                return .systemAction
            }
            playback.seek(to: seconds)
            return .handled
        })
    }
}

enum ShowNotesParser {
    private static let timestampRegex = try! NSRegularExpression(pattern: #"(?<![A-Za-z0-9])(?:[0-9]{1,2}:)?[0-9]{1,2}:[0-5][0-9](?![A-Za-z0-9])"#)

    static func attributedString(_ html: String) -> AttributedString {
        guard let data = html.data(using: .utf8), let parsed = try? NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.html, .characterEncoding: String.Encoding.utf8.rawValue], documentAttributes: nil) else {
            return AttributedString(html.strippingHTML)
        }
        let mutable = NSMutableAttributedString(attributedString: parsed)
        let fullRange = NSRange(location: 0, length: mutable.length)
        mutable.removeAttribute(.foregroundColor, range: fullRange)
        mutable.removeAttribute(.backgroundColor, range: fullRange)
        let plain = mutable.string
        for match in timestampRegex.matches(in: plain, range: NSRange(plain.startIndex..., in: plain)) {
            let timestamp = (plain as NSString).substring(with: match.range)
            var components = URLComponents()
            components.scheme = "podcst"
            components.host = "timestamp"
            components.queryItems = [URLQueryItem(name: "value", value: timestamp)]
            if let url = components.url {
                mutable.addAttribute(.link, value: url, range: match.range)
            }
        }
        return AttributedString(mutable)
    }

    static func seconds(from timestamp: String) -> TimeInterval? {
        let parts = timestamp.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 || parts.count == 3, parts.last! < 60 else { return nil }
        if parts.count == 2 { return TimeInterval(parts[0] * 60 + parts[1]) }
        guard parts[1] < 60 else { return nil }
        return TimeInterval(parts[0] * 3600 + parts[1] * 60 + parts[2])
    }
}
