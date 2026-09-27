use std::collections::VecDeque;

use crate::analysis::{
    AdaptiveSilenceConfig, SilenceConfig, SilenceSegment, detect_adaptive_silence, detect_silence,
    integrated_lufs,
};
use crate::audio::{AudioError, PcmAudio};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AudioFormat {
    pub sample_rate: u32,
    pub channels: usize,
}

impl AudioFormat {
    pub fn new(sample_rate: u32, channels: usize) -> Result<Self, AudioError> {
        if sample_rate == 0 {
            return Err(AudioError::InvalidSampleRate);
        }
        if channels == 0 {
            return Err(AudioError::InvalidChannelCount);
        }
        Ok(Self {
            sample_rate,
            channels,
        })
    }

    pub(crate) fn validate_samples(&self, samples: &[f32]) -> Result<usize, AudioError> {
        Self::new(self.sample_rate, self.channels)?;
        if samples.len() % self.channels != 0 {
            return Err(AudioError::MisalignedSamples {
                samples: samples.len(),
                channels: self.channels,
            });
        }
        if let Some(index) = samples.iter().position(|sample| !sample.is_finite()) {
            return Err(AudioError::NonFiniteSample { index });
        }
        Ok(samples.len() / self.channels)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ProcessReport {
    pub input_frames: usize,
    pub output_frames: usize,
}

pub trait StreamingProcessor {
    fn format(&self) -> AudioFormat;

    fn reset(&mut self);

    fn start(&mut self) {
        self.reset();
    }

    fn seek(&mut self) {
        self.reset();
    }

    fn latency_frames(&self) -> usize;

    fn process(
        &mut self,
        input: &[f32],
        output: &mut Vec<f32>,
    ) -> Result<ProcessReport, AudioError>;

    fn finish(&mut self, output: &mut Vec<f32>) -> Result<ProcessReport, AudioError>;
}

pub fn process_streaming<P: StreamingProcessor>(
    audio: &PcmAudio,
    processor: &mut P,
    chunk_frames: usize,
) -> Result<PcmAudio, AudioError> {
    if chunk_frames == 0 {
        return Err(AudioError::InvalidProcessor(
            "chunk size must be greater than zero".to_owned(),
        ));
    }
    let format = processor.format();
    if format.sample_rate != audio.sample_rate() || format.channels != audio.channels() {
        return Err(AudioError::InvalidProcessor(
            "processor format does not match input audio".to_owned(),
        ));
    }

    let chunk_samples = chunk_frames * format.channels;
    let mut samples = Vec::with_capacity(audio.samples().len());
    for input in audio.samples().chunks(chunk_samples) {
        processor.process(input, &mut samples)?;
    }
    processor.finish(&mut samples)?;
    PcmAudio::new(format.sample_rate, format.channels, samples)
}

pub(crate) fn ensure_active(finished: bool) -> Result<(), AudioError> {
    if finished {
        return Err(AudioError::InvalidProcessor(
            "stream is finished; start, reset, or seek before processing".to_owned(),
        ));
    }
    Ok(())
}

pub struct GainProcessor {
    format: AudioFormat,
    gain: f32,
    finished: bool,
}

impl GainProcessor {
    pub fn new(format: AudioFormat, gain_db: f64) -> Result<Self, AudioError> {
        AudioFormat::new(format.sample_rate, format.channels)?;
        if !gain_db.is_finite() || !10.0f32.powf((gain_db / 20.0) as f32).is_finite() {
            return Err(AudioError::InvalidProcessor(
                "gain must be finite".to_owned(),
            ));
        }
        Ok(Self {
            format,
            gain: 10.0f32.powf((gain_db / 20.0) as f32),
            finished: false,
        })
    }

    pub fn gain_db(&self) -> f64 {
        20.0 * f64::from(self.gain).log10()
    }
}

impl StreamingProcessor for GainProcessor {
    fn format(&self) -> AudioFormat {
        self.format
    }

    fn reset(&mut self) {
        self.finished = false;
    }

    fn latency_frames(&self) -> usize {
        0
    }

    fn finish(&mut self, _output: &mut Vec<f32>) -> Result<ProcessReport, AudioError> {
        self.finished = true;
        Ok(ProcessReport::default())
    }

    fn process(
        &mut self,
        input: &[f32],
        output: &mut Vec<f32>,
    ) -> Result<ProcessReport, AudioError> {
        ensure_active(self.finished)?;
        let input_frames = self.format.validate_samples(input)?;
        output.extend(input.iter().map(|sample| *sample * self.gain));
        Ok(ProcessReport {
            input_frames,
            output_frames: input_frames,
        })
    }
}

#[derive(Clone, Debug)]
pub struct BoostConfig {
    pub target_lufs: f64,
    pub max_gain_db: f64,
    pub max_attenuation_db: f64,
}

impl Default for BoostConfig {
    fn default() -> Self {
        Self {
            target_lufs: -14.0,
            max_gain_db: 12.0,
            max_attenuation_db: 12.0,
        }
    }
}

impl BoostConfig {
    pub fn gain_db(&self, source_lufs: f64) -> f64 {
        if !source_lufs.is_finite() {
            return 0.0;
        }
        (self.target_lufs - source_lufs).clamp(-self.max_attenuation_db, self.max_gain_db)
    }
}

#[derive(Clone, Debug)]
pub struct LimiterConfig {
    pub lookahead_ms: f64,
    pub ceiling_dbfs: f64,
    pub release_ms: f64,
}

impl Default for LimiterConfig {
    fn default() -> Self {
        Self {
            lookahead_ms: 5.0,
            ceiling_dbfs: -1.0,
            release_ms: 50.0,
        }
    }
}

const TRUE_PEAK_TAPS: usize = 32;
const TRUE_PEAK_GAIN_MARGIN: f32 = 1.05;
const TRUE_PEAK_RADIUS: isize = 16;
const TRUE_PEAK_PHASES: usize = 4;

struct PolyphaseTruePeak {
    coefficients: [[f64; TRUE_PEAK_TAPS]; TRUE_PEAK_PHASES],
}

impl PolyphaseTruePeak {
    fn new() -> Self {
        let mut coefficients = [[0.0; TRUE_PEAK_TAPS]; TRUE_PEAK_PHASES];
        for (phase, phase_coefficients) in coefficients.iter_mut().enumerate() {
            let fraction = phase as f64 / TRUE_PEAK_PHASES as f64;
            let mut sum = 0.0;
            for (tap, coefficient) in phase_coefficients.iter_mut().enumerate() {
                let offset = tap as isize - TRUE_PEAK_RADIUS + 1;
                let distance = fraction - offset as f64;
                let sinc = if distance.abs() < f64::EPSILON {
                    1.0
                } else {
                    let argument = std::f64::consts::PI * distance;
                    argument.sin() / argument
                };
                let window_position = tap as f64 / (TRUE_PEAK_TAPS - 1) as f64;
                let window = 0.42 - 0.5 * (2.0 * std::f64::consts::PI * window_position).cos()
                    + 0.08 * (4.0 * std::f64::consts::PI * window_position).cos();
                *coefficient = sinc * window;
                sum += *coefficient;
            }
            for coefficient in phase_coefficients {
                *coefficient /= sum;
            }
        }
        Self { coefficients }
    }

    fn interval_peak(
        &self,
        target_frame: usize,
        format: AudioFormat,
        history: &VecDeque<f32>,
        history_start_frame: usize,
        input_frames: usize,
    ) -> f32 {
        let mut peak = self
            .sample_at(
                target_frame as isize,
                0,
                format.channels,
                history,
                history_start_frame,
                input_frames,
            )
            .abs();
        for channel in 0..format.channels {
            peak = peak.max(
                self.sample_at(
                    target_frame as isize,
                    channel,
                    format.channels,
                    history,
                    history_start_frame,
                    input_frames,
                )
                .abs(),
            );
            for phase_coefficients in &self.coefficients[1..] {
                let mut value = 0.0;
                for (tap, coefficient) in phase_coefficients.iter().enumerate() {
                    let frame = target_frame as isize + tap as isize - TRUE_PEAK_RADIUS + 1;
                    value += *coefficient
                        * f64::from(self.sample_at(
                            frame,
                            channel,
                            format.channels,
                            history,
                            history_start_frame,
                            input_frames,
                        ));
                }
                peak = peak.max(value.abs() as f32);
            }
        }
        peak
    }

    fn sample_at(
        &self,
        frame: isize,
        channel: usize,
        channels: usize,
        history: &VecDeque<f32>,
        history_start_frame: usize,
        input_frames: usize,
    ) -> f32 {
        if frame < 0 || frame as usize >= input_frames || (frame as usize) < history_start_frame {
            return 0.0;
        }
        history
            .get((frame as usize - history_start_frame) * channels + channel)
            .copied()
            .unwrap_or(0.0)
    }
}

pub struct TruePeakLimiter {
    format: AudioFormat,
    latency_frames: usize,
    ceiling: f32,
    release_step: f32,
    current_gain: f32,
    queue: VecDeque<f32>,
    peak_queue: VecDeque<(usize, f32)>,
    history: VecDeque<f32>,
    history_start_frame: usize,
    next_input_frame: usize,
    next_output_frame: usize,
    true_peak: PolyphaseTruePeak,
    finished: bool,
}

impl TruePeakLimiter {
    pub fn new(format: AudioFormat, config: &LimiterConfig) -> Result<Self, AudioError> {
        AudioFormat::new(format.sample_rate, format.channels)?;
        if !config.lookahead_ms.is_finite()
            || !config.ceiling_dbfs.is_finite()
            || !config.release_ms.is_finite()
            || config.lookahead_ms < 0.0
            || config.release_ms < 0.0
            || config.ceiling_dbfs > 0.0
        {
            return Err(AudioError::InvalidProcessor(
                "invalid limiter configuration".to_owned(),
            ));
        }
        let lookahead_frames =
            (config.lookahead_ms * f64::from(format.sample_rate) / 1000.0).round() as usize;
        let release_frames =
            (config.release_ms * f64::from(format.sample_rate) / 1000.0).round() as usize;
        let release_step = if release_frames == 0 {
            1.0
        } else {
            1.0 / release_frames as f32
        };
        let capacity_error =
            || AudioError::InvalidProcessor("limiter buffer capacity is too large".to_owned());
        let latency_frames = lookahead_frames
            .max(1)
            .checked_add(TRUE_PEAK_RADIUS as usize - 1)
            .ok_or_else(capacity_error)?;
        let peak_capacity = latency_frames.checked_add(1).ok_or_else(capacity_error)?;
        let queue_capacity = peak_capacity
            .checked_mul(format.channels)
            .ok_or_else(capacity_error)?;
        let history_capacity = (TRUE_PEAK_TAPS + 1)
            .checked_mul(format.channels)
            .ok_or_else(capacity_error)?;
        if queue_capacity > isize::MAX as usize / size_of::<f32>()
            || history_capacity > isize::MAX as usize / size_of::<f32>()
            || peak_capacity > isize::MAX as usize / size_of::<(usize, f32)>()
        {
            return Err(capacity_error());
        }
        Ok(Self {
            format,
            latency_frames,
            ceiling: 10.0f32.powf((config.ceiling_dbfs / 20.0) as f32),
            release_step,
            current_gain: 1.0,
            queue: VecDeque::with_capacity(queue_capacity),
            peak_queue: VecDeque::with_capacity(peak_capacity),
            history: VecDeque::with_capacity(history_capacity),
            history_start_frame: 0,
            next_input_frame: 0,
            next_output_frame: 0,
            true_peak: PolyphaseTruePeak::new(),
            finished: false,
        })
    }

    fn ingest(&mut self, frame: Option<&[f32]>) {
        match frame {
            Some(frame) => self.history.extend(frame),
            None => self
                .history
                .extend(std::iter::repeat_n(0.0, self.format.channels)),
        }
        if self.history.len() > TRUE_PEAK_TAPS * self.format.channels {
            self.history.drain(..self.format.channels);
            self.history_start_frame += 1;
        }
        let input_frame = self.next_input_frame;
        self.next_input_frame += 1;
        if input_frame >= TRUE_PEAK_RADIUS as usize {
            let target_frame = input_frame - TRUE_PEAK_RADIUS as usize;
            let peak = self.true_peak.interval_peak(
                target_frame,
                self.format,
                &self.history,
                self.history_start_frame,
                self.next_input_frame,
            );
            while self
                .peak_queue
                .back()
                .is_some_and(|(_, queued_peak)| *queued_peak <= peak)
            {
                self.peak_queue.pop_back();
            }
            self.peak_queue.push_back((target_frame, peak));
        }
        if let Some(frame) = frame {
            self.queue.extend(frame);
        }
    }

    fn emit_one(&mut self, output: &mut Vec<f32>) {
        while self
            .peak_queue
            .front()
            .is_some_and(|(frame_index, _)| *frame_index < self.next_output_frame)
        {
            self.peak_queue.pop_front();
        }
        let peak = self
            .peak_queue
            .front()
            .map(|(_, peak)| *peak)
            .unwrap_or_else(|| {
                self.queue
                    .iter()
                    .take(self.format.channels)
                    .map(|sample| sample.abs())
                    .fold(0.0, f32::max)
            });
        let target_gain = if peak <= 0.0 {
            1.0
        } else {
            (self.ceiling / (peak * TRUE_PEAK_GAIN_MARGIN)).min(1.0)
        };
        if target_gain < self.current_gain {
            self.current_gain = target_gain;
        } else {
            self.current_gain += (target_gain - self.current_gain) * self.release_step.min(1.0);
        }
        output.extend(
            self.queue
                .drain(..self.format.channels)
                .map(|sample| sample * self.current_gain),
        );
        self.next_output_frame += 1;
    }
}

impl StreamingProcessor for TruePeakLimiter {
    fn format(&self) -> AudioFormat {
        self.format
    }

    fn reset(&mut self) {
        self.current_gain = 1.0;
        self.queue.clear();
        self.peak_queue.clear();
        self.history.clear();
        self.history_start_frame = 0;
        self.next_input_frame = 0;
        self.next_output_frame = 0;
        self.finished = false;
    }

    fn latency_frames(&self) -> usize {
        self.latency_frames
    }

    fn process(
        &mut self,
        input: &[f32],
        output: &mut Vec<f32>,
    ) -> Result<ProcessReport, AudioError> {
        ensure_active(self.finished)?;
        let input_frames = self.format.validate_samples(input)?;
        let output_start = output.len() / self.format.channels;
        for frame in input.chunks_exact(self.format.channels) {
            self.ingest(Some(frame));
            if self.queue.len() > self.latency_frames * self.format.channels {
                self.emit_one(output);
            }
        }
        Ok(ProcessReport {
            input_frames,
            output_frames: output.len() / self.format.channels - output_start,
        })
    }

    fn finish(&mut self, output: &mut Vec<f32>) -> Result<ProcessReport, AudioError> {
        if self.finished {
            return Ok(ProcessReport::default());
        }
        self.finished = true;
        let output_start = output.len() / self.format.channels;
        for _ in 0..TRUE_PEAK_RADIUS {
            self.ingest(None);
        }
        while !self.queue.is_empty() {
            self.emit_one(output);
        }
        Ok(ProcessReport {
            input_frames: 0,
            output_frames: output.len() / self.format.channels - output_start,
        })
    }
}

pub type LookaheadLimiter = TruePeakLimiter;

#[derive(Clone, Copy, Debug)]
pub struct TrimEditConfig {
    pub retain_ms: u32,
    pub max_trim_ms: u32,
    pub fade_ms: u32,
}

impl Default for TrimEditConfig {
    fn default() -> Self {
        Self {
            retain_ms: 250,
            max_trim_ms: 1_500,
            fade_ms: 8,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct TrimConfig {
    pub silence: SilenceConfig,
}

#[derive(Clone, Debug)]
pub struct ProcessingConfig {
    pub boost: Option<BoostConfig>,
    pub limiter: Option<LimiterConfig>,
    pub trim: Option<TrimConfig>,
    pub adaptive_trim: Option<AdaptiveSilenceConfig>,
    pub trim_edit: TrimEditConfig,
    pub chunk_frames: usize,
}

impl Default for ProcessingConfig {
    fn default() -> Self {
        Self {
            boost: None,
            limiter: None,
            trim: None,
            adaptive_trim: None,
            trim_edit: TrimEditConfig::default(),
            chunk_frames: 1024,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TimelineSegment {
    pub source_start_frame: usize,
    pub source_end_frame: usize,
    pub output_start_frame: usize,
    pub output_end_frame: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TimelineMap {
    sample_rate: u32,
    source_frames: usize,
    output_frames: usize,
    segments: Vec<TimelineSegment>,
}

impl TimelineMap {
    fn identity(sample_rate: u32, frames: usize) -> Self {
        let segments = if frames == 0 {
            Vec::new()
        } else {
            vec![TimelineSegment {
                source_start_frame: 0,
                source_end_frame: frames,
                output_start_frame: 0,
                output_end_frame: frames,
            }]
        };
        Self {
            sample_rate,
            source_frames: frames,
            output_frames: frames,
            segments,
        }
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn source_frames(&self) -> usize {
        self.source_frames
    }

    pub fn output_frames(&self) -> usize {
        self.output_frames
    }

    pub fn segments(&self) -> &[TimelineSegment] {
        &self.segments
    }

    pub fn source_frame_for_output(&self, output_frame: usize) -> Option<f64> {
        let segment = self.segments.iter().find(|segment| {
            segment.output_start_frame <= output_frame && output_frame < segment.output_end_frame
        })?;
        let offset = output_frame - segment.output_start_frame;
        let output_length = segment.output_end_frame - segment.output_start_frame;
        let source_length = segment.source_end_frame - segment.source_start_frame;
        Some(
            segment.source_start_frame as f64
                + offset as f64 * source_length as f64 / output_length as f64,
        )
    }

    pub fn source_time_for_output(&self, output_frame: usize) -> Option<f64> {
        Some(self.source_frame_for_output(output_frame)? / f64::from(self.sample_rate))
    }

    pub fn output_frame_for_source(&self, source_frame: usize) -> usize {
        if source_frame >= self.source_frames {
            return self.output_frames;
        }
        for segment in &self.segments {
            if source_frame < segment.source_start_frame {
                return segment.output_start_frame;
            }
            if source_frame < segment.source_end_frame {
                return segment.output_start_frame + source_frame - segment.source_start_frame;
            }
        }
        self.output_frames
    }
}

#[derive(Clone, Debug)]
pub struct ProcessedAudio {
    audio: PcmAudio,
    timeline: TimelineMap,
}

impl ProcessedAudio {
    pub fn audio(&self) -> &PcmAudio {
        &self.audio
    }

    pub fn timeline(&self) -> &TimelineMap {
        &self.timeline
    }

    pub fn into_parts(self) -> (PcmAudio, TimelineMap) {
        (self.audio, self.timeline)
    }
}

pub fn process_audio(
    audio: &PcmAudio,
    config: &ProcessingConfig,
) -> Result<ProcessedAudio, AudioError> {
    if config.chunk_frames == 0 {
        return Err(AudioError::InvalidProcessor(
            "chunk size must be greater than zero".to_owned(),
        ));
    }
    let format = AudioFormat::new(audio.sample_rate(), audio.channels())?;
    let silence = config
        .adaptive_trim
        .as_ref()
        .map(|adaptive| detect_adaptive_silence(audio, adaptive))
        .or_else(|| {
            config
                .trim
                .as_ref()
                .map(|trim| detect_silence(audio, &trim.silence))
        })
        .transpose()?;

    let mut processed = audio.clone();
    if let Some(boost) = &config.boost {
        let gain_db = boost.gain_db(integrated_lufs(audio));
        let mut processor = GainProcessor::new(format, gain_db)?;
        processed = process_streaming(&processed, &mut processor, config.chunk_frames)?;
    }
    let (mut processed, timeline) = if let Some(silence) = silence {
        let trimmed = trim_audio(&processed, &silence, config.trim_edit)?;
        trimmed.into_parts()
    } else {
        (
            processed,
            TimelineMap::identity(audio.sample_rate(), audio.frames()),
        )
    };
    if let Some(limiter) = &config.limiter {
        let mut processor = LookaheadLimiter::new(format, limiter)?;
        processed = process_streaming(&processed, &mut processor, config.chunk_frames)?;
    }
    Ok(ProcessedAudio {
        audio: processed,
        timeline,
    })
}

fn trim_audio(
    audio: &PcmAudio,
    silence: &[SilenceSegment],
    edit: TrimEditConfig,
) -> Result<ProcessedAudio, AudioError> {
    if edit.max_trim_ms == 0 {
        return Ok(ProcessedAudio {
            audio: audio.clone(),
            timeline: TimelineMap::identity(audio.sample_rate(), audio.frames()),
        });
    }
    let retain_samples =
        (u64::from(edit.retain_ms) * u64::from(audio.sample_rate()) / 1_000) as usize;
    let maximum_trim_samples =
        (u64::from(edit.max_trim_ms) * u64::from(audio.sample_rate()) / 1_000) as usize;
    let mut output = Vec::with_capacity(audio.samples().len());
    let mut segments = Vec::new();
    let mut joins = Vec::new();
    let mut source_cursor = 0;
    let mut output_cursor = 0;
    for segment in silence {
        let start = (segment.start_seconds * f64::from(audio.sample_rate()))
            .round()
            .clamp(0.0, audio.frames() as f64) as usize;
        let end = (segment.end_seconds * f64::from(audio.sample_rate()))
            .round()
            .clamp(start as f64, audio.frames() as f64) as usize;
        let silence_length = end.saturating_sub(start);
        let trim_length = silence_length
            .saturating_sub(retain_samples)
            .min(maximum_trim_samples);
        let remove_start = start + (silence_length - trim_length) / 2;
        let remove_end = remove_start + trim_length;
        if remove_start > source_cursor {
            copy_source_span(
                audio,
                source_cursor,
                remove_start,
                &mut output,
                &mut segments,
                &mut output_cursor,
            );
        }
        if remove_end > remove_start {
            joins.push(output_cursor);
        }
        source_cursor = source_cursor.max(remove_end);
    }
    if source_cursor < audio.frames() {
        copy_source_span(
            audio,
            source_cursor,
            audio.frames(),
            &mut output,
            &mut segments,
            &mut output_cursor,
        );
    }
    apply_boundary_fades(
        &mut output,
        audio.channels(),
        &joins,
        edit.fade_ms,
        audio.sample_rate(),
    );
    let output_audio = PcmAudio::new(audio.sample_rate(), audio.channels(), output)?;
    Ok(ProcessedAudio {
        audio: output_audio,
        timeline: TimelineMap {
            sample_rate: audio.sample_rate(),
            source_frames: audio.frames(),
            output_frames: output_cursor,
            segments,
        },
    })
}

fn apply_boundary_fades(
    samples: &mut [f32],
    channels: usize,
    joins: &[usize],
    fade_ms: u32,
    sample_rate: u32,
) {
    let fade_frames = (u64::from(fade_ms) * u64::from(sample_rate) / 1_000) as usize;
    if channels == 0 || fade_frames == 0 {
        return;
    }
    let total_frames = samples.len() / channels;
    for &join in joins {
        let start = join.saturating_sub(fade_frames);
        let end = (join + fade_frames).min(total_frames);
        for frame in start..end {
            let progress = if frame < join {
                (join - frame) as f32 / (join - start) as f32
            } else {
                (frame - join + 1) as f32 / (end - join) as f32
            };
            let gain = progress.clamp(0.0, 1.0).sqrt();
            let offset = frame * channels;
            for sample in &mut samples[offset..offset + channels] {
                *sample *= gain;
            }
        }
    }
}

fn copy_source_span(
    audio: &PcmAudio,
    source_start: usize,
    source_end: usize,
    output: &mut Vec<f32>,
    segments: &mut Vec<TimelineSegment>,
    output_cursor: &mut usize,
) {
    let start = source_start * audio.channels();
    let end = source_end * audio.channels();
    output.extend_from_slice(&audio.samples()[start..end]);
    let length = source_end - source_start;
    segments.push(TimelineSegment {
        source_start_frame: source_start,
        source_end_frame: source_end,
        output_start_frame: *output_cursor,
        output_end_frame: *output_cursor + length,
    });
    *output_cursor += length;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::{integrated_lufs, oversampled_peak};

    #[test]
    fn limiter_storage_is_bounded_and_finish_preserves_frame_count() {
        let format = AudioFormat::new(48_000, 2).unwrap();
        let mut limiter = TruePeakLimiter::new(format, &LimiterConfig::default()).unwrap();
        let mut output = Vec::new();
        let mut emitted = 0;
        for index in 0..1000 {
            let sample = if index % 2 == 0 { 1.5 } else { 0.01 };
            limiter.process(&[sample; 514], &mut output).unwrap();
            emitted += output.len() / 2;
            output.clear();
            assert!(limiter.queue.len() <= limiter.latency_frames * format.channels);
            assert!(limiter.peak_queue.len() <= limiter.latency_frames + 1);
            assert!(limiter.history.len() <= TRUE_PEAK_TAPS * format.channels);
        }
        limiter.finish(&mut output).unwrap();
        emitted += output.len() / 2;
        assert_eq!(emitted, 257_000);
    }

    fn audio(samples: Vec<f32>) -> PcmAudio {
        PcmAudio::new(48_000, 1, samples).unwrap()
    }

    #[test]
    fn gain_processor_is_invariant_to_chunk_boundaries() {
        let input = audio(vec![0.1, -0.2, 0.3, -0.4]);
        let format = AudioFormat::new(48_000, 1).unwrap();
        let mut one_chunk = GainProcessor::new(format, 6.0).unwrap();
        let mut many_chunks = GainProcessor::new(format, 6.0).unwrap();
        let whole = process_streaming(&input, &mut one_chunk, 100).unwrap();
        let split = process_streaming(&input, &mut many_chunks, 1).unwrap();
        assert_eq!(whole.samples(), split.samples());
    }

    #[test]
    fn limiter_keeps_oversampled_peak_under_ceiling() {
        let input = audio(vec![1.5; 48_000]);
        let format = AudioFormat::new(48_000, 1).unwrap();
        let config = LimiterConfig {
            lookahead_ms: 5.0,
            ceiling_dbfs: -1.0,
            release_ms: 50.0,
        };
        let mut limiter = LookaheadLimiter::new(format, &config).unwrap();
        let output = process_streaming(&input, &mut limiter, 127).unwrap();
        assert!(oversampled_peak(&output) <= 10.0f32.powf(-1.0 / 20.0) + 0.0001);
    }

    #[test]
    fn true_peak_limiter_is_invariant_to_chunk_boundaries() {
        let samples = (0..4_096)
            .map(|frame| {
                1.2 * (2.0 * std::f32::consts::PI * 17_000.0 * frame as f32 / 48_000.0).sin()
            })
            .collect();
        let input = audio(samples);
        let format = AudioFormat::new(48_000, 1).unwrap();
        let config = LimiterConfig::default();
        let mut one_chunk = LookaheadLimiter::new(format, &config).unwrap();
        let mut many_chunks = LookaheadLimiter::new(format, &config).unwrap();
        let whole = process_streaming(&input, &mut one_chunk, 10_000).unwrap();
        let split = process_streaming(&input, &mut many_chunks, 7).unwrap();
        assert_eq!(whole.samples(), split.samples());
        let peak = oversampled_peak(&whole);
        assert!(peak <= 10.0f32.powf(-1.0 / 20.0) + 0.0001, "peak={peak}");
    }

    #[test]
    fn trim_retains_part_of_long_pause_and_fades_the_join() {
        let mut samples = vec![0.4; 48_000];
        samples.extend(vec![0.0; 48_000]);
        samples.extend(vec![0.4; 48_000]);
        let input = audio(samples);
        let config = ProcessingConfig {
            trim: Some(TrimConfig {
                silence: SilenceConfig {
                    frame_ms: 10,
                    min_silence_ms: 300,
                    threshold_dbfs: -40.0,
                    guard_ms: 0,
                },
            }),
            trim_edit: TrimEditConfig {
                retain_ms: 250,
                max_trim_ms: 1_500,
                fade_ms: 8,
            },
            ..ProcessingConfig::default()
        };
        let output = process_audio(&input, &config).unwrap();
        assert_eq!(output.audio().frames(), 96_000 + 12_000);
        assert_eq!(output.timeline().segments().len(), 2);
        let join = output.timeline().segments()[0].output_end_frame;
        assert!(output.audio().samples()[join - 1] < 0.4);
        assert!(output.audio().samples()[join] < 0.4);
    }

    #[test]
    fn boost_uses_loudness_target() {
        let input = audio(
            (0..48_000 * 2)
                .map(|frame| {
                    0.1 * (2.0 * std::f32::consts::PI * 997.0 * frame as f32 / 48_000.0).sin()
                })
                .collect(),
        );
        let config = ProcessingConfig {
            boost: Some(BoostConfig {
                target_lufs: -14.0,
                max_gain_db: 12.0,
                max_attenuation_db: 12.0,
            }),
            ..ProcessingConfig::default()
        };
        let output = process_audio(&input, &config).unwrap();
        assert_close(integrated_lufs(output.audio()), -14.0, 0.1);
    }

    #[test]
    fn trim_builds_source_output_timeline() {
        let mut samples = vec![0.1; 48_000];
        samples.extend(vec![0.0; 24_000]);
        samples.extend(vec![0.1; 48_000]);
        let input = audio(samples);
        let config = ProcessingConfig {
            trim: Some(TrimConfig {
                silence: SilenceConfig {
                    frame_ms: 10,
                    min_silence_ms: 300,
                    threshold_dbfs: -40.0,
                    guard_ms: 0,
                },
            }),
            trim_edit: TrimEditConfig {
                retain_ms: 0,
                max_trim_ms: 1_500,
                fade_ms: 0,
            },
            ..ProcessingConfig::default()
        };
        let output = process_audio(&input, &config).unwrap();
        assert_eq!(output.audio().frames(), 96_000);
        assert_eq!(output.timeline().segments().len(), 2);
        assert_eq!(
            output.timeline().source_frame_for_output(48_000),
            Some(72_000.0)
        );
        assert_eq!(output.timeline().output_frame_for_source(60_000), 48_000);
    }

    fn assert_close(actual: f64, expected: f64, tolerance: f64) {
        assert!(
            (actual - expected).abs() <= tolerance,
            "{actual} vs {expected}"
        );
    }
}
