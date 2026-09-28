import SwiftUI

struct AudioLabInspectorView: View {
    @Bindable var inspection: AudioLabInspectionSession
    var unsupportedBackend = false
    let compareCut: (AudioInspectionCut) -> Void

    var body: some View {
        Section {
            Toggle("Measure audio", isOn: $inspection.isEnabled)
            if let reading = inspection.reading {
                HStack {
                    Label(inspection.isFrozen ? "Frozen" : inspection.isEnabled ? "Live" : "Measurement off", systemImage: inspection.isFrozen ? "pause.circle" : "waveform")
                        .font(.subheadline)
                    Spacer()
                    Button(inspection.isFrozen ? "Go live" : "Freeze") {
                        if inspection.isFrozen { inspection.resume() }
                        else { inspection.freeze() }
                    }
                    .buttonStyle(.borderless)
                }
                Picker("Window", selection: $inspection.windowDuration) {
                    Text("5 sec").tag(5.0)
                    Text("15 sec").tag(15.0)
                    Text("30 sec").tag(30.0)
                    Text("60 sec").tag(60.0)
                }
                .pickerStyle(.segmented)
                VStack(spacing: 16) {
                    AudioLabWaveform(title: "Original", envelopes: reading.signal.original, cuts: reading.signal.cuts, start: inspection.start, end: inspection.end, processed: false)
                    AudioLabWaveform(title: "Processed", envelopes: reading.signal.processed, cuts: reading.signal.cuts, start: inspection.start, end: inspection.end, processed: true)
                    HStack {
                        Text(AudioLabFormat.time(inspection.start))
                        Spacer()
                        Text("Original episode time")
                        Spacer()
                        Text(AudioLabFormat.time(inspection.end))
                    }
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                }
                .padding(.vertical, 8)
                if inspection.isFrozen {
                    let lower = max(0, reading.signal.presentedSourceTime - 60)
                    Slider(value: $inspection.frozenEnd, in: lower...max(lower + 0.01, reading.signal.presentedSourceTime))
                        .accessibilityLabel("Inspect earlier audio")
                        .accessibilityValue(AudioLabFormat.time(inspection.frozenEnd))
                }
                LabeledContent("Applied gain", value: AudioLabFormat.decibels((reading.signal.gainReadings.last(where: { $0.sourceTime <= inspection.end })?.decibels).map(Double.init)))
                metric("Original RMS", rms(reading.signal.original), unit: "dBFS")
                metric("Processed RMS", rms(reading.signal.processed), unit: "dBFS")
                LabeledContent("Source audio removed", value: String(format: "%.2f sec", reading.signal.removedSourceSeconds))
                if !reading.signal.cuts.isEmpty {
                    DisclosureGroup("Inspect silence cuts (\(reading.signal.cuts.count))") {
                        ForEach(Array(reading.signal.cuts.enumerated()), id: \.offset) { _, cut in
                            Button {
                                compareCut(cut)
                            } label: {
                                HStack {
                                    Label(AudioLabFormat.time(cut.sourceStart), systemImage: "scissors")
                                    Spacer()
                                    Text("\(cut.duration, specifier: "%.2f") sec")
                                        .foregroundStyle(.secondary)
                                    Image(systemName: "play.circle")
                                }
                            }
                            .accessibilityLabel("Compare cut at \(AudioLabFormat.time(cut.sourceStart)), \(cut.duration, specifier: "%.2f") seconds removed")
                        }
                    }
                }
            } else {
                ContentUnavailableView(unsupportedBackend ? "Inspection unavailable" : inspection.isEnabled ? "Play to inspect" : "Measurement off", systemImage: "waveform", description: Text(unsupportedBackend ? "This source is playing through AVPlayer. Signal inspection requires a source supported by the custom engine." : inspection.isEnabled ? "The custom engine will show the audio as it reaches playback." : "Audio capture and analysis are disabled for performance comparisons."))
            }
        } header: {
            Text("Signal inspector")
        } footer: {
            Text("Both waveforms use the same full-scale amplitude. Shaded intervals are removed source audio. Processed audio is measured before speed processing and final limiting. Removed time resets after seeking or rebuilding the engine.")
        }

        if let reading = inspection.reading {
            Section {
                if let output = reading.output {
                    metric("Sample peak", output.samplePeakDBFS, unit: "dBFS")
                    metric("RMS level", output.rmsDBFS, unit: "dBFS")
                    metric("Limiter reduction", reading.limiterReductionDB.map(Double.init), unit: "dB")
                    metric("Momentary loudness", output.momentaryLUFS, unit: "LUFS")
                    metric("Short-term loudness", output.shortTermLUFS, unit: "LUFS")
                    DisclosureGroup("Measurement details") {
                        metric("Integrated loudness", output.integratedLUFS, unit: "LUFS")
                        metric("Maximum sample peak", output.maximumSamplePeakDBFS, unit: "dBFS")
                        metric("Maximum estimated true peak", output.maximumEstimatedTruePeakDBTP, unit: "dBTP")
                        LabeledContent("Samples at full scale", value: "\(output.clippedSampleCount)")
                        LabeledContent("Nonfinite samples", value: "\(output.nonFiniteSampleCount)")
                        LabeledContent("Measurement discontinuities", value: "\(output.discontinuityCount)")
                        LabeledContent("Dropped measurement frames", value: "\(reading.signal.outputTelemetryDroppedFrames)")
                    }
                } else {
                    Text("Waiting for final output")
                        .foregroundStyle(.secondary)
                }
            } header: {
                VStack(alignment: .leading) {
                    Text("Final digital output")
                    if inspection.isFrozen {
                        Text("Captured at \(AudioLabFormat.time(reading.signal.presentedSourceTime))")
                    }
                }
            } footer: {
                Text("Measured after speed processing, conversion and limiting. Momentary loudness needs 400 ms; short-term loudness needs 3 seconds. Silence has no finite level. These measurements do not include the speaker or headphones.")
            }

            Section("Events") {
                DisclosureGroup("Engine timeline") {
                    ForEach(Array(reading.signal.events.suffix(30).reversed().enumerated()), id: \.offset) { _, event in
                        HStack(alignment: .firstTextBaseline) {
                            Text(eventTitle(event))
                            Spacer()
                            Text(AudioLabFormat.time(event.sourceTime))
                                .monospacedDigit()
                                .foregroundStyle(.secondary)
                        }
                        .font(.caption)
                    }
                }
                DisclosureGroup("Playback and route") {
                    ForEach(reading.events.suffix(30).reversed()) { event in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(event.name)
                                Spacer()
                                Text(AudioLabFormat.time(event.sourceTime)).monospacedDigit()
                            }
                            if !event.detail.isEmpty { Text(event.detail).foregroundStyle(.secondary) }
                        }
                        .font(.caption)
                    }
                }
            }
        }
    }

    private func metric(_ title: String, _ value: Double?, unit: String) -> some View {
        LabeledContent(title, value: value.map { String(format: "%.1f %@", $0, unit) } ?? "—")
            .monospacedDigit()
    }

    private func rms(_ envelopes: [AudioInspectionEnvelope]) -> Double? {
        let values = envelopes.filter { $0.sourceEnd <= inspection.end && $0.sourceEnd > inspection.end - 0.4 }
        let duration = values.reduce(0) { $0 + $1.sourceEnd - $1.sourceStart }
        guard duration > 0 else { return nil }
        let power = values.reduce(0.0) { $0 + Double($1.rms * $1.rms) * ($1.sourceEnd - $1.sourceStart) } / duration
        return power > 0 && power.isFinite ? 10 * log10(power) : nil
    }

    private func eventTitle(_ event: AudioInspectionEvent) -> String {
        let name: String = switch event.kind {
        case .requested: "Effects requested"
        case .applied: "Effects processed"
        case .presented: "Effects presented"
        case .seek: "Seek"
        case .rate: "Speed changed"
        case .underrun: "Audio underrun"
        case .started: "Playback started"
        case .paused: "Playback paused"
        case .failed: "Playback failed"
        }
        if let effects = event.effects {
            let preset = effects.volumeBoost ? (effects.trimSilence ? "Both" : "Boost") : (effects.trimSilence ? "Trim" : "Off")
            return "\(name) · \(preset)"
        }
        if event.kind == .rate, let value = event.value { return "\(name) · \(value)×" }
        return name
    }
}

