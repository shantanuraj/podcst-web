use std::env;
use std::error::Error;
use std::path::Path;

use podcst_audio_engine::fixtures::generate_fixtures;
use podcst_audio_engine::wav::read_wav;
use podcst_audio_engine::{AnalysisConfig, analyze};

fn main() -> Result<(), Box<dyn Error>> {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some("generate-fixtures") => {
            let directory = args.next().ok_or("missing fixture directory")?;
            if args.next().is_some() {
                return Err("generate-fixtures accepts exactly one directory".into());
            }
            for path in generate_fixtures(directory)? {
                println!("{}", path.display());
            }
        }
        Some("analyze") => {
            let path = args.next().ok_or("missing WAV path")?;
            let mut json = false;
            let mut config = AnalysisConfig::default();
            let remaining = args.collect::<Vec<_>>();
            let mut index = 0;
            while index < remaining.len() {
                match remaining[index].as_str() {
                    "--json" => json = true,
                    "--silence-threshold-dbfs" => {
                        index += 1;
                        config.silence.threshold_dbfs = remaining
                            .get(index)
                            .ok_or("missing value for --silence-threshold-dbfs")?
                            .parse()?;
                    }
                    "--min-silence-ms" => {
                        index += 1;
                        config.silence.min_silence_ms = remaining
                            .get(index)
                            .ok_or("missing value for --min-silence-ms")?
                            .parse()?;
                    }
                    "--guard-ms" => {
                        index += 1;
                        config.silence.guard_ms = remaining
                            .get(index)
                            .ok_or("missing value for --guard-ms")?
                            .parse()?;
                    }
                    option => return Err(format!("unknown option: {option}").into()),
                }
                index += 1;
            }
            let audio = read_wav(&path)?;
            let metrics = analyze(&audio, &config);
            if json {
                println!("{}", metrics_json(Path::new(&path), &metrics));
            } else {
                print_metrics(Path::new(&path), &metrics);
            }
        }
        _ => {
            print_usage();
            return Err("expected generate-fixtures or analyze".into());
        }
    }
    Ok(())
}

fn print_usage() {
    eprintln!(
        "Usage:\n  audio-engine generate-fixtures <directory>\n  audio-engine analyze <file.wav> [--json] [--silence-threshold-dbfs <dbfs>] [--min-silence-ms <ms>] [--guard-ms <ms>]"
    );
}

fn print_metrics(path: &Path, metrics: &podcst_audio_engine::AudioMetrics) {
    println!("file: {}", path.display());
    println!("sample_rate: {} Hz", metrics.sample_rate);
    println!("channels: {}", metrics.channels);
    println!("frames: {}", metrics.frames);
    println!("duration_seconds: {:.6}", metrics.duration_seconds);
    println!("rms_dbfs: {}", format_number(metrics.rms_dbfs));
    println!(
        "sample_peak_dbfs: {}",
        format_number(metrics.sample_peak_dbfs)
    );
    println!(
        "oversampled_peak_dbfs: {}",
        format_number(metrics.oversampled_peak_dbfs)
    );
    println!(
        "integrated_lufs: {}",
        format_number(metrics.integrated_lufs)
    );
    println!("silence_segments:");
    for segment in &metrics.silence_segments {
        println!(
            "  {:.3}s - {:.3}s ({:.3}s)",
            segment.start_seconds,
            segment.end_seconds,
            segment.duration_seconds()
        );
    }
}

fn metrics_json(path: &Path, metrics: &podcst_audio_engine::AudioMetrics) -> String {
    let segments = metrics
        .silence_segments
        .iter()
        .map(|segment| {
            format!(
                "{{\"start_seconds\":{:.9},\"end_seconds\":{:.9}}}",
                segment.start_seconds, segment.end_seconds
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"file\":\"{}\",\"sample_rate\":{},\"channels\":{},\"frames\":{},\"duration_seconds\":{:.9},\"rms_dbfs\":{},\"sample_peak_dbfs\":{},\"oversampled_peak_dbfs\":{},\"integrated_lufs\":{},\"silence_segments\":[{}]}}",
        json_escape(&path.display().to_string()),
        metrics.sample_rate,
        metrics.channels,
        metrics.frames,
        metrics.duration_seconds,
        json_number(metrics.rms_dbfs),
        json_number(metrics.sample_peak_dbfs),
        json_number(metrics.oversampled_peak_dbfs),
        json_number(metrics.integrated_lufs),
        segments
    )
}

fn format_number(value: f64) -> String {
    if value.is_finite() {
        format!("{value:.3}")
    } else {
        "-inf".to_owned()
    }
}

fn json_number(value: f64) -> String {
    if value.is_finite() {
        format!("{value:.9}")
    } else {
        "null".to_owned()
    }
}

fn json_escape(value: &str) -> String {
    value
        .chars()
        .flat_map(|character| match character {
            '"' => "\\\"".chars().collect::<Vec<_>>(),
            '\\' => "\\\\".chars().collect(),
            '\n' => "\\n".chars().collect(),
            '\r' => "\\r".chars().collect(),
            '\t' => "\\t".chars().collect(),
            character => vec![character],
        })
        .collect()
}
