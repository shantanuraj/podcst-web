use std::env;
use std::error::Error;
use std::path::Path;

use podcst_audio_engine::fixtures::generate_fixtures;
use podcst_audio_engine::vectors::write_bridge_vectors;
use podcst_audio_engine::wav::{read_wav, write_wav};
use podcst_audio_engine::{
    AdaptiveSilenceConfig, AnalysisConfig, BoostConfig, LimiterConfig, ProcessingConfig,
    TrimConfig, TrimEditConfig, analyze, process_audio,
};

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
        Some("bridge-vectors") => {
            let directory = args.next().ok_or("missing vector directory")?;
            for path in write_bridge_vectors(directory, &args.collect::<Vec<_>>())? {
                println!("{}", path.display());
            }
        }
        Some("process") => {
            let input_path = args.next().ok_or("missing input WAV path")?;
            let output_path = args.next().ok_or("missing output WAV path")?;
            let mut boost = false;
            let mut target_lufs = BoostConfig::default().target_lufs;
            let mut trim = false;
            let mut silence = podcst_audio_engine::SilenceConfig::default();
            let mut adaptive_trim = false;
            let mut adaptive_silence = AdaptiveSilenceConfig::default();
            let mut trim_edit = TrimEditConfig::default();
            let mut limiter = false;
            let mut limiter_config = LimiterConfig::default();
            let mut json = false;
            let mut chunk_frames = ProcessingConfig::default().chunk_frames;
            let remaining = args.collect::<Vec<_>>();
            let mut index = 0;
            while index < remaining.len() {
                match remaining[index].as_str() {
                    "--boost" => boost = true,
                    "--target-lufs" => {
                        index += 1;
                        target_lufs = remaining
                            .get(index)
                            .ok_or("missing value for --target-lufs")?
                            .parse()?;
                        boost = true;
                    }
                    "--trim-silence" => trim = true,
                    "--adaptive-silence" => adaptive_trim = true,
                    "--noise-floor-percentile" => {
                        index += 1;
                        adaptive_silence.noise_floor_percentile = remaining
                            .get(index)
                            .ok_or("missing value for --noise-floor-percentile")?
                            .parse()?;
                        adaptive_trim = true;
                    }
                    "--threshold-offset-db" => {
                        index += 1;
                        adaptive_silence.threshold_offset_db = remaining
                            .get(index)
                            .ok_or("missing value for --threshold-offset-db")?
                            .parse()?;
                        adaptive_trim = true;
                    }
                    "--min-dynamic-range-db" => {
                        index += 1;
                        adaptive_silence.min_dynamic_range_db = remaining
                            .get(index)
                            .ok_or("missing value for --min-dynamic-range-db")?
                            .parse()?;
                        adaptive_trim = true;
                    }
                    "--adaptive-min-threshold-dbfs" => {
                        index += 1;
                        adaptive_silence.min_threshold_dbfs = remaining
                            .get(index)
                            .ok_or("missing value for --adaptive-min-threshold-dbfs")?
                            .parse()?;
                        adaptive_trim = true;
                    }
                    "--adaptive-max-threshold-dbfs" => {
                        index += 1;
                        adaptive_silence.max_threshold_dbfs = remaining
                            .get(index)
                            .ok_or("missing value for --adaptive-max-threshold-dbfs")?
                            .parse()?;
                        adaptive_trim = true;
                    }
                    "--silence-threshold-dbfs" => {
                        index += 1;
                        silence.threshold_dbfs = remaining
                            .get(index)
                            .ok_or("missing value for --silence-threshold-dbfs")?
                            .parse()?;
                        trim = true;
                    }
                    "--min-silence-ms" => {
                        index += 1;
                        silence.min_silence_ms = remaining
                            .get(index)
                            .ok_or("missing value for --min-silence-ms")?
                            .parse()?;
                        trim = true;
                    }
                    "--guard-ms" => {
                        index += 1;
                        silence.guard_ms = remaining
                            .get(index)
                            .ok_or("missing value for --guard-ms")?
                            .parse()?;
                        adaptive_silence.guard_ms = silence.guard_ms;
                        trim = true;
                    }
                    "--retain-silence-ms" => {
                        index += 1;
                        trim_edit.retain_ms = remaining
                            .get(index)
                            .ok_or("missing value for --retain-silence-ms")?
                            .parse()?;
                        trim = true;
                    }
                    "--max-trim-ms" => {
                        index += 1;
                        trim_edit.max_trim_ms = remaining
                            .get(index)
                            .ok_or("missing value for --max-trim-ms")?
                            .parse()?;
                        trim = true;
                    }
                    "--fade-ms" => {
                        index += 1;
                        trim_edit.fade_ms = remaining
                            .get(index)
                            .ok_or("missing value for --fade-ms")?
                            .parse()?;
                        trim = true;
                    }
                    "--limit" => limiter = true,
                    "--ceiling-dbfs" => {
                        index += 1;
                        limiter_config.ceiling_dbfs = remaining
                            .get(index)
                            .ok_or("missing value for --ceiling-dbfs")?
                            .parse()?;
                        limiter = true;
                    }
                    "--lookahead-ms" => {
                        index += 1;
                        limiter_config.lookahead_ms = remaining
                            .get(index)
                            .ok_or("missing value for --lookahead-ms")?
                            .parse()?;
                        limiter = true;
                    }
                    "--release-ms" => {
                        index += 1;
                        limiter_config.release_ms = remaining
                            .get(index)
                            .ok_or("missing value for --release-ms")?
                            .parse()?;
                        limiter = true;
                    }
                    "--chunk-frames" => {
                        index += 1;
                        chunk_frames = remaining
                            .get(index)
                            .ok_or("missing value for --chunk-frames")?
                            .parse()?;
                    }
                    "--json" => json = true,
                    option => return Err(format!("unknown option: {option}").into()),
                }
                index += 1;
            }
            let input = read_wav(&input_path)?;
            let input_metrics = analyze(&input, &AnalysisConfig::default())?;
            let mut config = ProcessingConfig {
                chunk_frames,
                trim_edit,
                ..ProcessingConfig::default()
            };
            if boost {
                config.boost = Some(BoostConfig {
                    target_lufs,
                    ..BoostConfig::default()
                });
            }
            if trim {
                config.trim = Some(TrimConfig { silence });
            }
            if adaptive_trim {
                config.adaptive_trim = Some(adaptive_silence);
            }
            if limiter {
                config.limiter = Some(limiter_config);
            }
            let processed = process_audio(&input, &config)?;
            write_wav(&output_path, processed.audio())?;
            let output_metrics = analyze(processed.audio(), &AnalysisConfig::default())?;
            if json {
                println!(
                    "{{\"input\":{},\"output\":{},\"timeline\":{}}}",
                    metrics_json(Path::new(&input_path), &input_metrics),
                    metrics_json(Path::new(&output_path), &output_metrics),
                    timeline_json(processed.timeline())
                );
            } else {
                println!("wrote: {}", output_path);
                println!("input_duration_seconds: {:.3}", input.duration_seconds());
                println!(
                    "output_duration_seconds: {:.3}",
                    processed.audio().duration_seconds()
                );
                println!(
                    "input_integrated_lufs: {}",
                    format_number(input_metrics.integrated_lufs)
                );
                println!(
                    "output_integrated_lufs: {}",
                    format_number(output_metrics.integrated_lufs)
                );
                println!(
                    "timeline_segments: {}",
                    processed.timeline().segments().len()
                );
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
            let metrics = analyze(&audio, &config)?;
            if json {
                println!("{}", metrics_json(Path::new(&path), &metrics));
            } else {
                print_metrics(Path::new(&path), &metrics);
            }
        }
        _ => {
            print_usage();
            return Err("expected generate-fixtures, bridge-vectors, analyze, or process".into());
        }
    }
    Ok(())
}

fn print_usage() {
    eprintln!(
        "Usage:\n  audio-engine generate-fixtures <directory>\n  audio-engine bridge-vectors <directory> [case...]\n  audio-engine analyze <file.wav> [--json] [--silence-threshold-dbfs <dbfs>] [--min-silence-ms <ms>] [--guard-ms <ms>]\n  audio-engine process <input.wav> <output.wav> [--boost] [--target-lufs <lufs>] [--trim-silence|--adaptive-silence] [--retain-silence-ms <ms>] [--max-trim-ms <ms>] [--fade-ms <ms>] [--limit] [--json]"
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

fn timeline_json(timeline: &podcst_audio_engine::TimelineMap) -> String {
    let segments = timeline
        .segments()
        .iter()
        .map(|segment| {
            format!(
                "{{\"source_start_frame\":{},\"source_end_frame\":{},\"output_start_frame\":{},\"output_end_frame\":{}}}",
                segment.source_start_frame,
                segment.source_end_frame,
                segment.output_start_frame,
                segment.output_end_frame
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"sample_rate\":{},\"source_frames\":{},\"output_frames\":{},\"segments\":[{}]}}",
        timeline.sample_rate(),
        timeline.source_frames(),
        timeline.output_frames(),
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
