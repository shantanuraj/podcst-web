import CryptoKit
import Foundation
import Observation

struct AudioEffects: Codable, Equatable, Sendable {
    var volumeBoost = false
    var trimSilence = false

    var enabled: Bool { volumeBoost || trimSilence }
}

struct AudioOptions: Codable, Equatable, Sendable {
    var speed: Double = 1
    var effects = AudioEffects()
}

enum AudioEffectState: Equatable, Sendable {
    case inactive
    case preparing
    case active(AudioEffects)
    case unavailable(String)
}

@MainActor
@Observable
final class AudioPreferences {
    private(set) var defaults: AudioOptions
    private(set) var overrides: [String: AudioOptions]
    @ObservationIgnored var onChange: (() -> Void)?
    @ObservationIgnored private let storageURL: URL?

    private struct Snapshot: Codable {
        var defaults: AudioOptions
        var overrides: [String: AudioOptions]
    }

    init(storageURL: URL? = nil) {
        self.storageURL = storageURL
        if let storageURL, let data = try? Data(contentsOf: storageURL),
           let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data) {
            defaults = Self.validated(snapshot.defaults)
            overrides = snapshot.overrides.mapValues(Self.validated)
        } else {
            defaults = AudioOptions()
            overrides = [:]
        }
    }

    static func persistent() -> AudioPreferences {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Podcst", isDirectory: true)
        return AudioPreferences(storageURL: directory.appendingPathComponent("audio-preferences.json"))
    }

    func options(for feed: String?) -> AudioOptions {
        feed.flatMap { overrides[Self.key($0)] } ?? defaults
    }

    func hasOverride(for feed: String) -> Bool {
        overrides[Self.key(feed)] != nil
    }

    func set(_ options: AudioOptions, for feed: String? = nil) {
        let options = Self.validated(options)
        if let feed { overrides[Self.key(feed)] = options }
        else { defaults = options }
        persist()
        onChange?()
    }

    func useDefaults(for feed: String) {
        overrides.removeValue(forKey: Self.key(feed))
        persist()
        onChange?()
    }

    private static func validated(_ options: AudioOptions) -> AudioOptions {
        var result = options
        if !PlaybackController.supportedRates.contains(options.speed) { result.speed = 1 }
        return result
    }

    private static func key(_ feed: String) -> String {
        SHA256.hash(data: Data(feed.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private func persist() {
        guard let storageURL,
              let data = try? JSONEncoder().encode(Snapshot(defaults: defaults, overrides: overrides)) else { return }
        try? FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: storageURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
