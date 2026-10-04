import SwiftUI

struct AudioSettingsView: View {
    @Environment(PlaybackController.self) private var playback

    private var preferences: AudioPreferences { playback.audioPreferences }
    private var options: Binding<AudioOptions> {
        Binding { preferences.defaults } set: { preferences.set($0) }
    }

    var body: some View {
        NavigationStack {
            List {
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
                    Text("Listening defaults")
                } footer: {
                    if let statusDescription {
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
        }
        .tint(PodcstPalette.accent)
        .presentationDragIndicator(.visible)
    }

    private var statusDescription: String? {
        guard playback.currentEpisode != nil, playback.requestedEffects.enabled,
              case .unavailable(let reason) = playback.audioEffectState else { return nil }
        return reason
    }
}
