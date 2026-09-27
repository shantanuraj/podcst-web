use std::collections::VecDeque;

use crate::analysis::{
    AdaptiveSilenceConfig, SilenceFrameDecision, StreamingLoudnessAnalyzer, StreamingSilenceConfig,
    StreamingSilenceDetector,
};
use crate::{AudioError, AudioFormat};

struct VoiceBoost {
    loudness: StreamingLoudnessAnalyzer,
    format: AudioFormat,
    amplitude: f32,
    integrated_lufs: f64,
    measured_frames: usize,
    next_measurement: usize,
    warm_up_frames: usize,
    attack: f32,
    release: f32,
    bypass: f32,
}

impl VoiceBoost {
    pub fn new(format: AudioFormat) -> Result<Self, AudioError> {
        Ok(Self {
            loudness: StreamingLoudnessAnalyzer::new(format)?,
            format,
            amplitude: 1.0,
            integrated_lufs: f64::NEG_INFINITY,
            measured_frames: 0,
            next_measurement: (format.sample_rate / 10).max(1) as usize,
            warm_up_frames: format.sample_rate as usize,
            attack: 1.0 - (-1.0 / (f64::from(format.sample_rate) * 0.05)).exp() as f32,
            release: 1.0 - (-1.0 / f64::from(format.sample_rate)).exp() as f32,
            bypass: 1.0 - (-1.0 / (f64::from(format.sample_rate) * 0.02)).exp() as f32,
        })
    }

    pub fn reset(&mut self) {
        self.loudness.reset();
        self.amplitude = 1.0;
        self.integrated_lufs = f64::NEG_INFINITY;
        self.measured_frames = 0;
        self.next_measurement = (self.format.sample_rate / 10).max(1) as usize;
    }

    pub fn gain_db(&self) -> f32 {
        20.0 * self.amplitude.log10()
    }

    pub fn allocated_bytes(&self) -> usize {
        size_of::<Self>() + self.loudness.allocated_bytes() - size_of::<StreamingLoudnessAnalyzer>()
    }

