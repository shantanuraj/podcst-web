use std::fs;
use std::path::PathBuf;

use podcst_audio_engine::ffi::{PODCST_AUDIO_MAX_BLOCK_FRAMES, PodcstAudioConfig};
use podcst_audio_engine::speech::{EffectsSettings, SourceSpan, SpeechProcessor};
use podcst_audio_engine::vectors::{
    BridgeCase, BridgeEncoding, BridgeEngine, BridgeSpan, BridgeStep, bridge_vectors,
    write_bridge_vectors,
};
use podcst_audio_engine::{LimiterConfig, PcmProcessor, StreamingProcessor};

const BLOCK: usize = PODCST_AUDIO_MAX_BLOCK_FRAMES as usize;

fn temporary_directory(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("podcst-audio-engine-{name}-{}", std::process::id()))
}

#[test]
fn generator_writes_deterministic_files_matching_the_cases() {
    let first = temporary_directory("bridge-vectors-first");
    let second = temporary_directory("bridge-vectors-second");
    let cases = bridge_vectors(&[]).unwrap();
    let paths = write_bridge_vectors(&first, &[]).unwrap();
    write_bridge_vectors(&second, &[]).unwrap();
    assert_eq!(paths.len(), cases.len() * 2 + 1);
    let mut total = 0;
    for path in &paths {
        let bytes = fs::read(path).unwrap();
        assert_eq!(
            bytes,
            fs::read(second.join(path.file_name().unwrap())).unwrap()
        );
        total += bytes.len();
    }
    assert!(total < 8 * 1024 * 1024);
    let manifest = fs::read_to_string(first.join("manifest.json")).unwrap();
    for case in &cases {
        assert!(manifest.contains(&format!("\"name\":\"{}\"", case.name)));
        let output = fs::read(first.join(format!("{}.output.f32", case.name))).unwrap();
        assert_eq!(output.len(), case.output.len() * 4);
        assert!(
            output
                .chunks_exact(4)
                .zip(&case.output)
                .all(
                    |(bytes, sample)| f32::from_le_bytes(bytes.try_into().unwrap()).to_bits()
                        == sample.to_bits()
                )
        );
        let (extension, width) = match case.encoding {
            BridgeEncoding::Float => ("f32", 4),
            BridgeEncoding::Pcm16 => ("s16", 2),
        };
        let input = fs::read(first.join(format!("{}.input.{extension}", case.name))).unwrap();
        assert_eq!(input.len(), case.input.len() * width);
        if case.encoding == BridgeEncoding::Pcm16 {
            for (bytes, sample) in input.chunks_exact(2).zip(&case.input) {
                assert_eq!(
                    (f32::from(i16::from_le_bytes(bytes.try_into().unwrap())) / 32_768.0).to_bits(),
                    sample.to_bits()
                );
            }
        }
    }
    let subset = temporary_directory("bridge-vectors-subset");
    let names = vec!["limiter-mono-48000".to_owned()];
    assert_eq!(write_bridge_vectors(&subset, &names).unwrap().len(), 3);
    assert!(
        fs::read_to_string(subset.join("manifest.json"))
            .unwrap()
            .contains("limiter-mono-48000")
    );
    assert!(bridge_vectors(&["missing".to_owned()]).is_err());
    for directory in [first, second, subset] {
        let _ = fs::remove_dir_all(directory);
    }
}