private struct AudioLabWaveform: View {
    let title: String
    let envelopes: [AudioInspectionEnvelope]
    let cuts: [AudioInspectionCut]
    let start: Double
    let end: Double
    let processed: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title).font(.subheadline.weight(.medium))
                Spacer()
                Text(envelopes.contains { $0.sourceEnd > start && $0.sourceStart < end && $0.peak > 1 } ? "Exceeds ±1 full scale" : "±1 full scale")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Canvas { context, size in
                let duration = max(0.01, end - start)
                let mid = size.height / 2
                var center = Path()
                center.move(to: CGPoint(x: 0, y: mid))
                center.addLine(to: CGPoint(x: size.width, y: mid))
                context.stroke(center, with: .color(.secondary.opacity(0.3)), lineWidth: 0.5)
                for cut in cuts where cut.sourceEnd > start && cut.sourceStart < end {
                    let lower = max(0, (cut.sourceStart - start) / duration * size.width)
                    let upper = min(size.width, (cut.sourceEnd - start) / duration * size.width)
                    context.fill(Path(CGRect(x: lower, y: 0, width: max(0, upper - lower), height: size.height)), with: .color(.orange.opacity(0.18)))
                }
                let columns = max(1, Int(size.width))
                var low = [Float](repeating: .infinity, count: columns)
                var high = [Float](repeating: -.infinity, count: columns)
                for envelope in envelopes where envelope.sourceEnd > start && envelope.sourceStart < end {
                    let first = max(0, min(columns - 1, Int((envelope.sourceStart - start) / duration * Double(columns))))
                    let last = max(first, min(columns - 1, Int((envelope.sourceEnd - start) / duration * Double(columns))))
                    for column in first...last {
                        low[column] = min(low[column], envelope.minimum)
                        high[column] = max(high[column], envelope.maximum)
                    }
                }
                var waveform = Path()
                for column in 0..<columns where low[column].isFinite && high[column].isFinite {
                    waveform.move(to: CGPoint(x: Double(column), y: mid - Double(max(-1, min(1, high[column]))) * mid))
                    waveform.addLine(to: CGPoint(x: Double(column), y: mid - Double(max(-1, min(1, low[column]))) * mid))
                }
                context.stroke(waveform, with: .color(processed ? PodcstPalette.accent : .secondary), lineWidth: 1)
            }
            .frame(height: 80)
            .clipped()
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(title) waveform, \(AudioLabFormat.time(start)) to \(AudioLabFormat.time(end)), fixed full-scale amplitude")
        }
    }
}

enum AudioLabFormat {
    static func time(_ seconds: Double) -> String {
        guard seconds.isFinite else { return "—" }
        let value = max(0, Int(seconds))
        return value >= 3_600 ? String(format: "%d:%02d:%02d", value / 3_600, value / 60 % 60, value % 60) : String(format: "%d:%02d", value / 60, value % 60)
    }

    static func decibels(_ value: Double?) -> String {
        value.map { String(format: "%+.1f dB", $0) } ?? "—"
    }
}
