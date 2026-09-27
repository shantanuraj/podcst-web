use std::fs;
use std::path::PathBuf;

use podcst_audio_engine::fixtures::generate_fixtures;
use podcst_audio_engine::{AnalysisConfig, analyze, read_wav};

#[test]
fn generated_fixtures_produce_stable_analysis_baselines() {
    let directory = temporary_directory("analysis");
    let paths = generate_fixtures(&directory).unwrap();

    let quiet_and_loud = read_wav(directory.join("quiet-and-loud-tone.wav")).unwrap();
    let quiet_and_loud_metrics = analyze(&quiet_and_loud, &AnalysisConfig::default());
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
    let speech_metrics = analyze(&speech_gaps, &AnalysisConfig::default());
    assert_eq!(speech_metrics.silence_segments.len(), 4);
    assert_close(speech_metrics.integrated_lufs, -26.060, 0.02);
    assert_close(
        speech_metrics.silence_segments[0].duration_seconds(),
        0.96,
        0.011,
    );

    let stereo = read_wav(directory.join("stereo-phase.wav")).unwrap();
    let stereo_metrics = analyze(&stereo, &AnalysisConfig::default());
    assert_eq!(stereo.channels(), 2);
    assert!(stereo_metrics.silence_segments.is_empty());
    assert!(stereo_metrics.integrated_lufs > -13.0);

    assert_eq!(paths.len(), 3);
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
