use std::fs;
use std::path::PathBuf;

use podcst_audio_engine::fixtures::generate_fixtures;
use podcst_audio_engine::{AnalysisConfig, analyze, oversampled_peak, read_wav};

#[test]
fn generated_fixtures_produce_stable_analysis_baselines() {
    let directory = temporary_directory("analysis");
    let paths = generate_fixtures(&directory).unwrap();

    let quiet_and_loud = read_wav(directory.join("quiet-and-loud-tone.wav")).unwrap();
    let quiet_and_loud_metrics = analyze(&quiet_and_loud, &AnalysisConfig::default()).unwrap();
    assert_eq!(quiet_and_loud_metrics.duration_seconds, 6.0);
    assert_close(quiet_and_loud_metrics.integrated_lufs, -13.205, 0.02);
    assert_close(quiet_and_loud_metrics.sample_peak_dbfs, -9.119, 0.02);
    assert_eq!(quiet_and_loud_metrics.silence_segments.len(), 1);
    assert_close(
        quiet_and_loud_metrics.silence_segments[0].start_seconds,
        2.02,
        0.011,
    );
    assert_close(
        quiet_and_loud_metrics.silence_segments[0].end_seconds,
        3.98,
        0.011,
    );

    let speech_gaps = read_wav(directory.join("speech-gaps.wav")).unwrap();
    let speech_metrics = analyze(&speech_gaps, &AnalysisConfig::default()).unwrap();
    assert_eq!(speech_metrics.silence_segments.len(), 4);
    assert_close(speech_metrics.integrated_lufs, -26.060, 0.02);
    assert_close(
        speech_metrics.silence_segments[0].duration_seconds(),
        0.96,
        0.011,
    );

    let stereo = read_wav(directory.join("stereo-phase.wav")).unwrap();
    let stereo_metrics = analyze(&stereo, &AnalysisConfig::default()).unwrap();
    assert_eq!(stereo.channels(), 2);
    assert!(stereo_metrics.silence_segments.is_empty());
    assert!(stereo_metrics.integrated_lufs > -13.0);

    assert_eq!(paths.len(), 3);
    cleanup(&directory);
}

#[test]
fn processing_cli_writes_trimmed_and_boosted_output() {
    let directory = temporary_directory("process-cli");
    generate_fixtures(&directory).unwrap();
    let input_path = directory.join("speech-gaps.wav");
    let output_path = directory.join("speech-gaps-processed.wav");
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_audio-engine"))
        .args([
            "process",
            input_path.to_str().unwrap(),
            output_path.to_str().unwrap(),
            "--boost",
            "--adaptive-silence",
            "--limit",
            "--json",
        ])
        .output()
        .unwrap();

    assert!(output.status.success());
    let json = String::from_utf8(output.stdout).unwrap();
    assert!(json.contains("\"timeline\":{") && json.contains("\"segments\":["));
    let input = read_wav(&input_path).unwrap();
    let processed = read_wav(&output_path).unwrap();
    assert!(processed.duration_seconds() < input.duration_seconds());
    assert!(
        analyze(&processed, &AnalysisConfig::default())
            .unwrap()
            .integrated_lufs
            .is_finite()
    );
    assert!(oversampled_peak(&processed) <= 10.0f32.powf(-1.0 / 20.0) + 0.001);
    cleanup(&directory);
}

#[test]
fn analysis_json_contract_is_available_from_cli() {
    let directory = temporary_directory("cli");
    generate_fixtures(&directory).unwrap();
    let file = directory.join("speech-gaps.wav");
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_audio-engine"))
        .args(["analyze", file.to_str().unwrap(), "--json"])
        .output()
        .unwrap();

    assert!(output.status.success());
    let json = String::from_utf8(output.stdout).unwrap();
    assert!(json.starts_with('{'));
    assert!(json.trim_end().ends_with('}'));
    assert!(json.contains("\"integrated_lufs\":"));
    assert!(json.contains("\"silence_segments\":["));
    cleanup(&directory);
}

fn temporary_directory(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("podcst-audio-engine-{name}-{}", std::process::id()))
}

fn cleanup(directory: &PathBuf) {
    let _ = fs::remove_dir_all(directory);
}

fn assert_close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "expected {expected}, got {actual}, tolerance {tolerance}"
    );
}

