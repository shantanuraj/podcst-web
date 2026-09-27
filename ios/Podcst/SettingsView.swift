import Foundation
import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(LibraryStore.self) private var library
    @Environment(PlaybackController.self) private var playback
    @Environment(\.dismiss) private var dismiss
    @AppStorage(Appearance.key) private var appearance = Appearance.system
    @AppStorage(DiscoveryRegion.key) private var region = DiscoveryRegion.detected.rawValue
    @State private var showingLogin = false
    @State private var importing = false

    private var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    }

    var body: some View {
        NavigationStack {
            List {
                Group {
                Section {
                    AccountCard(user: session.user) { showingLogin = true }
                        .listRowInsets(EdgeInsets(top: 14, leading: 14, bottom: 14, trailing: 14))
                }
                if let user = session.user {
                    Section {
                        if user.hasPasskey {
                            LabeledContent("Passkey", value: "On")
                        } else {
                            Button("Add a passkey") {
                                Task { await session.registerPasskey() }
                            }
                        }
                        Button("Sign out") {
                            Task { await session.signOut(); dismiss() }
                        }
                    } header: {
                        Text("Account").eyebrow()
                    }
                }
                Section {
                    Picker("Appearance", selection: $appearance) {
                        ForEach(Appearance.allCases) { option in
                            Text(option.name).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                    .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                } header: {
                    Text("Appearance").eyebrow()
                }
                Section {
                    Picker("Chart region", selection: $region) {
                        ForEach(DiscoveryRegion.allCases) { option in
                            Text(option.name).tag(option.rawValue)
                        }
                    }
                    Picker("Default speed", selection: Binding { playback.rate } set: { playback.setRate($0) }) {
                        ForEach(PlaybackController.supportedRates, id: \.self) { rate in
                            Text("\(rate, specifier: "%g")×").tag(rate)
                        }
                    }
                } header: {
                    Text("Listening").eyebrow()
                }
                Section {
                    Button("Import OPML") { importing = true }
                    ShareLink(item: OPML.document(library.podcasts), preview: SharePreview("Podcst Subscriptions")) {
                        Text("Export subscriptions")
                    }
                    .disabled(library.podcasts.isEmpty)
                } header: {
                    Text("Library").eyebrow()
                } footer: {
                    HStack(spacing: 4) {
                        Text("Podcst \(version) ·")
                        Link("podcst.app", destination: URL(string: "https://podcst.app")!)
                            .foregroundStyle(PodcstPalette.accent)
                    }
                    .font(.sans(.caption))
                    .foregroundStyle(PodcstPalette.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 22)
                }
                }
                .listRowBackground(PodcstPalette.surface)
            }
            .foregroundStyle(PodcstPalette.ink)
            .scrollContentBackground(.hidden)
            .background(PodcstPalette.paper)
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
            .sheet(isPresented: $showingLogin) { LoginView() }
            .fileImporter(isPresented: $importing, allowedContentTypes: [UTType(filenameExtension: "opml") ?? .xml, .xml, .plainText]) { result in
                guard case .success(let url) = result else { return }
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                guard let text = try? String(contentsOf: url, encoding: .utf8) else { return }
                Task { await library.importFeeds(OPML.feeds(in: text)) }
            }
        }
        .tint(PodcstPalette.accent)
    }
}

private struct AccountCard: View {
    let user: User?
    let signIn: () -> Void

    var body: some View {
        if let user {
            HStack(spacing: 14) {
                Text(String((user.name ?? user.email).prefix(1)).lowercased())
                    .font(.serif(.title2, italic: true))
                    .foregroundStyle(PodcstPalette.accent)
                    .frame(width: 48, height: 48)
                    .background(PodcstPalette.accentSoft, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(user.email)
                        .font(.sans(.subheadline).weight(.medium))
                    Text(user.hasPasskey ? "Signed in with a passkey" : "Subscriptions and progress sync across devices")
                        .font(.sans(.caption))
                        .foregroundStyle(PodcstPalette.tertiary)
                }
            }
        } else {
            Button(action: signIn) {
                HStack(spacing: 14) {
                    Image(systemName: "person.crop.circle")
                        .font(.sans(.title2))
                        .foregroundStyle(PodcstPalette.accent)
                        .frame(width: 48, height: 48)
                        .background(PodcstPalette.accentSoft, in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Sign in")
                            .font(.sans(.subheadline).weight(.medium))
                        Text("Subscriptions and playback progress follow you across devices.")
                            .font(.sans(.caption))
                            .foregroundStyle(PodcstPalette.tertiary)
                    }
                }
            }
            .buttonStyle(.plain)
        }
    }
}

enum OPML {
    static func document(_ podcasts: [Podcast]) -> String {
        let rows = podcasts.map { "<outline type=\"rss\" text=\"\(escape($0.title))\" xmlUrl=\"\(escape($0.feed))\"/>" }.joined()
        return "<?xml version=\"1.0\" encoding=\"utf-8\"?><opml version=\"1.0\"><head><title>Podcst Subscriptions</title></head><body>\(rows)</body></opml>"
    }

    static func feeds(in document: String) -> [String] {
        let regex = try! NSRegularExpression(pattern: #"xmlUrl\s*=\s*["']([^"']+)["']"#, options: .caseInsensitive)
        return regex.matches(in: document, range: NSRange(document.startIndex..., in: document)).compactMap { match in
            Range(match.range(at: 1), in: document).map { unescape(String(document[$0])) }
        }
    }

    private static let entities = [("&", "&amp;"), ("\"", "&quot;"), ("'", "&apos;"), ("<", "&lt;"), (">", "&gt;")]

    private static func escape(_ value: String) -> String {
        entities.reduce(value) { $0.replacingOccurrences(of: $1.0, with: $1.1) }
    }

    private static func unescape(_ value: String) -> String {
        entities.reversed().reduce(value) { $0.replacingOccurrences(of: $1.1, with: $1.0) }
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

    static let key = "region"

    static var detected: DiscoveryRegion {
        Locale.current.region.flatMap { DiscoveryRegion(rawValue: $0.identifier.lowercased()) } ?? .us
    }

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
    private enum Field {
        case email
        case code
    }

    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var code = ""
    @State private var codeSent = false
    @State private var isWorking = false
    @FocusState private var focus: Field?

    private var trimmedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Sign in")
                        .font(.serif(.largeTitle))
                        .tracking(-0.6)
                    Text("Sign in to keep subscriptions and listening progress in sync.")
                        .font(.sans(.subheadline))
                        .foregroundStyle(PodcstPalette.secondary)
                        .padding(.top, 10)
                    Button {
                        Task {
                            isWorking = true
                            await session.signInWithPasskey(email: trimmedEmail.isEmpty ? nil : trimmedEmail)
                            isWorking = false
                            if session.user != nil { dismiss() }
                        }
                    } label: {
                        Label("Use a passkey", systemImage: "person.badge.key")
                    }
                    .buttonStyle(PodcstButtonStyle(kind: .ink, height: 56))
                    .disabled(isWorking)
                    .padding(.top, 32)
                    Text("Face ID or Touch ID. No password to remember.")
                        .font(.sans(.caption))
                        .foregroundStyle(PodcstPalette.tertiary)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 10)
                    HStack(spacing: 12) {
                        PodcstPalette.rule.frame(height: 1)
                        Text("or use email").eyebrow(PodcstPalette.muted).fixedSize()
                        PodcstPalette.rule.frame(height: 1)
                    }
                    .padding(.top, 32)
                    .padding(.bottom, 20)
                    TextField("you@example.com", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .email)
                        .modifier(FieldChrome(highlighted: focus == .email))
                    if codeSent {
                        HStack {
                            TextField("Code", text: $code)
                                .textContentType(.oneTimeCode)
                                .keyboardType(.numberPad)
                                .font(.title3.monospaced())
                                .tracking(4)
                                .focused($focus, equals: .code)
                            Text("Code sent")
                                .font(.sans(.caption))
                                .foregroundStyle(PodcstPalette.tertiary)
                        }
                        .modifier(FieldChrome(highlighted: focus == .code))
                        .padding(.top, 10)
                    }
                    if let error = session.error {
                        Text(error)
                            .font(.sans(.footnote))
                            .foregroundStyle(PodcstPalette.accent)
                            .padding(.top, 12)
                    }
                    Button(codeSent ? "Sign in" : "Email me a code") {
                        Task { await submit() }
                    }
                    .buttonStyle(PodcstButtonStyle(kind: .outline, height: 52))
                    .disabled(trimmedEmail.isEmpty || (codeSent && code.isEmpty) || isWorking)
                    .padding(.top, 14)
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .podcstPage()
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(PodcstPalette.accent)
                }
            }
        }
    }

    private func submit() async {
        isWorking = true
        defer { isWorking = false }
        if codeSent {
            await session.signIn(email: trimmedEmail, code: code)
            if session.user != nil { dismiss() }
        } else {
            await session.sendCode(email: trimmedEmail)
            if session.error == nil {
                codeSent = true
                focus = .code
            }
        }
    }
}
