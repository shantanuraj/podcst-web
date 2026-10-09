import Foundation
import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(LibraryStore.self) private var library
    @Environment(AccountStore.self) private var account
    @Environment(\.dismiss) private var dismiss
    @AppStorage(Appearance.key) private var appearance = Appearance.system
    @AppStorage(DiscoveryRegion.key) private var region = DiscoveryRegion.detected.rawValue
    @State private var showingLogin = false
    @State private var importing = false
    @State private var importError: String?
    @State private var showingAudio = false
    @State private var removing: Passkey?
    @State private var removalError: String?

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
                        if let passkeys = account.account?.passkeys, !passkeys.isEmpty {
                            ForEach(passkeys) { passkey in
                                PasskeyRow(passkey: passkey) { removing = passkey }
                            }
                        } else if user.hasPasskey {
                            LabeledContent("Passkey", value: "On")
                        } else {
                            Button("Add a passkey") {
                                Task { await session.registerPasskey() }
                            }
                        }
                        Button("Sign out") {
                            Task {
                                await session.signOut()
                                dismiss()
                            }
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
                    Button("Audio defaults") { showingAudio = true }
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
            .sheet(isPresented: $showingLogin) { LoginView() }
            .sheet(isPresented: $showingAudio) { AudioSettingsView() }
            .confirmationDialog("Remove passkey?", isPresented: Binding { removing != nil } set: { if !$0 { removing = nil } }, titleVisibility: .visible, presenting: removing) { passkey in
                Button("Remove", role: .destructive) {
                    Task {
                        do { try await account.removePasskey(passkey) }
                        catch { removalError = error.localizedDescription }
                    }
                }
            } message: { _ in
                Text("You can still sign in with an emailed code.")
            }
            .alert("Couldn’t remove passkey", isPresented: Binding { removalError != nil } set: { if !$0 { removalError = nil } }) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(removalError ?? "")
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [UTType(filenameExtension: "opml") ?? .xml, .xml, .plainText]) { result in
                guard case .success(let url) = result else { return }
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                do {
                    let feeds = try OPML.read(url)
                    Task { await library.importFeeds(feeds) }
                } catch { importError = OPML.invalidMessage }
            }
            .alert("Couldn’t import OPML", isPresented: Binding { importError != nil } set: { if !$0 { importError = nil } }) {
                Button("OK", role: .cancel) {}
            } message: { Text(importError ?? "") }
        }
        .tint(PodcstPalette.accent)
        .presentationDragIndicator(.visible)
    }
}

private struct PasskeyRow: View {
    let passkey: Passkey
    let remove: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(passkey.provider ?? "Passkey")
                    .font(.sans(.body))
                Text(detail)
                    .font(.sans(.caption))
                    .foregroundStyle(PodcstPalette.tertiary)
            }
            Spacer()
            Button("Remove", action: remove)
                .font(.sans(.subheadline))
                .foregroundStyle(PodcstPalette.tertiary)
                .buttonStyle(.borderless)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAction(named: "Remove") { remove() }
    }

    private var detail: String {
        let added = "Added \(passkey.created.formatted(.dateTime.month(.abbreviated).year()))"
        guard let used = passkey.lastUsed else { return added }
        let last = Calendar.current.isDateInToday(used) ? "Used today" : "Used \(used.formatted(.dateTime.day().month(.abbreviated)))"
        return "\(added) · \(last)"
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

    static let invalidMessage = "Invalid or oversized OPML. Existing imports retained."

    static func read(_ url: URL) throws -> [String] {
        let limit = FeedLimits.current.opml.bytes
        if let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > limit { throw FeedContractError.invalidResponse }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var data = Data()
        while let part = try handle.read(upToCount: min(8192, limit + 1 - data.count)), !part.isEmpty {
            data.append(part)
            guard data.count <= limit else { throw FeedContractError.invalidResponse }
        }
        guard let text = String(data: data, encoding: .utf8) else { throw FeedContractError.invalidResponse }
        return try feeds(in: text)
    }

    static func feeds(in document: String) throws -> [String] {
        guard document.utf8.count <= FeedLimits.current.opml.bytes else { throw FeedContractError.invalidResponse }
        let declarations = try NSRegularExpression(pattern: #"<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE"#, options: .caseInsensitive)
        for match in declarations.matches(in: document, range: NSRange(document.startIndex..., in: document)) {
            guard let range = Range(match.range, in: document), !document[range].uppercased().hasPrefix("<!DOCTYPE") else { throw FeedContractError.invalidResponse }
        }
        let delegate = OutlineParser()
        let parser = XMLParser(data: Data(document.utf8))
        parser.shouldResolveExternalEntities = false
        parser.delegate = delegate
        guard parser.parse(), !delegate.invalid else { throw FeedContractError.invalidResponse }
        return delegate.feeds
    }

    private final class OutlineParser: NSObject, XMLParserDelegate {
        var feeds: [String] = []
        var invalid = false
        private var seen = Set<String>()
        private var depth = 0
        private var outlines = 0

        func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes: [String: String]) {
            depth += 1
            let limits = FeedLimits.current.opml
            guard depth <= limits.depth else { invalid = true; parser.abortParsing(); return }
            guard elementName == "outline" else { return }
            outlines += 1
            guard outlines <= limits.outlines else { invalid = true; parser.abortParsing(); return }
            guard let url = attributes.first(where: { $0.key.lowercased() == "xmlurl" })?.value.trimmingCharacters(in: .whitespacesAndNewlines), !url.isEmpty else { return }
            guard url.utf16.count <= 4096 else { invalid = true; parser.abortParsing(); return }
            if seen.insert(url).inserted { feeds.append(url) }
            if feeds.count > limits.feeds { invalid = true; parser.abortParsing() }
        }
        func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) { depth -= 1 }
        func parser(_ parser: XMLParser, parseErrorOccurred parseError: Error) { invalid = true }
        func parser(_ parser: XMLParser, foundInternalEntityDeclarationWithName name: String, value: String?) { invalid = true; parser.abortParsing() }
        func parser(_ parser: XMLParser, foundExternalEntityDeclarationWithName name: String, publicID: String?, systemID: String?) { invalid = true; parser.abortParsing() }
    }

    private static let entities = [("&", "&amp;"), ("\"", "&quot;"), ("'", "&apos;"), ("<", "&lt;"), (">", "&gt;")]

    private static func escape(_ value: String) -> String {
        entities.reduce(value) { $0.replacingOccurrences(of: $1.0, with: $1.1) }
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
