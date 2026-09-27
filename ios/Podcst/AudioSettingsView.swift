import SwiftUI

struct AudioSettingsView: View {
    @Environment(PlaybackController.self) private var playback
    @Environment(\.dismiss) private var dismiss
    private let defaultsOnly: Bool
    private let podcast: AudioSettingsPodcast?
    @State private var allPodcasts = false

    init(defaultsOnly: Bool = false) {
        self.defaultsOnly = defaultsOnly
        podcast = nil
    }

    fileprivate init(podcast: AudioSettingsPodcast?) {
        defaultsOnly = false
        self.podcast = podcast
    }

    private var preferences: AudioPreferences { playback.audioPreferences }
    private var usesDefaults: Bool { defaultsOnly || allPodcasts || podcast == nil }
    private var feed: String? { usesDefaults ? nil : podcast?.feed }
    private var options: Binding<AudioOptions> {
        let selectedFeed = feed
        return Binding { preferences.options(for: selectedFeed) } set: { preferences.set($0, for: selectedFeed) }
    }

    var body: some View {
        NavigationStack {
            List {
                if !defaultsOnly, let podcast {
                    Section {
                        Picker("Apply to", selection: $allPodcasts) {
                            Text("This podcast").tag(false)
                            Text("All podcasts").tag(true)
                        }
                        .pickerStyle(.segmented)
                        if !allPodcasts {
                            Text(podcast.title)
                                .font(.serif(.title2))
                                .fixedSize(horizontal: false, vertical: true)
                            if preferences.hasOverride(for: podcast.feed) {
                                Button("Use defaults") { preferences.useDefaults(for: podcast.feed) }
                            }
                        }
                    } footer: {
                        Text(scopeDescription)
                    }
                }

                Section {
                    Picker("Playback speed", selection: options.speed) {
                        ForEach(PlaybackController.supportedRates, id: \.self) { speed in
                            Text("\(speed, specifier: "%g")×").tag(speed)
                        }
                    }
                    Toggle(isOn: options.effects.volumeBoost) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Volume Boost")
                            Text("Make quiet voices easier to hear")
                                .font(.sans(.footnote))
                                .foregroundStyle(PodcstPalette.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                    Toggle(isOn: options.effects.trimSilence) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Trim Silence")
                            Text("Shorten pauses")
                                .font(.sans(.footnote))
                                .foregroundStyle(PodcstPalette.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                } header: {
                    Text(usesDefaults ? "Listening defaults" : "Listening")
                } footer: {
                    if usesDefaults {
                        Text(defaultsDescription)
                    } else if let statusDescription {
                        Text(statusDescription)
                    }
                }
            }
            .font(.sans(.body))
            .listRowSpacing(0)
            .scrollContentBackground(.hidden)
            .background(PodcstPalette.paper)
            .foregroundStyle(PodcstPalette.ink)
            .navigationTitle("Audio")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .tint(PodcstPalette.accent)
        .presentationDragIndicator(.visible)
    }

    private var scopeDescription: String {
        guard let feed else { return "Changes apply to podcasts that use defaults." }
        return preferences.hasOverride(for: feed)
            ? "These settings apply only to this podcast."
            : "Using defaults. Making a change gives this podcast its own settings."
    }

    private var defaultsDescription: String {
        if let current = playback.currentEpisode, preferences.hasOverride(for: current.feed) {
            return "\(current.podcastTitle ?? "The current podcast") uses its own settings. Changing defaults won’t change the current episode’s audio."
        }
        return "Podcasts use these settings unless you choose their own settings in the player."
    }

    private var statusDescription: String? {
        guard let feed else { return nil }
        guard playback.currentEpisode?.feed == feed else {
            return "These settings apply the next time you play this podcast."
        }
        guard playback.requestedEffects.enabled else { return nil }
        switch playback.audioEffectState {
        case .inactive, .preparing:
            return "Your audio settings will apply when playback is ready."
        case .active(let effects):
            if effects != playback.requestedEffects { return "Applying your audio settings…" }
            switch (effects.volumeBoost, effects.trimSilence) {
            case (true, true): return "Volume Boost and Trim Silence are active."
            case (true, false): return "Volume Boost is active."
            case (false, true): return "Trim Silence is active."
            case (false, false): return nil
            }
        case .unavailable(let reason):
            return reason
        }
    }
}

struct AudioControlsButton: View {
    @Environment(PlaybackController.self) private var playback
    @State private var presentation: AudioSettingsPresentation?

    var body: some View {
        Button {
            presentation = AudioSettingsPresentation(podcast: playback.currentEpisode.map(AudioSettingsPodcast.init))
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "slider.horizontal.3")
                Text(playback.isDoubleSpeedHeld ? "2×" : "\(playback.rate, specifier: "%g")×")
                    .monospacedDigit()
            }
            .font(.sans(.footnote).weight(.semibold))
            .foregroundStyle(playback.requestedEffects.enabled || playback.isDoubleSpeedHeld ? PodcstPalette.accent : PodcstPalette.ink)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(PodcstPalette.ink.opacity(0.07), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Audio settings")
        .accessibilityValue("\(playback.rate, specifier: "%g") times speed")
        .sheet(item: $presentation) { presentation in
            AudioSettingsView(podcast: presentation.podcast)
        }
    }
}

fileprivate struct AudioSettingsPodcast {
    let feed: String
    let title: String

    init(episode: Episode) {
        feed = episode.feed
        title = episode.podcastTitle ?? "This podcast"
    }
}

private struct AudioSettingsPresentation: Identifiable {
    let id = UUID()
    let podcast: AudioSettingsPodcast?
}
