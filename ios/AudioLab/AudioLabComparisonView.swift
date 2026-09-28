import SwiftUI

struct AudioLabComparisonView: View {
    @Environment(\.dismiss) private var dismiss
    let sourceURL: URL
    let position: TimeInterval
    let duration: TimeInterval
    let rate: Double
    var initialLength: TimeInterval = 20
    var onBegin: () -> Void = {}
    var onReport: (AudioComparisonReport) -> Void = { _ in }
    @State private var session = AudioComparisonSession()
    @State private var start: TimeInterval = 0
    @State private var length: TimeInterval = 20

    private var passage: AudioComparisonPassage? {
        AudioComparisonPassage.around(start, duration: duration, length: length)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if let passage {
                        HStack(alignment: .firstTextBaseline) {
                            Text(time(passage.start))
                            Image(systemName: "arrow.right")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(time(passage.end))
                            Spacer()
                            Text("\(passage.duration, specifier: "%.0f") sec")
                                .foregroundStyle(.secondary)
                        }
                        .font(.title3.monospacedDigit())
                        .accessibilityElement(children: .combine)
                        if duration > passage.duration {
                            Slider(value: $start, in: 0...(duration - passage.duration))
                                .accessibilityLabel("Passage start")
                                .accessibilityValue(time(passage.start))
                                .disabled(session.isRendering)
                        }
                        Picker("Passage length", selection: $length) {
                            ForEach([10.0, 20, 30], id: \.self) { seconds in
                                Text("\(Int(seconds)) sec").tag(seconds)
                            }
                        }
                        .disabled(session.isRendering)
                        LabeledContent("Speed", value: "\(rate.formatted())×")
                        LabeledContent("Warm-up", value: "\(passage.warmUpDuration.formatted(.number.precision(.fractionLength(1)))) sec")
                        if let preset = session.renderingPreset {
                            HStack {
                                ProgressView()
                                Text("Rendering \(preset.title.lowercased())…")
                                Spacer()
                                Button("Cancel") { session.reset() }
                                    .buttonStyle(.borderless)
                            }
                        } else {
                            Button(session.report == nil ? "Prepare comparison" : "Render this passage again", systemImage: "waveform") {
                                onBegin()
                                session.prepare(sourceURL: sourceURL, passage: passage, rate: rate, onReport: onReport)
                            }
                        }
                    } else {
                        Text("This file is too short to measure reliably.")
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Original source passage")
                } footer: {
                    Text("All four versions use the production engine, limiter and speed processing, rendered at 48 kHz stereo. Each starts with the same source pre-roll to warm up adaptive effects. The pre-roll is excluded from listening and measurements.")
                }

                if let report = session.report {
                    Section {
                        Picker("Effects", selection: Binding(get: { session.selectedPreset }, set: { session.select($0) })) {
                            ForEach(AudioComparisonPreset.allCases) { preset in
                                Text(preset.title).tag(preset)
                            }
                        }
                        .pickerStyle(.segmented)
                        .accessibilityLabel("Comparison effects")
                        Picker("Listening level", selection: Binding(get: { session.level }, set: { session.setLevel($0) })) {
                            ForEach(AudioComparisonLevel.allCases) { level in
                                Text(level.title).tag(level)
                            }
                        }
                        .disabled(report.matchedTargetLUFS == nil)
                        Toggle("Cycle through all four versions", isOn: Binding(get: { session.cyclesPresets }, set: { session.setCyclesPresets($0) }))
                        Button {
                            session.toggle()
                        } label: {
                            Label(session.isPlaybackRequested ? "Pause comparison" : "Loop \(session.selectedPreset.title.lowercased())", systemImage: session.isPlaybackRequested ? "pause.fill" : "play.fill")
                                .font(.headline)
                                .frame(maxWidth: .infinity, alignment: .center)
                                .padding(.vertical, 6)
                        }
                        .buttonStyle(.borderless)
                        if let target = report.matchedTargetLUFS, session.level == .matched {
                            LabeledContent("Matched loudness", value: "\(target.formatted(.number.precision(.fractionLength(1)))) LUFS")
                        }
                        if report.matchedTargetLUFS == nil {
                            Text("This passage has too little measurable audio for loudness matching. Try a passage with speech.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    } header: {
                        Text("Listen · \(time(report.passage.start))–\(time(report.passage.end))")
                    } footer: {
                        Text(session.level == .fixed
                             ? "Fixed level preserves the engine’s output so you can assess audibility. Switching versions restarts the passage. Your device volume stays unchanged."
                             : "Louder versions are attenuated to the quietest version’s gated integrated loudness. Listen for clipped words, pumping and amplified noise; device volume stays unchanged.")
                    }

                    Section {
                        ForEach(report.measurements, id: \.preset) { measurement in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text(measurement.preset.title)
                                        .font(.headline)
                                    Spacer()
                                    Text("\(measurement.duration, specifier: "%.2f") sec")
                                        .monospacedDigit()
                                }
                                HStack {
                                    Text(level(measurement.metrics.integratedLUFS, unit: "LUFS"))
                                    Spacer()
                                    Text(level(measurement.metrics.maximumEstimatedTruePeakDBTP, unit: "dBTP"))
                                }
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 4)
                        }
                    } header: {
                        Text("Rendered output")
                    } footer: {
                        Text("LUFS uses K-weighting and absolute/relative gating. True peak is an oversampled estimate. Measurements describe the original render before listening attenuation; audition files have \(report.auditionEdgeFadeSeconds * 1_000, specifier: "%.0f") ms fades at passage edges to avoid loop clicks. Interior audio is unchanged.")
                    }
                }

                if let failure = session.failure {
                    Section {
                        Text(failure).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Compare a passage")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .tint(PodcstPalette.accent)
            .onAppear {
                length = initialLength
                start = AudioComparisonPassage.around(position, duration: duration, length: initialLength)?.start ?? 0
            }
            .onChange(of: length) {
                start = passage?.start ?? 0
            }
            .onDisappear { session.reset() }
        }
    }

    private func time(_ seconds: TimeInterval) -> String {
        let seconds = Int(max(0, seconds))
        return seconds >= 3_600
            ? String(format: "%d:%02d:%02d", seconds / 3_600, seconds / 60 % 60, seconds % 60)
            : String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    private func level(_ value: Double?, unit: String) -> String {
        value.map { "\($0.formatted(.number.precision(.fractionLength(1)))) \(unit)" } ?? "— \(unit)"
    }
}