#[test]
fn cases_cover_the_bridge_matrix() {
    let cases = bridge_vectors(&[]).unwrap();
    let has = |predicate: &dyn Fn(&BridgeCase) -> bool| cases.iter().any(predicate);
    for channels in [1, 2] {
        assert!(has(&|case| case.format.channels == channels));
    }
    for rate in [8_000, 22_050, 44_100, 48_000] {
        assert!(has(&|case| case.format.sample_rate == rate));
    }
    for settings in [(false, false), (true, false), (false, true), (true, true)] {
        assert!(has(&|case| case.engine
            == BridgeEngine::Effects {
                boost: settings.0,
                trim: settings.1
            }));
    }
    assert!(has(&|case| case.encoding == BridgeEncoding::Pcm16));
    assert!(has(&|case| case.engine == BridgeEngine::Limiter));
    let offers = |case: &BridgeCase, frames: usize| {
        case.steps
            .iter()
            .any(|step| matches!(step, BridgeStep::Process { frames: offered, .. } if *offered == frames))
    };
    assert!(has(&|case| offers(case, 1)));
    assert!(has(&|case| offers(case, BLOCK)));
    assert!(has(&|case| case.steps.iter().any(
        |step| matches!(step, BridgeStep::Configure(settings) if settings.revision > 0)
    )));
    assert!(has(&|case| case.steps.iter().any(
        |step| matches!(step, BridgeStep::Reset(origin) if *origin > 0)
    )));
}

#[test]
fn steps_account_for_every_frame_and_span() {
    for case in bridge_vectors(&[]).unwrap() {
        let channels = case.format.channels;
        let mut consumed = 0;
        let mut emitted = 0;
        let mut segment_emitted = vec![0];
        for step in &case.steps {
            match *step {
                BridgeStep::Process {
                    frames,
                    capacity,
                    span_capacity,
                    report,
                } => {
                    assert!(frames <= BLOCK && capacity <= BLOCK && span_capacity <= BLOCK);
                    assert!(report.input_frames <= frames && report.output_frames <= capacity);
                    assert!(report.span_count <= span_capacity);
                    consumed += report.input_frames;
                    emitted += report.output_frames;
                    *segment_emitted.last_mut().unwrap() += report.output_frames;
                }
                BridgeStep::Finish {
                    capacity, report, ..
                } => {
                    assert!(capacity > 0 && report.output_frames <= capacity);
                    emitted += report.output_frames;
                    *segment_emitted.last_mut().unwrap() += report.output_frames;
                }
                BridgeStep::Reset(_) => segment_emitted.push(0),
                BridgeStep::Configure(_) => {}
            }
        }
        assert!(matches!(
            case.steps.last(),
            Some(BridgeStep::Finish { finished: true, .. })
        ));
        assert_eq!(consumed * channels, case.input.len(), "{}", case.name);
        assert_eq!(emitted * channels, case.output.len(), "{}", case.name);
        match case.engine {
            BridgeEngine::Effects { trim, .. } => {
                assert_eq!(case.spans.len(), segment_emitted.len());
                for (spans, frames) in case.spans.iter().zip(&segment_emitted) {
                    let mut output = 0;
                    for span in spans {
                        assert_eq!(span.output_start_frame, output);
                        output += span.frame_count;
                    }
                    assert_eq!(output as usize, *frames, "{}", case.name);
                }
                if trim && case.input.len() >= 3 * case.format.sample_rate as usize * channels {
                    assert!(case.output.len() < case.input.len(), "{}", case.name);
                }
            }
            BridgeEngine::Limiter => {
                assert!(case.input.iter().any(|sample| sample.abs() > 1.5));
                assert!(case.output.iter().all(|sample| sample.abs() <= 0.9));
                if segment_emitted.len() == 1 {
                    assert_eq!(case.output.len(), case.input.len());
                }
            }
        }
    }
}

#[test]
fn expected_audio_is_independent_of_the_call_schedule() {
    for case in bridge_vectors(&[]).unwrap() {
        let (output, spans) = replay_in_blocks(&case);
        assert!(
            output
                .iter()
                .zip(&case.output)
                .all(|(left, right)| left.to_bits() == right.to_bits())
                && output.len() == case.output.len(),
            "{}",
            case.name
        );
        assert_eq!(spans, case.spans, "{}", case.name);
    }
}