fn streaming_signal(frames: usize, channels: usize) -> Vec<f32> {
    (0..frames)
        .flat_map(|frame| {
            (0..channels).map(move |channel| {
                let amplitude = if (frame / 24_000) % 3 == 1 { 0.0 } else { 0.15 };
                amplitude
                    * (2.0 * std::f32::consts::PI * (997 + channel * 101) as f32 * frame as f32
                        / 48_000.0)
                        .sin()
            })
        })
        .collect()
}

#[test]
fn streaming_loudness_matches_across_chunks_and_tracks_offline_reference() {
    use podcst_audio_engine::{
        AudioFormat, PcmAudio, StreamingLoudnessAnalyzer, integrated_lufs, rms_dbfs,
    };

    let format = AudioFormat::new(48_000, 2).unwrap();
    let samples = streaming_signal(144_317, format.channels);
    let audio = PcmAudio::new(format.sample_rate, format.channels, samples).unwrap();
    let mut expected = None;
    for chunk in [1, 7, 1024, 40_001, audio.frames()] {
        let mut analyzer = StreamingLoudnessAnalyzer::new(format).unwrap();
        for input in audio.samples().chunks(chunk * format.channels) {
            analyzer.process(input).unwrap();
        }
        let metrics = analyzer.finish();
        assert_eq!(metrics.frames, audio.frames());
        assert_close(metrics.integrated_lufs, integrated_lufs(&audio), 0.05);
        assert_close(metrics.rms_dbfs, rms_dbfs(&audio), 1e-10);
        if let Some(expected) = &expected {
            assert_eq!(&metrics, expected);
        } else {
            expected = Some(metrics);
        }
    }
}

#[test]
fn streaming_loudness_finish_and_seek_discard_old_history() {
    use podcst_audio_engine::{AudioFormat, PcmAudio, StreamingLoudnessAnalyzer, integrated_lufs};

    let format = AudioFormat::new(48_000, 1).unwrap();
    let input = streaming_signal(317, 1);
    let mut analyzer = StreamingLoudnessAnalyzer::new(format).unwrap();
    let empty = analyzer.finish();
    assert_eq!(empty.frames, 0);
    assert_eq!(empty.integrated_lufs, f64::NEG_INFINITY);
    assert_eq!(analyzer.finish(), empty);
    assert!(analyzer.process(&input).is_err());
    analyzer.start();
    analyzer.process(&input).unwrap();
    assert_eq!(analyzer.metrics().loudness_blocks, 0);
    let metrics = analyzer.finish();
    assert_eq!(metrics.loudness_blocks, 1);
    assert_close(
        metrics.integrated_lufs,
        integrated_lufs(&PcmAudio::new(48_000, 1, input.clone()).unwrap()),
        1e-10,
    );
    assert_eq!(analyzer.finish(), metrics);
    analyzer.start();
    analyzer.process(&[0.5; 1000]).unwrap();
    analyzer.seek(123_456);
    analyzer.process(&input).unwrap();
    let mut sought = analyzer.finish();
    assert_eq!(sought.source_start_frame, 123_456);
    sought.source_start_frame = 0;
    assert_eq!(sought, metrics);
    analyzer.reset();
    assert_eq!(analyzer.metrics(), empty);
}

#[test]
fn streaming_fixed_silence_matches_offline_and_flushes_partial_frame() {
    use podcst_audio_engine::{
        AudioFormat, PcmAudio, SilenceConfig, StreamingSilenceConfig, StreamingSilenceDetector,
        detect_silence,
    };

    let format = AudioFormat::new(48_000, 2).unwrap();
    let mut samples = streaming_signal(144_000, 2);
    samples.extend(vec![0.0; 24_317 * 2]);
    let audio = PcmAudio::new(48_000, 2, samples).unwrap();
    let config = SilenceConfig::default();
    let expected = detect_silence(&audio, &config).unwrap();
    for chunk in [1, 7, 1024, 40_001, audio.frames()] {
        let mut detector =
            StreamingSilenceDetector::new(format, StreamingSilenceConfig::Fixed(config.clone()))
                .unwrap();
        let mut segments = Vec::new();
        for input in audio.samples().chunks(chunk * 2) {
            detector
                .process(input, |segment| segments.push(segment))
                .unwrap();
        }
        assert_eq!(segments.len(), expected.len() - 1);
        detector.finish(|segment| segments.push(segment));
        detector.finish(|_| panic!("duplicate finish event"));
        assert_eq!(segments.len(), expected.len());
        for (actual, expected) in segments.iter().zip(&expected) {
            assert_eq!(
                actual.source_start_frame,
                (expected.start_seconds * 48_000.0).round() as usize
            );
            assert_eq!(
                actual.source_end_frame,
                (expected.end_seconds * 48_000.0).round() as usize
            );
        }
        assert!(detector.process(&[], |_| {}).is_err());
    }
}

