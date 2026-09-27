use podcst_audio_engine::speech::{EffectsSettings, SourceSpan, SpeechProcessor};
use podcst_audio_engine::{AudioError, AudioFormat};

fn signal(rate: usize, channels: usize) -> Vec<f32> {
    (0..rate * 20 + 13)
        .flat_map(|frame| {
            let time = frame as f32 / rate as f32;
            let level = if (5.0..15.0).contains(&time) {
                0.00001
            } else if frame % rate < rate / 4 {
                0.0001
            } else {
                0.06
            };
            let value = level * (std::f32::consts::TAU * 317.0 * time).sin();
            (0..channels).map(move |channel| value * if channel == 0 { 1.0 } else { 0.5 })
        })
        .collect()
}

fn collect(
    input: &[f32],
    rate: u32,
    channels: usize,
    settings: EffectsSettings,
    chunks: &[usize],
    capacity: usize,
) -> (Vec<f32>, Vec<u64>) {
    let mut processor =
        SpeechProcessor::new(AudioFormat::new(rate, channels).unwrap(), settings).unwrap();
    let mut audio = Vec::new();
    let mut sources = Vec::new();
    let mut output = vec![0.0; capacity * channels];
    let mut spans = [SourceSpan::default(); 1];
    let mut append = |frames: usize, count: usize, output: &[f32], spans: &[SourceSpan]| {
        audio.extend_from_slice(&output[..frames * channels]);
        assert_eq!(
            spans[..count]
                .iter()
                .map(|span| span.frame_count as usize)
                .sum::<usize>(),
            frames
        );
        for span in &spans[..count] {
            assert_eq!(span.output_start_frame as usize, 0);
            sources.extend(
                span.source_start_frame..span.source_start_frame + u64::from(span.frame_count),
            );
        }
    };
    let mut cursor = 0;
    let bytes = processor.allocated_bytes();
    for chunk in chunks.iter().cycle() {
        let end = (cursor + chunk * channels).min(input.len());
        let report = processor
            .process(&input[cursor..end], &mut output, &mut spans)
            .unwrap();
        assert!(report.input_frames > 0 || report.output_frames > 0);
        cursor += report.input_frames * channels;
        append(report.output_frames, report.span_count, &output, &spans);
        assert!(processor.pending_frames() <= processor.maximum_buffered_frames());
        assert_eq!(processor.allocated_bytes(), bytes);
        if cursor == input.len() {
            break;
        }
    }
    loop {
        let report = processor.finish(&mut output, &mut spans).unwrap();
        append(report.output_frames, report.span_count, &output, &spans);
        if processor.is_finished() {
            break;
        }
        assert!(report.output_frames > 0);
    }
    assert_eq!(
        processor
            .finish(&mut output, &mut spans)
            .unwrap()
            .output_frames,
        0
    );
    (audio, sources)
}

#[test]
fn effects_are_chunk_invariant_with_exact_source_spans_and_linked_channels() {
    for channels in [1, 2] {
        let input = signal(8_000, channels);
        for (boost_enabled, trim_enabled) in
            [(false, false), (true, false), (false, true), (true, true)]
        {
            let settings = EffectsSettings {
                boost_enabled,
                trim_enabled,
                revision: 0,
            };
            let reference = collect(&input, 8_000, channels, settings, &[8192], 8192);
            let small = collect(&input, 8_000, channels, settings, &[1, 7, 83, 13, 1001], 41);
            assert_eq!(small, reference);
            let (output, sources) = reference;
            assert!(sources.windows(2).all(|pair| pair[0] < pair[1]));
            assert_eq!(
                sources.last().copied(),
                Some((input.len() / channels - 1) as u64)
            );
            if !trim_enabled {
                assert_eq!(sources.len(), input.len() / channels);
                if !boost_enabled {
                    assert_eq!(output, input);
                }
            } else {
                let removed = input.len() / channels - sources.len();
                assert!(removed > 4_000 && removed <= 12_000, "removed {removed}");
                let voiced = (0..input.len() / channels)
                    .filter(|frame| input[frame * channels].abs() > 0.001);
                for source in voiced {
                    assert!(
                        sources.binary_search(&(source as u64)).is_ok(),
                        "lost source {source}"
                    );
                }
            }
            if channels == 2 {
                for frame in output.chunks_exact(2) {
                    assert_eq!(frame[0] * 0.5, frame[1]);
                }
            }
        }
    }
}