fn replay_in_blocks(case: &BridgeCase) -> (Vec<f32>, Vec<Vec<BridgeSpan>>) {
    let channels = case.format.channels;
    let mut effects = match case.engine {
        BridgeEngine::Effects { boost, trim } => Some(
            SpeechProcessor::new(
                case.format,
                EffectsSettings {
                    boost_enabled: boost,
                    trim_enabled: trim,
                    revision: 0,
                },
            )
            .unwrap(),
        ),
        BridgeEngine::Limiter => None,
    };
    let defaults = PodcstAudioConfig::default();
    let mut limiter = PcmProcessor::new(
        case.format,
        0.0,
        Some(&LimiterConfig {
            lookahead_ms: f64::from(defaults.lookahead_ms),
            ceiling_dbfs: f64::from(defaults.ceiling_dbfs),
            release_ms: f64::from(defaults.release_ms),
        }),
    )
    .unwrap();
    let mut buffer = vec![0.0; BLOCK * channels];
    let mut span_buffer = vec![SourceSpan::default(); BLOCK];
    let mut collector = Collector {
        channels,
        output: Vec::new(),
        segments: vec![Vec::new()],
        segment_frames: 0,
    };
    let mut fed = 0;
    let mut target = 0;
    let mut finished = false;
    for step in &case.steps {
        if let BridgeStep::Process { report, .. } = step {
            target += report.input_frames;
            continue;
        }
        while fed < target {
            let end = (fed + BLOCK).min(target);
            let input = &case.input[fed * channels..end * channels];
            let (frames, spans, consumed) = match &mut effects {
                Some(effects) => {
                    let report = effects
                        .process(input, &mut buffer, &mut span_buffer)
                        .unwrap();
                    (report.output_frames, report.span_count, report.input_frames)
                }
                None => {
                    let report = limiter.process(input, &mut buffer).unwrap();
                    (report.output_frames, 0, report.input_frames)
                }
            };
            collector.collect(frames, spans, &buffer, &span_buffer);
            fed += consumed;
        }
        match *step {
            BridgeStep::Configure(settings) => {
                effects.as_mut().unwrap().configure(settings).unwrap();
            }
            BridgeStep::Reset(origin) => {
                if let Some(effects) = &mut effects {
                    while effects.has_ready_output() {
                        let report = effects.process(&[], &mut buffer, &mut span_buffer).unwrap();
                        collector.collect(
                            report.output_frames,
                            report.span_count,
                            &buffer,
                            &span_buffer,
                        );
                    }
                    effects.reset(origin);
                } else {
                    limiter.reset();
                }
                collector.segments.push(Vec::new());
                collector.segment_frames = 0;
            }
            BridgeStep::Finish { .. } if !finished => {
                finished = true;
                loop {
                    let (frames, spans, done) = match &mut effects {
                        Some(effects) => {
                            let report = effects.finish(&mut buffer, &mut span_buffer).unwrap();
                            (
                                report.output_frames,
                                report.span_count,
                                effects.is_finished(),
                            )
                        }
                        None => {
                            let report = limiter.finish(&mut buffer).unwrap();
                            (report.output_frames, 0, limiter.is_finished())
                        }
                    };
                    collector.collect(frames, spans, &buffer, &span_buffer);
                    if done {
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    if effects.is_none() {
        collector.segments.clear();
    }
    (collector.output, collector.segments)
}

struct Collector {
    channels: usize,
    output: Vec<f32>,
    segments: Vec<Vec<BridgeSpan>>,
    segment_frames: u64,
}

impl Collector {
    fn collect(&mut self, frames: usize, span_count: usize, buffer: &[f32], spans: &[SourceSpan]) {
        self.output
            .extend_from_slice(&buffer[..frames * self.channels]);
        let segment = self.segments.last_mut().unwrap();
        for span in &spans[..span_count] {
            let next = BridgeSpan {
                source_start_frame: span.source_start_frame,
                output_start_frame: self.segment_frames + u64::from(span.output_start_frame),
                frame_count: u64::from(span.frame_count),
            };
            match segment.last_mut() {
                Some(last)
                    if last.source_start_frame + last.frame_count == next.source_start_frame =>
                {
                    last.frame_count += next.frame_count
                }
                _ => segment.push(next),
            }
        }
        self.segment_frames += frames as u64;
    }
}