    pub fn process_frame(
        &mut self,
        input: &mut [f32],
        decision: SilenceFrameDecision,
        enabled: bool,
    ) -> Result<(), AudioError> {
        self.loudness.process(input)?;
        self.measured_frames += input.len() / self.format.channels;
        if self.measured_frames >= self.next_measurement {
            self.integrated_lufs = self.loudness.metrics().integrated_lufs;
            self.next_measurement =
                self.measured_frames + (self.format.sample_rate / 10).max(1) as usize;
        }
        let recent = self.loudness.recent_lufs();
        let target = if !enabled {
            1.0
        } else if self.measured_frames < self.warm_up_frames || !recent.is_finite() {
            self.amplitude
        } else {
            let integrated = if self.integrated_lufs.is_finite() {
                self.integrated_lufs.clamp(recent - 6.0, recent + 6.0)
            } else {
                recent
            };
            let desired = 10.0f32.powf(
                ((-14.0 - (recent * 0.85 + integrated * 0.15)).clamp(-12.0, 12.0) / 20.0) as f32,
            );
            if decision.confident_signal && recent > -50.0 {
                desired
            } else {
                desired.min(self.amplitude)
            }
        };
        let smoothing = if !enabled {
            self.bypass
        } else if target < self.amplitude {
            self.attack
        } else {
            self.release
        };
        for frame in input.chunks_exact_mut(self.format.channels) {
            self.amplitude += (target - self.amplitude) * smoothing;
            if !enabled && (self.amplitude - 1.0).abs() < 0.00001 {
                self.amplitude = 1.0;
            }
            for sample in frame {
                *sample *= self.amplitude;
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EffectsSettings {
    pub boost_enabled: bool,
    pub trim_enabled: bool,
    pub revision: u64,
}

pub use crate::ffi::PodcstSourceSpan as SourceSpan;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EffectsReport {
    pub input_frames: usize,
    pub output_frames: usize,
    pub span_count: usize,
}

#[derive(Clone, Copy)]
struct RetainedFrame {
    source: u64,
    samples: [f32; 2],
}

pub struct SpeechProcessor {
    format: AudioFormat,
    detector: StreamingSilenceDetector,
    boost: VoiceBoost,
    analysis: Vec<f32>,
    analysis_samples: usize,
    retained: VecDeque<RetainedFrame>,
    ready: usize,
    source_next: u64,
    requested: EffectsSettings,
    applied: EffectsSettings,
    applied_source_frame: u64,
    quiet_frames: usize,
    removed_in_run: usize,
    cut_open: bool,
    minimum_frames: usize,
    lead_frames: usize,
    tail_frames: usize,
    maximum_removal: usize,
    fade_frames: usize,
    finishing: bool,
    finished_analysis: bool,
}

impl SpeechProcessor {
    pub fn new(format: AudioFormat, settings: EffectsSettings) -> Result<Self, AudioError> {
        if !(8_000..=192_000).contains(&format.sample_rate) || !(1..=2).contains(&format.channels) {
            return Err(AudioError::InvalidProcessor(
                "unsupported effects format".to_owned(),
            ));
        }
        let detector = StreamingSilenceDetector::new(
            format,
            StreamingSilenceConfig::Adaptive {
                silence: AdaptiveSilenceConfig::default(),
                window_ms: 2_000,
            },
        )?;
        let analysis_frames = detector.frame_length();
        let milliseconds =
            |value: u64| (u64::from(format.sample_rate) * value).div_ceil(1000) as usize;
        let minimum_frames = milliseconds(500);
        Ok(Self {
            format,
            detector,
            boost: VoiceBoost::new(format)?,
            analysis: vec![0.0; analysis_frames * format.channels],
            analysis_samples: 0,
            retained: VecDeque::with_capacity(minimum_frames + analysis_frames),
            ready: 0,
            source_next: 0,
            requested: settings,
            applied: settings,
            applied_source_frame: 0,
            quiet_frames: 0,
            removed_in_run: 0,
            cut_open: false,
            minimum_frames,
            lead_frames: milliseconds(205),
            tail_frames: milliseconds(205),
            maximum_removal: milliseconds(1_500),
            fade_frames: milliseconds(8),
            finishing: false,
            finished_analysis: false,
        })
    }

    pub fn format(&self) -> AudioFormat {
        self.format
    }
    pub fn settings(&self) -> EffectsSettings {
        self.applied
    }
    pub fn applied_source_frame(&self) -> u64 {
        self.applied_source_frame
    }
    pub fn gain_db(&self) -> f32 {
        self.boost.gain_db()
    }
    pub fn pending_frames(&self) -> usize {
        self.retained.len() + self.analysis_samples / self.format.channels
    }
    pub fn has_ready_output(&self) -> bool {
        self.ready > 0
    }
    pub fn is_finished(&self) -> bool {
        self.finishing && self.finished_analysis && self.pending_frames() == 0
    }
    pub fn maximum_buffered_frames(&self) -> usize {
        self.minimum_frames + self.detector.frame_length()
    }
    pub fn allocated_bytes(&self) -> usize {
        size_of::<Self>() + self.detector.allocated_bytes() - size_of::<StreamingSilenceDetector>()
            + self.boost.allocated_bytes()
            - size_of::<VoiceBoost>()
            + self.analysis.capacity() * size_of::<f32>()
            + self.retained.capacity() * size_of::<RetainedFrame>()
    }

    pub fn configure(&mut self, settings: EffectsSettings) -> Result<(), AudioError> {
        if self.finishing {
            return Err(AudioError::ProcessingFinished);
        }
        self.requested = settings;
        Ok(())
    }

    pub fn reset(&mut self, source_origin: u64) {
        self.detector.reset();
        self.boost.reset();
        self.analysis_samples = 0;
        self.retained.clear();
        self.ready = 0;
        self.source_next = source_origin;
        self.applied = self.requested;
        self.applied_source_frame = source_origin;
        self.quiet_frames = 0;
        self.removed_in_run = 0;
        self.cut_open = false;
        self.finishing = false;
        self.finished_analysis = false;
    }

    pub fn process(
        &mut self,
        input: &[f32],
        output: &mut [f32],
        spans: &mut [SourceSpan],
    ) -> Result<EffectsReport, AudioError> {
        if self.finishing {
            return Err(AudioError::ProcessingFinished);
        }
        let input_frames = self.format.validate_samples(input)?;
        self.validate_output(output, spans)?;
        if input_frames > crate::ffi::PODCST_AUDIO_MAX_BLOCK_FRAMES as usize {
            return Err(AudioError::BufferSizeOverflow);
        }
        self.source_next
            .checked_add(input_frames as u64)
            .ok_or(AudioError::BufferSizeOverflow)?;
        if input.iter().any(|sample| sample.abs() > f32::MAX / 4.0) {
            return Err(AudioError::SampleOverflow);
        }
        let mut report = EffectsReport::default();
        loop {
            self.emit(output, spans, &mut report);
            if self.ready > 0 || report.input_frames == input_frames {
                break;
            }
            if self.analysis_samples == 0 && self.applied != self.requested {
                if self.applied.trim_enabled != self.requested.trim_enabled {
                    self.flush_quiet();
                }
                self.applied = self.requested;
                self.applied_source_frame = self.source_next;
                if self.ready > 0 {
                    continue;
                }
            }
            let offset = report.input_frames * self.format.channels;
            let count = (self.analysis.len() - self.analysis_samples).min(input.len() - offset);
            self.analysis[self.analysis_samples..self.analysis_samples + count]
                .copy_from_slice(&input[offset..offset + count]);
            self.analysis_samples += count;
            report.input_frames += count / self.format.channels;
            self.source_next += (count / self.format.channels) as u64;
            if self.analysis_samples == self.analysis.len() {
                self.process_analysis(false)?;
            }
        }
        Ok(report)
    }

    pub fn finish(
        &mut self,
        output: &mut [f32],
        spans: &mut [SourceSpan],
    ) -> Result<EffectsReport, AudioError> {
        self.validate_output(output, spans)?;
        self.finishing = true;
        let mut report = EffectsReport::default();
        self.emit(output, spans, &mut report);
        if self.ready > 0 {
            return Ok(report);
        }
        if !self.finished_analysis {
            if self.analysis_samples > 0 {
                self.process_analysis(true)?;
            }
            self.flush_quiet();
            self.finished_analysis = true;
        }
        self.emit(output, spans, &mut report);
        Ok(report)
    }

    fn validate_output(&self, output: &[f32], spans: &[SourceSpan]) -> Result<(), AudioError> {
        if output.len() % self.format.channels != 0
            || output.len() / self.format.channels
                > crate::ffi::PODCST_AUDIO_MAX_BLOCK_FRAMES as usize
            || spans.len() > crate::ffi::PODCST_AUDIO_MAX_BLOCK_FRAMES as usize
        {
            return Err(AudioError::BufferSizeOverflow);
        }
        Ok(())
    }

    fn process_analysis(&mut self, final_block: bool) -> Result<(), AudioError> {
        let samples = &mut self.analysis[..self.analysis_samples];
        let mut decision = None;
        self.detector
            .process_frames(samples, |value| decision = Some(value))?;
        if final_block {
            self.detector.finish_frames(|value| decision = Some(value));
        }
        let decision = decision.unwrap();
        self.boost
            .process_frame(samples, decision, self.applied.boost_enabled)?;
        let source_start = self.source_next - decision.frames as u64;
        for (index, samples) in samples.chunks_exact(self.format.channels).enumerate() {
            let mut values = [0.0; 2];
            values[..self.format.channels].copy_from_slice(samples);
            self.retained.push_back(RetainedFrame {
                source: source_start + index as u64,
                samples: values,
            });
        }
        self.analysis_samples = 0;
        self.edit(decision);
        Ok(())
    }

    fn edit(&mut self, decision: SilenceFrameDecision) {
        if decision.confident_signal {
            self.removed_in_run = 0;
        }
        if !self.applied.trim_enabled
            || !decision.silent
            || self.removed_in_run == self.maximum_removal
        {
            self.flush_quiet();
            return;
        }
        self.quiet_frames = self
            .quiet_frames
            .saturating_add(decision.frames)
            .min(self.minimum_frames);
        if self.quiet_frames < self.minimum_frames {
            return;
        }
        let lead = if self.cut_open { 0 } else { self.lead_frames };
        let removal = self
            .retained
            .len()
            .saturating_sub(lead + self.tail_frames)
            .min(self.maximum_removal - self.removed_in_run);
        if removal == 0 {
            return;
        }
        if !self.cut_open {
            self.fade(
                lead.saturating_sub(self.fade_frames),
                lead.min(self.fade_frames),
                false,
            );
        }
        self.retained.drain(lead..lead + removal);
        self.removed_in_run += removal;
        self.cut_open = true;
        self.ready = lead;
        if self.removed_in_run == self.maximum_removal {
            self.fade(lead, self.fade_frames.min(self.retained.len() - lead), true);
            self.cut_open = false;
            self.ready = self.retained.len();
        }
    }

    fn flush_quiet(&mut self) {
        if self.cut_open {
            self.fade(
                self.ready,
                self.fade_frames.min(self.retained.len() - self.ready),
                true,
            );
        }
        self.cut_open = false;
        self.quiet_frames = 0;
        self.ready = self.retained.len();
    }

    fn fade(&mut self, start: usize, frames: usize, fade_in: bool) {
        for index in 0..frames {
            let progress = index as f32 / frames.saturating_sub(1).max(1) as f32;
            let amplitude = if fade_in { progress } else { 1.0 - progress };
            for sample in &mut self.retained[start + index].samples {
                *sample *= amplitude;
            }
        }
    }

    fn emit(&mut self, output: &mut [f32], spans: &mut [SourceSpan], report: &mut EffectsReport) {
        while self.ready > 0 && report.output_frames < output.len() / self.format.channels {
            let frame = self.retained.front().unwrap();
            let continues = report.span_count > 0 && {
                let span = spans[report.span_count - 1];
                span.source_start_frame + u64::from(span.frame_count) == frame.source
            };
            if !continues {
                if report.span_count == spans.len() {
                    break;
                }
                spans[report.span_count] = SourceSpan {
                    source_start_frame: frame.source,
                    output_start_frame: report.output_frames as u32,
                    frame_count: 0,
                };
                report.span_count += 1;
            }
            spans[report.span_count - 1].frame_count += 1;
            let offset = report.output_frames * self.format.channels;
            output[offset..offset + self.format.channels]
                .copy_from_slice(&frame.samples[..self.format.channels]);
            self.retained.pop_front();
            self.ready -= 1;
            report.output_frames += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decision(frame: usize, frames: usize, signal: bool) -> SilenceFrameDecision {
        SilenceFrameDecision {
            source_start_frame: frame,
            frames,
            silent: !signal,
            confident_signal: signal,
        }
    }

    #[test]
    fn boost_freezes_noise_and_uses_linked_stereo_ramps() {
        let format = AudioFormat::new(8_000, 2).unwrap();
        let mut boost = VoiceBoost::new(format).unwrap();
        for index in 0..400 {
            let mut input = [0.0001; 160];
            boost
                .process_frame(&mut input, decision(index * 80, 80, false), true)
                .unwrap();
            assert_eq!(input, [0.0001; 160]);
        }
        boost.reset();
        let mut previous = 1.0;
        for index in 0..800 {
            let mut input = [0.0; 160];
            for (frame, values) in input.chunks_exact_mut(2).enumerate() {
                let value = 0.08
                    * (std::f32::consts::TAU * 397.0 * (index * 80 + frame) as f32 / 8000.0).sin();
                values[0] = value;
                values[1] = value * 0.5;
            }
            boost
                .process_frame(&mut input, decision(index * 80, 80, true), true)
                .unwrap();
            for values in input.chunks_exact(2) {
                assert_eq!(values[1], values[0] * 0.5);
            }
            if index < 99 {
                assert_eq!(boost.gain_db(), 0.0);
            }
            let gain = 10.0f32.powf(boost.gain_db() / 20.0);
            assert!((gain - previous).abs() < 0.04);
            previous = gain;
        }
        assert!(boost.gain_db() > 6.0 && boost.gain_db() <= 12.0);
        for index in 0..100 {
            let mut input = [0.08; 160];
            boost
                .process_frame(&mut input, decision(index * 80, 80, true), false)
                .unwrap();
        }
        assert_eq!(boost.gain_db(), 0.0);
    }
}