#[test]
fn finish_empty_short_and_reset_discard_old_audio_and_preserve_origin() {
    let mut processor = SpeechProcessor::new(
        AudioFormat::new(48_000, 2).unwrap(),
        EffectsSettings::default(),
    )
    .unwrap();
    let mut output = [0.0; 4];
    let mut spans = [SourceSpan::default(); 2];
    assert_eq!(
        processor
            .finish(&mut output, &mut spans)
            .unwrap()
            .output_frames,
        0
    );
    assert!(processor.is_finished());
    processor.reset(900);
    assert_eq!(
        processor
            .process(&[0.1, 0.2, 0.3, 0.4], &mut [], &mut [])
            .unwrap()
            .input_frames,
        2
    );
    assert_eq!(processor.finish(&mut [], &mut []).unwrap().output_frames, 0);
    assert_eq!(
        processor.process(&[], &mut output, &mut spans),
        Err(AudioError::ProcessingFinished)
    );
    let report = processor.finish(&mut output, &mut spans).unwrap();
    assert_eq!(report.output_frames, 2);
    assert_eq!(output, [0.1, 0.2, 0.3, 0.4]);
    assert_eq!(spans[0].source_start_frame, 900);
    processor.reset(1500);
    processor
        .process(&[0.9; 22], &mut output, &mut spans)
        .unwrap();
    processor.reset(2200);
    assert_eq!(
        processor
            .finish(&mut output, &mut spans)
            .unwrap()
            .output_frames,
        0
    );
}

#[test]
fn settings_commit_at_analysis_boundary_and_invalid_input_is_atomic() {
    let mut processor = SpeechProcessor::new(
        AudioFormat::new(8_000, 1).unwrap(),
        EffectsSettings::default(),
    )
    .unwrap();
    let mut output = [0.0; 160];
    let mut spans = [SourceSpan::default(); 4];
    processor.reset(1_000);
    processor
        .process(&[0.1; 17], &mut output, &mut spans)
        .unwrap();
    processor
        .configure(EffectsSettings {
            boost_enabled: true,
            trim_enabled: true,
            revision: 9,
        })
        .unwrap();
    assert_eq!(processor.settings().revision, 0);
    assert!(
        processor
            .process(&[f32::NAN], &mut output, &mut spans)
            .is_err()
    );
    assert!(
        processor
            .process(&[f32::MAX], &mut output, &mut spans)
            .is_err()
    );
    processor
        .process(&[0.1; 63], &mut output, &mut spans)
        .unwrap();
    assert_eq!(processor.settings().revision, 0);
    processor
        .process(&[0.1; 1], &mut output, &mut spans)
        .unwrap();
    assert_eq!(processor.settings().revision, 9);
    assert_eq!(processor.applied_source_frame(), 1_080);
    processor.reset(u64::MAX);
    assert!(processor.process(&[0.1], &mut output, &mut spans).is_err());
    assert_eq!(processor.pending_frames(), 0);
}

