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

    private var opml: String {
        let rows = library.podcasts.map {
            let title = $0.title.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "\"", with: "&quot;")
            let feed = $0.feed.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "\"", with: "&quot;")
            return "<outline text=\"\(title)\" xmlUrl=\"\(feed)\" type=\"rss\"/>"
        }.joined()
        return "<?xml version=\"1.0\" encoding=\"utf-8\"?><opml version=\"1.0\"><head><title>Podcst Subscriptions</title></head><body>\(rows)</body></opml>"
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

    var body: some View {
        VStack(spacing: 22) {
            Capsule()
                .fill(PodcstPalette.tertiary)
                .frame(width: 38, height: 4)
                .padding(.top, 8)
            ArtworkView(url: playback.currentEpisode?.artworkURL, size: 250)
            VStack(spacing: 6) {
                Text(playback.currentEpisode?.title ?? "")
                    .font(.system(.title2, design: .serif))
                    .multilineTextAlignment(.center)
                Text(playback.currentEpisode?.podcastTitle ?? "Podcst")
                    .foregroundStyle(PodcstPalette.secondary)
            }
            Slider(value: Binding(get: { playback.currentTime }, set: { playback.seek(to: $0) }), in: 0...max(playback.duration, 1))
                .tint(PodcstPalette.accent)
            HStack {
                Text(Duration.seconds(playback.currentTime))
                Spacer()
                Text(Duration.seconds(playback.duration))
            }
            .font(.caption)
            .foregroundStyle(PodcstPalette.tertiary)
            HStack(spacing: 30) {
                Button { playback.previous() } label: { Image(systemName: "backward.end.fill") }
                Button { playback.skip(by: -10) } label: { Image(systemName: "gobackward.10") }
                Button { playback.toggle() } label: {
                    Image(systemName: playback.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 52))
                }
                Button { playback.skip(by: 30) } label: { Image(systemName: "goforward.30") }
                Button { playback.next() } label: { Image(systemName: "forward.end.fill") }
            }
            .font(.title2)
            .foregroundStyle(PodcstPalette.ink)
            HStack {
                Text("Speed")
                Spacer()
                Menu {
                    ForEach([0.5, 0.75, 1.0, 1.25, 1.5, 2.0], id: \.self) { rate in
                        Button("\(rate, specifier: "%g")×") { playback.setRate(rate) }
                    }
                } label: {
                    Text("\(playback.rate, specifier: "%g")×")
                }
            }
            .font(.subheadline)
            .foregroundStyle(PodcstPalette.secondary)
            .padding(.horizontal, 18)
        }
        .padding(.horizontal, 28)
        .padding(.bottom, 28)
        .background(PodcstPalette.paper)
    }
}