#[test]
fn streaming_adaptive_silence_warms_up_and_is_chunk_invariant() {
    use podcst_audio_engine::{
        AdaptiveSilenceConfig, AudioFormat, StreamingSilenceConfig, StreamingSilenceDetector,
    };

    let format = AudioFormat::new(1000, 2).unwrap();
    let config = StreamingSilenceConfig::Adaptive {
        silence: AdaptiveSilenceConfig {
            min_silence_ms: 100,
            guard_ms: 20,
            ..AdaptiveSilenceConfig::default()
        },
        window_ms: 1000,
    };
    let samples: Vec<f32> = (0..5007)
        .flat_map(|frame| {
            let value = if frame % 1000 < 500 { 0.1 } else { 0.0001 };
            [0.0, value]
        })
        .collect();
    let mut expected = None;
    for chunk in [1, 7, 512, samples.len() / 2] {
        let mut detector = StreamingSilenceDetector::new(format, config.clone()).unwrap();
        assert_eq!(detector.warm_up_frames(), 1000);
        let mut segments = Vec::new();
        for input in samples.chunks(chunk * 2) {
            detector
                .process(input, |segment| segments.push(segment))
                .unwrap();
        }
        detector.finish(|segment| segments.push(segment));
        assert_eq!(segments.len(), 4);
        assert_eq!(segments[0].source_start_frame, 1520);
        assert_eq!(segments[0].source_end_frame, 1980);
        if let Some(expected) = &expected {
            assert_eq!(&segments, expected);
        } else {
            expected = Some(segments);
        }
        detector.seek(50_000);
        let mut sought = Vec::new();
        detector
            .process(&samples, |segment| sought.push(segment))
            .unwrap();
        detector.finish(|segment| sought.push(segment));
        for (actual, expected) in sought.iter().zip(expected.as_ref().unwrap()) {
            assert_eq!(
                actual.source_start_frame,
                expected.source_start_frame + 50_000
            );
            assert_eq!(actual.source_end_frame, expected.source_end_frame + 50_000);
        }
        assert_eq!(sought.len(), expected.as_ref().unwrap().len());
        detector.start();
        detector
            .process(&vec![0.0001; 4000], |_| {
                panic!("uniform audio classified as silence")
            })
            .unwrap();
        detector.finish(|_| panic!("uniform audio classified as silence"));
    }
}

#[test]
fn streaming_silence_seek_discards_pending_frame_and_open_pause() {
    use podcst_audio_engine::{
        AudioFormat, SilenceConfig, SilenceFrameSegment, StreamingSilenceConfig,
        StreamingSilenceDetector,
    };

    let mut detector = StreamingSilenceDetector::new(
        AudioFormat::new(1000, 1).unwrap(),
        StreamingSilenceConfig::Fixed(SilenceConfig::default()),
    )
    .unwrap();
    detector
        .process(&vec![0.0; 777], |_| panic!("pause still open"))
        .unwrap();
    detector.seek(10_000);
    let mut segments = Vec::new();
    detector
        .process(&vec![0.0; 333], |segment| segments.push(segment))
        .unwrap();
    detector.finish(|segment| segments.push(segment));
    assert_eq!(
        segments,
        [SilenceFrameSegment {
            source_start_frame: 10_020,
            source_end_frame: 10_313
        }]
    );
    detector.reset();
    detector.finish(|_| panic!("reset retained silence"));
}