#[test]
fn silence_toggle_preserves_monotonic_source_and_flushes_pending_tail() {
    let input = signal(8_000, 1);
    let mut processor = SpeechProcessor::new(
        AudioFormat::new(8_000, 1).unwrap(),
        EffectsSettings {
            trim_enabled: true,
            ..Default::default()
        },
    )
    .unwrap();
    let mut output = [0.0; 8192];
    let mut spans = [SourceSpan::default(); 20];
    let mut last = None;
    let mut retained = 0;
    let mut last_revision = 0;
    for (index, input) in input.chunks(80).enumerate() {
        if [510, 575, 660, 900, 980, 1500].contains(&index) {
            last_revision += 1;
            processor
                .configure(EffectsSettings {
                    boost_enabled: index % 2 == 0,
                    trim_enabled: last_revision % 2 == 0,
                    revision: last_revision,
                })
                .unwrap();
        }
        let report = processor.process(input, &mut output, &mut spans).unwrap();
        assert_eq!(report.input_frames, input.len());
        for span in &spans[..report.span_count] {
            if let Some(last) = last {
                assert!(span.source_start_frame > last);
            }
            last = Some(span.source_start_frame + u64::from(span.frame_count) - 1);
            retained += span.frame_count as usize;
        }
    }
    let report = processor.finish(&mut output, &mut spans).unwrap();
    for span in &spans[..report.span_count] {
        if let Some(last) = last {
            assert!(span.source_start_frame > last);
        }
        last = Some(span.source_start_frame + u64::from(span.frame_count) - 1);
        retained += span.frame_count as usize;
    }
    assert_eq!(last, Some(input.len() as u64 - 1));
    assert!(input.len() - retained <= 12_000);
    assert_eq!(processor.settings().revision, last_revision);
    assert!(processor.is_finished());
}

#[test]
fn quiet_uniform_audio_remains_exact_and_stereo_polarity_cannot_cancel_speech() {
    let quiet: Vec<f32> = (0..40_000)
        .map(|frame| 0.0001 * (frame as f32 * 0.249).sin())
        .collect();
    let settings = EffectsSettings {
        boost_enabled: true,
        trim_enabled: true,
        revision: 0,
    };
    assert_eq!(collect(&quiet, 8_000, 1, settings, &[731], 613).0, quiet);
    let input: Vec<f32> = signal(8_000, 1)
        .iter()
        .flat_map(|sample| [*sample, -*sample])
        .collect();
    let (output, sources) = collect(&input, 8_000, 2, settings, &[701], 519);
    for frame in output.chunks_exact(2) {
        assert_eq!(frame[0], -frame[1]);
    }
    for frame in (0..input.len() / 2).filter(|frame| input[frame * 2].abs() > 0.001) {
        assert!(sources.binary_search(&(frame as u64)).is_ok());
    }
}

#[test]
fn short_pauses_and_noise_floor_drift_do_not_gain_extra_removals() {
    let rate = 8_000;
    let warmup: Vec<f32> = (0..rate * 4)
        .map(|frame| {
            let level = if frame % rate < rate / 4 {
                0.00001
            } else {
                0.1
            };
            level * (frame as f32 * 0.249).sin()
        })
        .collect();
    let settings = EffectsSettings {
        trim_enabled: true,
        ..Default::default()
    };
    for pause_frames in [2_400, 3_920, 4_000, 7_200, 160_000] {
        let mut input = warmup.clone();
        input.extend((0..pause_frames).map(|frame| {
            let db = -100.0 + 48.0 * frame as f32 / pause_frames as f32;
            10.0f32.powf(db / 20.0) * (frame as f32 * 0.17).sin()
        }));
        input.extend((0..4_003).map(|frame| 0.1 * (frame as f32 * 0.249).sin()));
        let (_, sources) = collect(&input, 8_000, 1, settings, &[7001, 317], 501);
        let removed = input.len() - sources.len();
        if pause_frames < 4000 {
            assert_eq!(removed, 0);
        }
        assert!(removed <= 12_000, "pause {pause_frames}, removed {removed}");
    }
}

#[test]
fn boost_converges_toward_target_and_suppresses_upward_gain_during_noise() {
    use podcst_audio_engine::{PcmAudio, integrated_lufs};
    let input: Vec<f32> = (0..8_000 * 20)
        .map(|frame| {
            let level = if frame % 8_000 < 1600 { 0.00001 } else { 0.12 };
            level * (frame as f32 * std::f32::consts::TAU * 317.0 / 8_000.0).sin()
        })
        .collect();
    let (output, _) = collect(
        &input,
        8_000,
        1,
        EffectsSettings {
            boost_enabled: true,
            ..Default::default()
        },
        &[257],
        509,
    );
    let steady = PcmAudio::new(8_000, 1, output[8_000 * 15..].to_vec()).unwrap();
    let lufs = integrated_lufs(&steady);
    assert!((-16.0..=-12.0).contains(&lufs), "steady loudness {lufs}");
}
