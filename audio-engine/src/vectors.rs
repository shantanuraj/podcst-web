use std::fs;
use std::path::{Path, PathBuf};

use crate::ffi::{PODCST_AUDIO_MAX_BLOCK_FRAMES, PodcstAudioConfig};
use crate::speech::{EffectsReport, EffectsSettings, SourceSpan, SpeechProcessor};
use crate::{AudioError, AudioFormat, LimiterConfig, PcmProcessor, StreamingProcessor};

const MAX_BLOCK_FRAMES: usize = PODCST_AUDIO_MAX_BLOCK_FRAMES as usize;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BridgeEngine {
    Effects { boost: bool, trim: bool },
    Limiter,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BridgeEncoding {
    Float,
    Pcm16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BridgeStep {
    Process {
        frames: usize,
        capacity: usize,
        span_capacity: usize,
        report: EffectsReport,
    },
    Finish {
        capacity: usize,
        span_capacity: usize,
        report: EffectsReport,
        finished: bool,
    },
    Configure(EffectsSettings),
    Reset(u64),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BridgeSpan {
    pub source_start_frame: u64,
    pub output_start_frame: u64,
    pub frame_count: u64,
}

pub struct BridgeCase {
    pub name: &'static str,
    pub engine: BridgeEngine,
    pub format: AudioFormat,
    pub encoding: BridgeEncoding,
    pub input: Vec<f32>,
    pub output: Vec<f32>,
    pub steps: Vec<BridgeStep>,
    pub spans: Vec<Vec<BridgeSpan>>,
}

#[derive(Clone, Copy)]
enum Schedule {
    Random(u32),
    Fixed(usize, usize),
}

struct Spec {
    name: &'static str,
    engine: BridgeEngine,
    sample_rate: u32,
    channels: usize,
    encoding: BridgeEncoding,
    seconds: f64,
    schedule: Schedule,
    events: &'static [(f64, BridgeStep)],
}

const fn configure(boost_enabled: bool, trim_enabled: bool, revision: u64) -> BridgeStep {
    BridgeStep::Configure(EffectsSettings {
        boost_enabled,
        trim_enabled,
        revision,
    })
}

const fn effects(boost: bool, trim: bool) -> BridgeEngine {
    BridgeEngine::Effects { boost, trim }
}

const SPECS: &[Spec] = &[
    Spec {
        name: "effects-mono-8000-both",
        engine: effects(true, true),
        sample_rate: 8_000,
        channels: 1,
        encoding: BridgeEncoding::Float,
        seconds: 6.0,
        schedule: Schedule::Random(1),
        events: &[],
    },
    Spec {
        name: "effects-stereo-8000-boost",
        engine: effects(true, false),
        sample_rate: 8_000,
        channels: 2,
        encoding: BridgeEncoding::Float,
        seconds: 5.0,
        schedule: Schedule::Random(2),
        events: &[],
    },
    Spec {
        name: "effects-mono-22050-trim",
        engine: effects(false, true),
        sample_rate: 22_050,
        channels: 1,
        encoding: BridgeEncoding::Float,
        seconds: 4.0,
        schedule: Schedule::Random(3),
        events: &[],
    },
    Spec {
        name: "effects-stereo-44100-off",
        engine: effects(false, false),
        sample_rate: 44_100,
        channels: 2,
        encoding: BridgeEncoding::Float,
        seconds: 0.5,
        schedule: Schedule::Random(4),
        events: &[],
    },
    Spec {
        name: "effects-mono-48000-both-block",
        engine: effects(true, true),
        sample_rate: 48_000,
        channels: 1,
        encoding: BridgeEncoding::Float,
        seconds: 2.0,
        schedule: Schedule::Fixed(MAX_BLOCK_FRAMES, MAX_BLOCK_FRAMES),
        events: &[],
    },
    Spec {
        name: "effects-stereo-8000-revision-seek",
        engine: effects(false, true),
        sample_rate: 8_000,
        channels: 2,
        encoding: BridgeEncoding::Float,
        seconds: 6.5,
        schedule: Schedule::Random(6),
        events: &[
            (2.6, configure(true, true, 1)),
            (3.9, configure(false, false, 2)),
            (4.5, BridgeStep::Reset(1_234_567)),
            (5.2, configure(false, true, 3)),
        ],
    },
    Spec {
        name: "effects-mono-8000-single-frame",
        engine: effects(true, true),
        sample_rate: 8_000,
        channels: 1,
        encoding: BridgeEncoding::Float,
        seconds: 0.25,
        schedule: Schedule::Fixed(1, 1),
        events: &[],
    },
    Spec {
        name: "effects-stereo-48000-seek-start",
        engine: effects(true, true),
        sample_rate: 48_000,
        channels: 2,
        encoding: BridgeEncoding::Float,
        seconds: 0.5,
        schedule: Schedule::Random(8),
        events: &[(0.0, BridgeStep::Reset(96_000))],
    },
    Spec {
        name: "effects-mono-44100-both-pcm16",
        engine: effects(true, true),
        sample_rate: 44_100,
        channels: 1,
        encoding: BridgeEncoding::Pcm16,
        seconds: 3.0,
        schedule: Schedule::Random(9),
        events: &[],
    },
    Spec {
        name: "effects-stereo-8000-trim-pcm16",
        engine: effects(false, true),
        sample_rate: 8_000,
        channels: 2,
        encoding: BridgeEncoding::Pcm16,
        seconds: 6.0,
        schedule: Schedule::Random(10),
        events: &[],
    },
    Spec {
        name: "limiter-mono-48000",
        engine: BridgeEngine::Limiter,
        sample_rate: 48_000,
        channels: 1,
        encoding: BridgeEncoding::Float,
        seconds: 0.5,
        schedule: Schedule::Random(11),
        events: &[],
    },
    Spec {
        name: "limiter-stereo-44100-reset",
        engine: BridgeEngine::Limiter,
        sample_rate: 44_100,
        channels: 2,
        encoding: BridgeEncoding::Float,
        seconds: 1.0,
        schedule: Schedule::Random(12),
        events: &[(0.4, BridgeStep::Reset(0))],
    },
    Spec {
        name: "limiter-stereo-8000-single-frame",
        engine: BridgeEngine::Limiter,
        sample_rate: 8_000,
        channels: 2,
        encoding: BridgeEncoding::Float,
        seconds: 0.1,
        schedule: Schedule::Fixed(1, 1),
        events: &[],
    },
    Spec {
        name: "limiter-mono-22050-block",
        engine: BridgeEngine::Limiter,
        sample_rate: 22_050,
        channels: 1,
        encoding: BridgeEncoding::Float,
        seconds: 1.0,
        schedule: Schedule::Fixed(MAX_BLOCK_FRAMES, MAX_BLOCK_FRAMES),
        events: &[],
    },
];

pub fn bridge_vectors(names: &[String]) -> Result<Vec<BridgeCase>, AudioError> {
    if let Some(name) = names
        .iter()
        .find(|name| !SPECS.iter().any(|spec| spec.name == name.as_str()))
    {
        return Err(AudioError::InvalidProcessor(format!(
            "unknown bridge vector case: {name}"
        )));
    }
    SPECS
        .iter()
        .filter(|spec| names.is_empty() || names.iter().any(|name| name == spec.name))
        .map(run)
        .collect()
}

pub fn write_bridge_vectors(
    directory: impl AsRef<Path>,
    names: &[String],
) -> Result<Vec<PathBuf>, AudioError> {
    let directory = directory.as_ref();
    let cases = bridge_vectors(names)?;
    fs::create_dir_all(directory)
        .map_err(|error| AudioError::Io(format!("{}: {error}", directory.display())))?;
    let mut paths = Vec::with_capacity(cases.len() * 2 + 1);
    for case in &cases {
        let input = match case.encoding {
            BridgeEncoding::Float => float_bytes(&case.input),
            BridgeEncoding::Pcm16 => case
                .input
                .iter()
                .flat_map(|sample| ((sample * 32_768.0) as i16).to_le_bytes())
                .collect(),
        };
        paths.push(write(directory, &input_name(case), &input)?);
        paths.push(write(
            directory,
            &format!("{}.output.f32", case.name),
            &float_bytes(&case.output),
        )?);
    }
    paths.push(write(
        directory,
        "manifest.json",
        manifest(&cases).as_bytes(),
    )?);
    Ok(paths)
}

fn input_name(case: &BridgeCase) -> String {
    match case.encoding {
        BridgeEncoding::Float => format!("{}.input.f32", case.name),
        BridgeEncoding::Pcm16 => format!("{}.input.s16", case.name),
    }
}

fn float_bytes(samples: &[f32]) -> Vec<u8> {
    samples
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect()
}

fn write(directory: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, AudioError> {
    let path = directory.join(name);
    fs::write(&path, bytes)
        .map_err(|error| AudioError::Io(format!("{}: {error}", path.display())))?;
    Ok(path)
}

trait Bridge {
    fn render(
        &mut self,
        input: Option<&[f32]>,
        output: &mut [f32],
        spans: &mut [SourceSpan],
    ) -> Result<(EffectsReport, bool), AudioError>;
    fn has_ready_output(&self) -> bool;
    fn apply(&mut self, step: BridgeStep) -> Result<(), AudioError>;
}

impl Bridge for SpeechProcessor {
    fn render(
        &mut self,
        input: Option<&[f32]>,
        output: &mut [f32],
        spans: &mut [SourceSpan],
    ) -> Result<(EffectsReport, bool), AudioError> {
        match input {
            Some(input) => Ok((self.process(input, output, spans)?, false)),
            None => Ok((self.finish(output, spans)?, self.is_finished())),
        }
    }

    fn has_ready_output(&self) -> bool {
        SpeechProcessor::has_ready_output(self)
    }

    fn apply(&mut self, step: BridgeStep) -> Result<(), AudioError> {
        match step {
            BridgeStep::Configure(settings) => self.configure(settings),
            BridgeStep::Reset(origin) => {
                self.reset(origin);
                Ok(())
            }
            _ => unreachable!(),
        }
    }
}

impl Bridge for PcmProcessor {
    fn render(
        &mut self,
        input: Option<&[f32]>,
        output: &mut [f32],
        _: &mut [SourceSpan],
    ) -> Result<(EffectsReport, bool), AudioError> {
        let report = match input {
            Some(input) => StreamingProcessor::process(self, input, output)?,
            None => StreamingProcessor::finish(self, output)?,
        };
        Ok((
            EffectsReport {
                input_frames: report.input_frames,
                output_frames: report.output_frames,
                span_count: 0,
            },
            input.is_none() && self.is_finished(),
        ))
    }

    fn has_ready_output(&self) -> bool {
        false
    }

    fn apply(&mut self, step: BridgeStep) -> Result<(), AudioError> {
        match step {
            BridgeStep::Reset(_) => {
                StreamingProcessor::reset(self);
                Ok(())
            }
            _ => unreachable!(),
        }
    }
}

struct Random(u32);

impl Random {
    fn next(&mut self) -> usize {
        self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        (self.0 >> 8) as usize
    }
}

impl Schedule {
    fn frames(self, random: &mut Random) -> usize {
        match self {
            Self::Random(_) => match random.next() % 8 {
                0 => 1,
                1 => MAX_BLOCK_FRAMES,
                _ => 1 + random.next() % 997,
            },
            Self::Fixed(frames, _) => frames,
        }
    }

    fn capacity(self, random: &mut Random) -> usize {
        match self {
            Self::Random(_) => match random.next() % 8 {
                0 => 0,
                1 => 1,
                2 => MAX_BLOCK_FRAMES,
                _ => 1 + random.next() % 600,
            },
            Self::Fixed(_, capacity) => capacity,
        }
    }

    fn span_capacity(self, random: &mut Random) -> usize {
        match self {
            Self::Random(_) => match random.next() % 4 {
                0 => 1,
                1 => 2,
                _ => MAX_BLOCK_FRAMES,
            },
            Self::Fixed(..) => MAX_BLOCK_FRAMES,
        }
    }
}

struct Recorder {
    channels: usize,
    schedule: Schedule,
    random: Random,
    buffer: Vec<f32>,
    span_buffer: Vec<SourceSpan>,
    output: Vec<f32>,
    steps: Vec<BridgeStep>,
    spans: Vec<Vec<BridgeSpan>>,
    segment_frames: u64,
}

impl Recorder {
    fn call(
        &mut self,
        bridge: &mut dyn Bridge,
        input: Option<&[f32]>,
    ) -> Result<(EffectsReport, bool), AudioError> {
        let capacity = match input {
            Some(input) if !input.is_empty() => self.schedule.capacity(&mut self.random),
            _ => self.schedule.capacity(&mut self.random).max(1),
        };
        let span_capacity = self.schedule.span_capacity(&mut self.random);
        let (report, finished) = bridge.render(
            input,
            &mut self.buffer[..capacity * self.channels],
            &mut self.span_buffer[..span_capacity],
        )?;
        self.steps.push(match input {
            Some(input) => BridgeStep::Process {
                frames: input.len() / self.channels,
                capacity,
                span_capacity,
                report,
            },
            None => BridgeStep::Finish {
                capacity,
                span_capacity,
                report,
                finished,
            },
        });
        self.output
            .extend_from_slice(&self.buffer[..report.output_frames * self.channels]);
        let segment = self.spans.last_mut().unwrap();
        for span in &self.span_buffer[..report.span_count] {
            let next = BridgeSpan {
                source_start_frame: span.source_start_frame,
                output_start_frame: self.segment_frames + u64::from(span.output_start_frame),
                frame_count: u64::from(span.frame_count),
            };
            match segment.last_mut() {
                Some(last)
                    if last.source_start_frame + last.frame_count == next.source_start_frame
                        && last.output_start_frame + last.frame_count
                            == next.output_start_frame =>
                {
                    last.frame_count += next.frame_count
                }
                _ => segment.push(next),
            }
        }
        self.segment_frames += report.output_frames as u64;
        Ok((report, finished))
    }

    fn feed(
        &mut self,
        bridge: &mut dyn Bridge,
        input: &[f32],
        position: &mut usize,
        target: usize,
    ) -> Result<(), AudioError> {
        let mut chunk = 0;
        while *position < target {
            if chunk == 0 {
                chunk = self
                    .schedule
                    .frames(&mut self.random)
                    .min(target - *position);
            }
            let offered = &input[*position * self.channels..(*position + chunk) * self.channels];
            let (report, _) = self.call(bridge, Some(offered))?;
            *position += report.input_frames;
            chunk -= report.input_frames;
        }
        Ok(())
    }
}

fn run(spec: &Spec) -> Result<BridgeCase, AudioError> {
    let format = AudioFormat::new(spec.sample_rate, spec.channels)?;
    let frames_at = |seconds: f64| (seconds * f64::from(spec.sample_rate)).round() as usize;
    let input = signal(format, frames_at(spec.seconds), spec.engine, spec.encoding);
    let mut bridge: Box<dyn Bridge> = match spec.engine {
        BridgeEngine::Effects { boost, trim } => Box::new(SpeechProcessor::new(
            format,
            EffectsSettings {
                boost_enabled: boost,
                trim_enabled: trim,
                revision: 0,
            },
        )?),
        BridgeEngine::Limiter => {
            let defaults = PodcstAudioConfig::default();
            Box::new(PcmProcessor::new(
                format,
                f64::from(defaults.gain_db),
                Some(&LimiterConfig {
                    lookahead_ms: f64::from(defaults.lookahead_ms),
                    ceiling_dbfs: f64::from(defaults.ceiling_dbfs),
                    release_ms: f64::from(defaults.release_ms),
                }),
            )?)
        }
    };
    let seed = match spec.schedule {
        Schedule::Random(seed) => seed,
        Schedule::Fixed(..) => 0,
    };
    let mut recorder = Recorder {
        channels: spec.channels,
        schedule: spec.schedule,
        random: Random(seed),
        buffer: vec![0.0; MAX_BLOCK_FRAMES * spec.channels],
        span_buffer: vec![SourceSpan::default(); MAX_BLOCK_FRAMES],
        output: Vec::with_capacity(input.len()),
        steps: Vec::new(),
        spans: vec![Vec::new()],
        segment_frames: 0,
    };
    let mut position = 0;
    for &(seconds, step) in spec.events {
        recorder.feed(bridge.as_mut(), &input, &mut position, frames_at(seconds))?;
        if let BridgeStep::Reset(_) = step {
            while bridge.has_ready_output() {
                recorder.call(bridge.as_mut(), Some(&[]))?;
            }
            recorder.spans.push(Vec::new());
            recorder.segment_frames = 0;
        }
        bridge.apply(step)?;
        recorder.steps.push(step);
    }
    recorder.feed(
        bridge.as_mut(),
        &input,
        &mut position,
        frames_at(spec.seconds),
    )?;
    while !recorder.call(bridge.as_mut(), None)?.1 {}
    Ok(BridgeCase {
        name: spec.name,
        engine: spec.engine,
        format,
        encoding: spec.encoding,
        input,
        output: recorder.output,
        steps: recorder.steps,
        spans: match spec.engine {
            BridgeEngine::Effects { .. } => recorder.spans,
            BridgeEngine::Limiter => Vec::new(),
        },
    })
}

fn signal(
    format: AudioFormat,
    frames: usize,
    engine: BridgeEngine,
    encoding: BridgeEncoding,
) -> Vec<f32> {
    let tau = std::f32::consts::TAU;
    let rate = format.sample_rate as f32;
    let mut samples = Vec::with_capacity(frames * format.channels);
    for frame in 0..frames {
        for channel in 0..format.channels {
            let time = frame as f32 / rate + channel as f32 * 0.0007;
            let value = match engine {
                BridgeEngine::Effects { .. } => {
                    let cycle = time % 8.0;
                    if (2.3..3.4).contains(&cycle)
                        || (4.2..5.0).contains(&cycle)
                        || (6.6..7.2).contains(&cycle)
                    {
                        0.00001 * (tau * 97.0 * time).sin()
                    } else {
                        let burst = 0.35 + 0.65 * ((time * 5.0) as usize % 2) as f32;
                        let envelope = (std::f32::consts::PI * time * 4.0).sin().abs();
                        0.12 * burst
                            * (0.25 + 0.75 * envelope)
                            * ((tau * 180.0 * time).sin() + 0.35 * (tau * 510.0 * time).sin())
                    }
                }
                BridgeEngine::Limiter => {
                    let spike = if frame % 997 < 3 { 0.9 } else { 0.0 };
                    1.4 * (tau * 61.0 * time).sin() + 0.5 * (tau * 1_870.0 * time).sin() + spike
                }
            };
            samples.push(value * (1.0 - 0.3 * channel as f32));
        }
    }
    if encoding == BridgeEncoding::Pcm16 {
        for sample in &mut samples {
            *sample = f32::from((*sample * 32_768.0).round().clamp(-32_768.0, 32_767.0) as i16)
                / 32_768.0;
        }
    }
    samples
}

fn manifest(cases: &[BridgeCase]) -> String {
    let cases = cases.iter().map(case_json).collect::<Vec<_>>().join(",\n");
    format!("{{\"cases\":[\n{cases}\n]}}\n")
}

fn case_json(case: &BridgeCase) -> String {
    let effects = matches!(case.engine, BridgeEngine::Effects { .. });
    let engine = match case.engine {
        BridgeEngine::Effects { boost, trim } => {
            format!("\"engine\":\"effects\",\"boost\":{boost},\"trim\":{trim}")
        }
        BridgeEngine::Limiter => "\"engine\":\"limiter\"".to_owned(),
    };
    let encoding = match case.encoding {
        BridgeEncoding::Float => "float",
        BridgeEncoding::Pcm16 => "pcm16",
    };
    let steps = case
        .steps
        .iter()
        .map(|step| step_json(*step, effects))
        .collect::<Vec<_>>()
        .join(",\n");
    let spans = if effects {
        let segments = case
            .spans
            .iter()
            .map(|segment| {
                let spans = segment
                    .iter()
                    .map(|span| {
                        format!(
                            "[{},{},{}]",
                            span.source_start_frame, span.output_start_frame, span.frame_count
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(",");
                format!("[{spans}]")
            })
            .collect::<Vec<_>>()
            .join(",");
        format!(",\"spans\":[{segments}]")
    } else {
        String::new()
    };
    format!(
        "{{\"name\":\"{}\",{engine},\"sample_rate\":{},\"channels\":{},\"encoding\":\"{encoding}\"{spans},\"steps\":[\n{steps}\n]}}",
        case.name, case.format.sample_rate, case.format.channels
    )
}

fn step_json(step: BridgeStep, effects: bool) -> String {
    match step {
        BridgeStep::Process {
            frames,
            capacity,
            span_capacity,
            report,
        } if effects => format!(
            "{{\"op\":\"process\",\"frames\":{frames},\"capacity\":{capacity},\"span_capacity\":{span_capacity},\"consumed\":{},\"emitted\":{},\"span_count\":{}}}",
            report.input_frames, report.output_frames, report.span_count
        ),
        BridgeStep::Process {
            frames,
            capacity,
            report,
            ..
        } => format!(
            "{{\"op\":\"process\",\"frames\":{frames},\"capacity\":{capacity},\"consumed\":{},\"emitted\":{}}}",
            report.input_frames, report.output_frames
        ),
        BridgeStep::Finish {
            capacity,
            span_capacity,
            report,
            finished,
        } if effects => format!(
            "{{\"op\":\"finish\",\"capacity\":{capacity},\"span_capacity\":{span_capacity},\"emitted\":{},\"span_count\":{},\"finished\":{finished}}}",
            report.output_frames, report.span_count
        ),
        BridgeStep::Finish {
            capacity,
            report,
            finished,
            ..
        } => format!(
            "{{\"op\":\"finish\",\"capacity\":{capacity},\"emitted\":{},\"finished\":{finished}}}",
            report.output_frames
        ),
        BridgeStep::Configure(settings) => format!(
            "{{\"op\":\"configure\",\"boost\":{},\"trim\":{},\"revision\":{}}}",
            settings.boost_enabled, settings.trim_enabled, settings.revision
        ),
        BridgeStep::Reset(origin) if effects => {
            format!("{{\"op\":\"reset\",\"origin\":{origin}}}")
        }
        BridgeStep::Reset(_) => "{\"op\":\"reset\"}".to_owned(),
    }
}