#[test]
fn streaming_processors_flush_once_and_restart_without_old_audio() {
    use podcst_audio_engine::{
        AudioFormat, GainProcessor, LimiterConfig, StreamingProcessor, TruePeakLimiter,
    };

    fn check(mut processor: impl StreamingProcessor) {
        let input = streaming_signal(37, 2);
        let mut expected = Vec::new();
        let report = processor.process(&input, &mut expected).unwrap();
        assert_eq!(report.input_frames, 37);
        assert_eq!(
            report.output_frames,
            37usize.saturating_sub(processor.latency_frames())
        );
        let tail = processor.finish(&mut expected).unwrap();
        assert_eq!(tail.input_frames, 0);
        assert_eq!(report.output_frames + tail.output_frames, 37);
        assert_eq!(expected.len(), input.len());
        assert_eq!(processor.finish(&mut expected).unwrap().output_frames, 0);
        assert!(processor.process(&input, &mut expected).is_err());
        for action in [0, 1, 2] {
            match action {
                0 => processor.start(),
                1 => processor.reset(),
                _ => processor.seek(),
            }
            processor.process(&[1.5; 2048], &mut Vec::new()).unwrap();
            processor.seek();
            let mut actual = Vec::new();
            for frame in input.chunks(2) {
                processor.process(frame, &mut actual).unwrap();
            }
            processor.finish(&mut actual).unwrap();
            assert_eq!(actual, expected);
        }
    }
    let format = AudioFormat::new(48_000, 2).unwrap();
    check(GainProcessor::new(format, 6.0).unwrap());
    check(TruePeakLimiter::new(format, &LimiterConfig::default()).unwrap());
}

#[test]
fn streaming_analyzers_reject_invalid_chunks_without_consuming_prefix() {
    use podcst_audio_engine::{
        AudioFormat, SilenceConfig, StreamingLoudnessAnalyzer, StreamingSilenceConfig,
        StreamingSilenceDetector,
    };

    let format = AudioFormat::new(48_000, 2).unwrap();
    let mut loudness = StreamingLoudnessAnalyzer::new(format).unwrap();
    let before = loudness.metrics();
    let mut silence = StreamingSilenceDetector::new(
        format,
        StreamingSilenceConfig::Fixed(SilenceConfig::default()),
    )
    .unwrap();
    for input in [&[0.1][..], &[0.1, f32::NAN], &[f32::INFINITY, 0.1]] {
        assert!(loudness.process(input).is_err());
        assert_eq!(loudness.metrics(), before);
        assert!(
            silence
                .process(input, |_| panic!("invalid input emitted event"))
                .is_err()
        );
    }
    silence.finish(|_| panic!("invalid input retained silence"));
    let invalid = AudioFormat {
        sample_rate: 48_000,
        channels: 0,
    };
    assert!(StreamingLoudnessAnalyzer::new(invalid).is_err());
    assert!(
        StreamingSilenceDetector::new(
            invalid,
            StreamingSilenceConfig::Fixed(SilenceConfig::default())
        )
        .is_err()
    );
}

#[test]
fn streaming_adaptive_finish_does_not_skip_warm_up_with_partial_frame() {
    use podcst_audio_engine::{
        AdaptiveSilenceConfig, AudioFormat, StreamingSilenceConfig, StreamingSilenceDetector,
    };

    let mut detector = StreamingSilenceDetector::new(
        AudioFormat::new(1000, 1).unwrap(),
        StreamingSilenceConfig::Adaptive {
            silence: AdaptiveSilenceConfig {
                min_silence_ms: 1,
                guard_ms: 0,
                ..AdaptiveSilenceConfig::default()
            },
            window_ms: 100,
        },
    )
    .unwrap();
    detector
        .process(&[0.1; 50], |_| panic!("warm-up event"))
        .unwrap();
    detector
        .process(&[0.0; 49], |_| panic!("warm-up event"))
        .unwrap();
    detector.finish(|_| panic!("partial frame completed warm-up early"));
}

#[test]
fn streaming_limiter_stereo_output_is_chunk_invariant() {
    use podcst_audio_engine::{
        AudioFormat, LimiterConfig, PcmAudio, TruePeakLimiter, process_streaming,
    };

    let format = AudioFormat::new(48_000, 2).unwrap();
    let samples = (0..4099)
        .flat_map(|frame| {
            let level = if frame % 500 == 0 { 1.5 } else { -0.1 };
            [0.01, level]
        })
        .collect();
    let input = PcmAudio::new(48_000, 2, samples).unwrap();
    let mut expected = None;
    for chunk in [1, 7, 257, 4099] {
        let mut limiter = TruePeakLimiter::new(format, &LimiterConfig::default()).unwrap();
        let output = process_streaming(&input, &mut limiter, chunk).unwrap();
        assert_eq!(output.frames(), input.frames());
        if let Some(expected) = &expected {
            assert_eq!(&output, expected);
        } else {
            expected = Some(output);
        }
    }
}
