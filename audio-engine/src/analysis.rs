use std::cmp::Reverse;
use std::collections::{BinaryHeap, VecDeque};

use crate::audio::{AudioError, PcmAudio};
use crate::processing::{AudioFormat, ensure_active};

const ABSOLUTE_GATE_LUFS: f64 = -70.0;
const RELATIVE_GATE_LU: f64 = 10.0;
const LOUDNESS_OFFSET_LUFS: f64 = -0.691;
const BLOCK_SECONDS: f64 = 0.4;
const HOP_SECONDS: f64 = 0.1;

#[derive(Clone, Debug, Default)]
pub struct AnalysisConfig {
    pub silence: SilenceConfig,
}

#[derive(Clone, Debug)]
pub struct SilenceConfig {
    pub frame_ms: u32,
    pub min_silence_ms: u32,
    pub threshold_dbfs: f64,
    pub guard_ms: u32,
}

impl Default for SilenceConfig {
    fn default() -> Self {
        Self {
            frame_ms: 10,
            min_silence_ms: 300,
            threshold_dbfs: -50.0,
            guard_ms: 20,
        }
    }
}

#[derive(Clone, Debug)]
pub struct AdaptiveSilenceConfig {
    pub frame_ms: u32,
    pub min_silence_ms: u32,
    pub guard_ms: u32,
    pub noise_floor_percentile: f64,
    pub threshold_offset_db: f64,
    pub min_threshold_dbfs: f64,
    pub max_threshold_dbfs: f64,
    pub min_dynamic_range_db: f64,
    pub speech_margin_db: f64,
    pub hysteresis_db: f64,
}

impl Default for AdaptiveSilenceConfig {
    fn default() -> Self {
        Self {
            frame_ms: 10,
            min_silence_ms: 500,
            guard_ms: 80,
            noise_floor_percentile: 0.1,
            threshold_offset_db: 6.0,
            min_threshold_dbfs: -90.0,
            max_threshold_dbfs: -40.0,
            min_dynamic_range_db: 12.0,
            speech_margin_db: 20.0,
            hysteresis_db: 3.0,
        }
    }
}

impl SilenceConfig {
    pub fn validate(&self) -> Result<(), AudioError> {
        if self.frame_ms == 0 || self.min_silence_ms == 0 || !self.threshold_dbfs.is_finite() {
            return Err(AudioError::InvalidProcessor(
                "invalid silence configuration".to_owned(),
            ));
        }
        Ok(())
    }
}

impl AdaptiveSilenceConfig {
    pub fn validate(&self) -> Result<(), AudioError> {
        let levels = [
            self.threshold_offset_db,
            self.min_threshold_dbfs,
            self.max_threshold_dbfs,
            self.min_dynamic_range_db,
            self.speech_margin_db,
            self.hysteresis_db,
        ];
        if self.frame_ms == 0
            || self.min_silence_ms == 0
            || !(0.0..=1.0).contains(&self.noise_floor_percentile)
            || levels.iter().any(|value| !value.is_finite())
            || self.min_threshold_dbfs > self.max_threshold_dbfs
            || self.threshold_offset_db < 0.0
            || self.min_dynamic_range_db < 0.0
            || self.speech_margin_db < 0.0
            || self.hysteresis_db < 0.0
        {
            return Err(AudioError::InvalidProcessor(
                "invalid adaptive silence configuration".to_owned(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SilenceSegment {
    pub start_seconds: f64,
    pub end_seconds: f64,
}

impl SilenceSegment {
    pub fn duration_seconds(&self) -> f64 {
        self.end_seconds - self.start_seconds
    }
}

#[derive(Clone, Debug)]
pub struct AudioMetrics {
    pub sample_rate: u32,
    pub channels: usize,
    pub frames: usize,
    pub duration_seconds: f64,
    pub rms_dbfs: f64,
    pub sample_peak_dbfs: f64,
    pub oversampled_peak_dbfs: f64,
    pub integrated_lufs: f64,
    pub silence_segments: Vec<SilenceSegment>,
}

pub fn analyze(audio: &PcmAudio, config: &AnalysisConfig) -> Result<AudioMetrics, AudioError> {
    let silence_segments = detect_silence(audio, &config.silence)?;
    Ok(AudioMetrics {
        sample_rate: audio.sample_rate(),
        channels: audio.channels(),
        frames: audio.frames(),
        duration_seconds: audio.duration_seconds(),
        rms_dbfs: rms_dbfs(audio),
        sample_peak_dbfs: db_from_amplitude(sample_peak(audio)),
        oversampled_peak_dbfs: db_from_amplitude(oversampled_peak(audio)),
        integrated_lufs: integrated_lufs(audio),
        silence_segments,
    })
}

pub fn rms_dbfs(audio: &PcmAudio) -> f64 {
    if audio.samples().is_empty() {
        return f64::NEG_INFINITY;
    }
    let power = audio
        .samples()
        .iter()
        .map(|sample| f64::from(*sample) * f64::from(*sample))
        .sum::<f64>()
        / audio.samples().len() as f64;
    db_from_power(power)
}

pub fn sample_peak(audio: &PcmAudio) -> f32 {
    audio
        .samples()
        .iter()
        .map(|sample| sample.abs())
        .fold(0.0, f32::max)
}

pub fn oversampled_peak(audio: &PcmAudio) -> f32 {
    oversampled_peak_samples(audio.channels(), audio.samples())
}

pub(crate) fn oversampled_peak_samples(channels: usize, samples: &[f32]) -> f32 {
    const CANDIDATES_PER_BLOCK: usize = 64;
    const SCAN_BLOCK_FRAMES: usize = 4096;
    if channels == 0 || samples.is_empty() || samples.len() % channels != 0 {
        return 0.0;
    }
    let frames = samples.len() / channels;
    let mut peak = samples
        .iter()
        .map(|sample| sample.abs())
        .fold(0.0, f32::max);
    for block_start in (0..frames).step_by(SCAN_BLOCK_FRAMES) {
        let block_end = (block_start + SCAN_BLOCK_FRAMES).min(frames);
        for channel in 0..channels {
            let mut candidates = BinaryHeap::with_capacity(CANDIDATES_PER_BLOCK);
            for frame in block_start..block_end {
                let sample = samples[frame * channels + channel].abs();
                let candidate = Reverse((sample.to_bits(), frame));
                if candidates.len() < CANDIDATES_PER_BLOCK {
                    candidates.push(candidate);
                } else if candidates
                    .peek()
                    .is_some_and(|smallest| candidate > *smallest)
                {
                    candidates.pop();
                    candidates.push(candidate);
                }
            }
            for candidate in candidates {
                let candidate_frame = candidate.0.1;
                for phase in -3..=3 {
                    if phase == 0 {
                        continue;
                    }
                    let position = candidate_frame as f64 + f64::from(phase) / 4.0;
                    peak = peak.max(
                        interpolated_sample(channels, samples, frames, position, channel).abs(),
                    );
                }
            }
        }
    }
    peak
}

pub fn integrated_lufs(audio: &PcmAudio) -> f64 {
    let blocks = loudness_blocks(audio);
    if blocks.is_empty() {
        return f64::NEG_INFINITY;
    }

    let ungated_energy = blocks
        .iter()
        .filter(|(_, energy)| *energy > 0.0)
        .map(|(_, energy)| *energy)
        .sum::<f64>();
    let ungated_count = blocks.iter().filter(|(_, energy)| *energy > 0.0).count();
    if ungated_count == 0 {
        return f64::NEG_INFINITY;
    }
    let ungated_loudness = loudness_from_energy(ungated_energy / ungated_count as f64);
    let gate = (ungated_loudness - RELATIVE_GATE_LU).max(ABSOLUTE_GATE_LUFS);
    let gated = blocks
        .iter()
        .filter(|(_, energy)| loudness_from_energy(*energy) > gate)
        .map(|(_, energy)| *energy)
        .sum::<f64>();
    let gated_count = blocks
        .iter()
        .filter(|(_, energy)| loudness_from_energy(*energy) > gate)
        .count();
    if gated_count == 0 {
        f64::NEG_INFINITY
    } else {
        loudness_from_energy(gated / gated_count as f64)
    }
}

pub fn detect_silence(
    audio: &PcmAudio,
    config: &SilenceConfig,
) -> Result<Vec<SilenceSegment>, AudioError> {
    config.validate()?;
    let (frame_length, levels) = frame_levels(audio, config.frame_ms);
    let mask = levels
        .iter()
        .map(|level| *level <= config.threshold_dbfs)
        .collect::<Vec<_>>();
    Ok(silence_segments_from_mask(
        audio,
        frame_length,
        config.min_silence_ms,
        config.guard_ms,
        &mask,
    ))
}

pub fn detect_adaptive_silence(
    audio: &PcmAudio,
    config: &AdaptiveSilenceConfig,
) -> Result<Vec<SilenceSegment>, AudioError> {
    config.validate()?;
    let (frame_length, levels) = frame_levels(audio, config.frame_ms);
    if levels.is_empty() {
        return Ok(Vec::new());
    }
    let mut sorted_levels = levels.clone();
    sorted_levels.sort_by(f64::total_cmp);
    let noise_floor = percentile(&sorted_levels, config.noise_floor_percentile);
    let high_level = percentile(&sorted_levels, 0.9);
    if !high_level.is_finite() || high_level - noise_floor < config.min_dynamic_range_db {
        return Ok(Vec::new());
    }
    let speech_ceiling = high_level - config.speech_margin_db;
    let threshold = (noise_floor + config.threshold_offset_db)
        .clamp(config.min_threshold_dbfs, config.max_threshold_dbfs)
        .min(speech_ceiling);
    let exit_threshold = (threshold + config.hysteresis_db).min(speech_ceiling);
    let mut silent = false;
    let mask = levels
        .iter()
        .map(|level| {
            silent = *level <= if silent { exit_threshold } else { threshold };
            silent
        })
        .collect::<Vec<_>>();
    Ok(silence_segments_from_mask(
        audio,
        frame_length,
        config.min_silence_ms,
        config.guard_ms,
        &mask,
    ))
}

fn frame_levels(audio: &PcmAudio, frame_ms: u32) -> (usize, Vec<f64>) {
    if audio.frames() == 0 || frame_ms == 0 {
        return (0, Vec::new());
    }
    let frame_length =
        ((u64::from(audio.sample_rate()) * u64::from(frame_ms)) / 1000).max(1) as usize;
    let mut levels = Vec::new();
    let mut frame_start = 0;
    while frame_start < audio.frames() {
        let frame_end = (frame_start + frame_length).min(audio.frames());
        let power = (0..audio.channels())
            .map(|channel| {
                audio.samples()
                    [frame_start * audio.channels() + channel..frame_end * audio.channels()]
                    .iter()
                    .step_by(audio.channels())
                    .map(|sample| f64::from(*sample).powi(2))
                    .sum::<f64>()
                    / (frame_end - frame_start) as f64
            })
            .fold(0.0, f64::max);
        levels.push(db_from_power(power));
        frame_start = frame_end;
    }
    (frame_length, levels)
}

fn silence_segments_from_mask(
    audio: &PcmAudio,
    frame_length: usize,
    min_silence_ms: u32,
    guard_ms: u32,
    mask: &[bool],
) -> Vec<SilenceSegment> {
    if audio.frames() == 0 || frame_length == 0 || min_silence_ms == 0 {
        return Vec::new();
    }
    let minimum_samples = u64::from(min_silence_ms)
        .saturating_mul(u64::from(audio.sample_rate()))
        .div_ceil(1_000) as usize;
    let guard_samples =
        (u64::from(guard_ms) * u64::from(audio.sample_rate())).div_ceil(1_000) as usize;
    let mut segments = Vec::new();
    let mut silent_start = None;
    for (index, is_silent) in mask.iter().copied().enumerate() {
        let frame_start = index * frame_length;
        if is_silent {
            silent_start.get_or_insert(frame_start);
        } else if let Some(start) = silent_start.take() {
            append_silence_segment(
                &mut segments,
                start,
                frame_start,
                minimum_samples,
                guard_samples,
                audio,
            );
        }
    }
    if let Some(start) = silent_start {
        append_silence_segment(
            &mut segments,
            start,
            audio.frames(),
            minimum_samples,
            guard_samples,
            audio,
        );
    }
    segments
}

fn percentile(sorted_values: &[f64], fraction: f64) -> f64 {
    let index = (fraction * (sorted_values.len() - 1) as f64).round() as usize;
    sorted_values[index]
}

fn append_silence_segment(
    segments: &mut Vec<SilenceSegment>,
    start: usize,
    end: usize,
    minimum_samples: usize,
    guard_samples: usize,
    audio: &PcmAudio,
) {
    if end - start < minimum_samples {
        return;
    }
    let guarded_start = start.saturating_add(guard_samples).min(end);
    let guarded_end = end.saturating_sub(guard_samples).max(guarded_start);
    if guarded_end <= guarded_start || guarded_start >= audio.frames() {
        return;
    }
    segments.push(SilenceSegment {
        start_seconds: guarded_start as f64 / audio.sample_rate() as f64,
        end_seconds: guarded_end.min(audio.frames()) as f64 / audio.sample_rate() as f64,
    });
}

fn loudness_blocks(audio: &PcmAudio) -> Vec<(usize, f64)> {
    if audio.frames() == 0 {
        return Vec::new();
    }
    let mut filters = (0..audio.channels())
        .map(|_| KWeightingFilter::new(audio.sample_rate()))
        .collect::<Vec<_>>();
    let mut weighted = vec![0.0f64; audio.samples().len()];
    for frame in 0..audio.frames() {
        for (channel, filter) in filters.iter_mut().enumerate() {
            let index = frame * audio.channels() + channel;
            weighted[index] = filter.process(f64::from(audio.samples()[index]));
        }
    }

    let block_length = ((audio.sample_rate() as f64 * BLOCK_SECONDS).round() as usize).max(1);
    let hop_length = ((audio.sample_rate() as f64 * HOP_SECONDS).round() as usize).max(1);
    let mut blocks = Vec::new();
    if audio.frames() < block_length {
        blocks.push((
            0,
            weighted_energy(&weighted, audio.channels(), 0, audio.frames()),
        ));
        return blocks;
    }
    let mut start = 0;
    while start + block_length <= audio.frames() {
        blocks.push((
            start,
            weighted_energy(&weighted, audio.channels(), start, start + block_length),
        ));
        start += hop_length;
    }
    blocks
}

fn weighted_energy(samples: &[f64], channels: usize, start: usize, end: usize) -> f64 {
    let frames = end - start;
    let mut energy = 0.0;
    for frame in start..end {
        for channel in 0..channels {
            let sample = samples[frame * channels + channel];
            energy += sample * sample;
        }
    }
    energy / frames as f64
}

fn loudness_from_energy(energy: f64) -> f64 {
    if energy <= 0.0 {
        f64::NEG_INFINITY
    } else {
        LOUDNESS_OFFSET_LUFS + 10.0 * energy.log10()
    }
}

fn db_from_power(power: f64) -> f64 {
    if power <= 0.0 {
        f64::NEG_INFINITY
    } else {
        10.0 * power.log10()
    }
}

fn db_from_amplitude(amplitude: f32) -> f64 {
    if amplitude <= 0.0 {
        f64::NEG_INFINITY
    } else {
        20.0 * f64::from(amplitude).log10()
    }
}

fn interpolated_sample(
    channels: usize,
    samples: &[f32],
    frames: usize,
    position: f64,
    channel: usize,
) -> f32 {
    const RADIUS: i32 = 16;
    let center = position.floor() as i32;
    let mut result = 0.0;
    let mut weight_sum = 0.0;
    for offset in -RADIUS + 1..=RADIUS {
        let frame = center + offset;
        if frame < 0 || frame >= frames as i32 {
            continue;
        }
        let distance = position - f64::from(frame);
        let sinc = if distance.abs() < f64::EPSILON {
            1.0
        } else {
            let pi_distance = std::f64::consts::PI * distance;
            pi_distance.sin() / pi_distance
        };
        let window_position = f64::from(offset + RADIUS - 1) / f64::from(2 * RADIUS - 1);
        let window = 0.42 - 0.5 * (2.0 * std::f64::consts::PI * window_position).cos()
            + 0.08 * (4.0 * std::f64::consts::PI * window_position).cos();
        let weight = sinc * window;
        result += f64::from(samples[frame as usize * channels + channel]) * weight;
        weight_sum += weight;
    }
    if weight_sum.abs() > f64::EPSILON {
        (result / weight_sum) as f32
    } else {
        0.0
    }
}

struct KWeightingFilter {
    high_pass: Biquad,
    high_shelf: Biquad,
}

impl KWeightingFilter {
    fn new(sample_rate: u32) -> Self {
        Self {
            high_pass: Biquad::high_pass(sample_rate as f64, 38.135_470_876, 0.500_327_037),
            high_shelf: Biquad::high_shelf(
                sample_rate as f64,
                1_681.974_450_956,
                3.999_843_854,
                0.707_175_237,
            ),
        }
    }

    fn process(&mut self, sample: f64) -> f64 {
        self.high_shelf.process(self.high_pass.process(sample))
    }
}

struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

impl Biquad {
    fn high_pass(sample_rate: f64, frequency: f64, q: f64) -> Self {
        let omega = 2.0 * std::f64::consts::PI * frequency / sample_rate;
        let alpha = omega.sin() / (2.0 * q);
        let cosine = omega.cos();
        Self::from_raw(
            (1.0 + cosine) / 2.0,
            -(1.0 + cosine),
            (1.0 + cosine) / 2.0,
            1.0 + alpha,
            -2.0 * cosine,
            1.0 - alpha,
        )
    }

    fn high_shelf(sample_rate: f64, frequency: f64, gain_db: f64, q: f64) -> Self {
        let omega = 2.0 * std::f64::consts::PI * frequency / sample_rate;
        let alpha = omega.sin() / (2.0 * q);
        let cosine = omega.cos();
        let amplitude = 10.0f64.powf(gain_db / 40.0);
        let two_sqrt_amplitude_alpha = 2.0 * amplitude.sqrt() * alpha;
        Self::from_raw(
            amplitude * ((amplitude + 1.0) + (amplitude - 1.0) * cosine + two_sqrt_amplitude_alpha),
            -2.0 * amplitude * ((amplitude - 1.0) + (amplitude + 1.0) * cosine),
            amplitude * ((amplitude + 1.0) + (amplitude - 1.0) * cosine - two_sqrt_amplitude_alpha),
            (amplitude + 1.0) - (amplitude - 1.0) * cosine + two_sqrt_amplitude_alpha,
            2.0 * ((amplitude - 1.0) - (amplitude + 1.0) * cosine),
            (amplitude + 1.0) - (amplitude - 1.0) * cosine - two_sqrt_amplitude_alpha,
        )
    }

    fn from_raw(b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64) -> Self {
        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    fn process(&mut self, sample: f64) -> f64 {
        let output = self.b0 * sample + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = sample;
        self.y2 = self.y1;
        self.y1 = output;
        output
    }
}

const HISTOGRAM_MIN_LUFS: f64 = -160.0;
const HISTOGRAM_STEP_LU: f64 = 0.1;
const HISTOGRAM_BINS: usize = 9_602;

#[derive(Clone, Debug, PartialEq)]
pub struct StreamingLoudnessMetrics {
    pub source_start_frame: usize,
    pub frames: usize,
    pub loudness_blocks: u64,
    pub rms_dbfs: f64,
    pub sample_peak_dbfs: f64,
    pub integrated_lufs: f64,
}

pub struct StreamingLoudnessAnalyzer {
    format: AudioFormat,
    filters: Vec<KWeightingFilter>,
    block_length: usize,
    hop_length: usize,
    energies: VecDeque<f64>,
    window_energy: f64,
    histogram: Vec<(u64, f64)>,
    positive_blocks: u64,
    block_energy: f64,
    blocks: u64,
    source_start_frame: usize,
    frames: usize,
    sample_energy: f64,
    sample_peak: f32,
    finished: bool,
}

impl StreamingLoudnessAnalyzer {
    pub fn new(format: AudioFormat) -> Result<Self, AudioError> {
        AudioFormat::new(format.sample_rate, format.channels)?;
        let block_length =
            ((f64::from(format.sample_rate) * BLOCK_SECONDS).round() as usize).max(1);
        Ok(Self {
            format,
            filters: (0..format.channels)
                .map(|_| KWeightingFilter::new(format.sample_rate))
                .collect(),
            block_length,
            hop_length: ((f64::from(format.sample_rate) * HOP_SECONDS).round() as usize).max(1),
            energies: VecDeque::with_capacity(block_length),
            window_energy: 0.0,
            histogram: vec![(0, 0.0); HISTOGRAM_BINS],
            positive_blocks: 0,
            block_energy: 0.0,
            blocks: 0,
            source_start_frame: 0,
            frames: 0,
            sample_energy: 0.0,
            sample_peak: 0.0,
            finished: false,
        })
    }

    pub fn reset(&mut self) {
        for filter in &mut self.filters {
            *filter = KWeightingFilter::new(self.format.sample_rate);
        }
        self.energies.clear();
        self.window_energy = 0.0;
        self.histogram.fill((0, 0.0));
        self.positive_blocks = 0;
        self.block_energy = 0.0;
        self.blocks = 0;
        self.source_start_frame = 0;
        self.frames = 0;
        self.sample_energy = 0.0;
        self.sample_peak = 0.0;
        self.finished = false;
    }

    pub fn start(&mut self) {
        self.reset();
    }

    pub fn seek(&mut self, source_frame: usize) {
        self.reset();
        self.source_start_frame = source_frame;
    }

    pub fn block_frames(&self) -> usize {
        self.block_length
    }

    pub fn process(&mut self, input: &[f32]) -> Result<(), AudioError> {
        ensure_active(self.finished)?;
        self.format.validate_samples(input)?;
        for frame in input.chunks_exact(self.format.channels) {
            let mut energy = 0.0;
            for (sample, filter) in frame.iter().zip(&mut self.filters) {
                self.sample_energy += f64::from(*sample).powi(2);
                self.sample_peak = self.sample_peak.max(sample.abs());
                energy += filter.process(f64::from(*sample)).powi(2);
            }
            if self.energies.len() == self.block_length {
                self.window_energy -= self.energies.pop_front().unwrap();
            }
            self.energies.push_back(energy);
            self.window_energy += energy;
            self.frames += 1;
            if self.frames >= self.block_length
                && (self.frames - self.block_length) % self.hop_length == 0
            {
                self.add_block(self.window_energy.max(0.0) / self.block_length as f64);
            }
        }
        Ok(())
    }

    pub fn recent_lufs(&self) -> f64 {
        if self.energies.is_empty() {
            f64::NEG_INFINITY
        } else {
            loudness_from_energy(self.window_energy.max(0.0) / self.energies.len() as f64)
        }
    }

    pub fn allocated_bytes(&self) -> usize {
        size_of::<Self>()
            + self.filters.capacity() * size_of::<KWeightingFilter>()
            + self.energies.capacity() * size_of::<f64>()
            + self.histogram.capacity() * size_of::<(u64, f64)>()
    }

    pub fn finish(&mut self) -> StreamingLoudnessMetrics {
        if !self.finished && self.frames > 0 && self.frames < self.block_length {
            self.add_block(self.window_energy.max(0.0) / self.frames as f64);
        }
        self.finished = true;
        self.metrics()
    }

    pub fn metrics(&self) -> StreamingLoudnessMetrics {
        let gate = if self.positive_blocks == 0 {
            ABSOLUTE_GATE_LUFS
        } else {
            (loudness_from_energy(self.block_energy / self.positive_blocks as f64)
                - RELATIVE_GATE_LU)
                .max(ABSOLUTE_GATE_LUFS)
        };
        let (count, energy) = self
            .histogram
            .iter()
            .enumerate()
            .filter(|(index, _)| HISTOGRAM_MIN_LUFS + *index as f64 * HISTOGRAM_STEP_LU > gate)
            .fold((0u64, 0.0), |(count, energy), (_, bin)| {
                (count + bin.0, energy + bin.1)
            });
        StreamingLoudnessMetrics {
            source_start_frame: self.source_start_frame,
            frames: self.frames,
            loudness_blocks: self.blocks,
            rms_dbfs: if self.frames == 0 {
                f64::NEG_INFINITY
            } else {
                db_from_power(self.sample_energy / self.frames as f64 / self.format.channels as f64)
            },
            sample_peak_dbfs: db_from_amplitude(self.sample_peak),
            integrated_lufs: if count == 0 {
                f64::NEG_INFINITY
            } else {
                loudness_from_energy(energy / count as f64)
            },
        }
    }

    fn add_block(&mut self, energy: f64) {
        self.blocks += 1;
        if energy <= 0.0 {
            return;
        }
        self.positive_blocks += 1;
        self.block_energy += energy;
        let index = ((loudness_from_energy(energy) - HISTOGRAM_MIN_LUFS) / HISTOGRAM_STEP_LU)
            .round()
            .clamp(0.0, (HISTOGRAM_BINS - 1) as f64) as usize;
        self.histogram[index].0 += 1;
        self.histogram[index].1 += energy;
    }
}

#[derive(Clone, Debug)]
pub enum StreamingSilenceConfig {
    Fixed(SilenceConfig),
    Adaptive {
        silence: AdaptiveSilenceConfig,
        window_ms: u32,
    },
}

impl StreamingSilenceConfig {
    fn timing(&self) -> (u32, u32, u32) {
        match self {
            Self::Fixed(config) => (config.frame_ms, config.min_silence_ms, config.guard_ms),
            Self::Adaptive { silence, .. } => {
                (silence.frame_ms, silence.min_silence_ms, silence.guard_ms)
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SilenceFrameSegment {
    pub source_start_frame: usize,
    pub source_end_frame: usize,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SilenceFrameDecision {
    pub source_start_frame: usize,
    pub frames: usize,
    pub silent: bool,
    pub confident_signal: bool,
}

pub struct StreamingSilenceDetector {
    format: AudioFormat,
    config: StreamingSilenceConfig,
    frame_length: usize,
    minimum_frames: usize,
    guard_frames: usize,
    window_length: usize,
    levels: VecDeque<f64>,
    sorted_levels: Vec<f64>,
    channel_energy: Vec<f64>,
    pending_frames: usize,
    analyzed_frames: usize,
    next_frame: usize,
    silent_start: Option<usize>,
    silent: bool,
    finished: bool,
}

impl StreamingSilenceDetector {
    pub fn new(format: AudioFormat, config: StreamingSilenceConfig) -> Result<Self, AudioError> {
        AudioFormat::new(format.sample_rate, format.channels)?;
        match &config {
            StreamingSilenceConfig::Fixed(config) => config.validate()?,
            StreamingSilenceConfig::Adaptive { silence, window_ms } => {
                silence.validate()?;
                if *window_ms < silence.frame_ms {
                    return Err(AudioError::InvalidProcessor(
                        "adaptive window must contain at least one analysis frame".to_owned(),
                    ));
                }
            }
        }
        let (frame_ms, minimum_ms, guard_ms) = config.timing();
        let frame_length =
            (u64::from(format.sample_rate) * u64::from(frame_ms) / 1000).max(1) as usize;
        let window_length = match &config {
            StreamingSilenceConfig::Fixed(_) => 0,
            StreamingSilenceConfig::Adaptive { window_ms, .. } => {
                (u64::from(*window_ms) * u64::from(format.sample_rate))
                    .div_ceil(1000 * frame_length as u64) as usize
            }
        };
        Ok(Self {
            format,
            config,
            frame_length,
            minimum_frames: (u64::from(minimum_ms) * u64::from(format.sample_rate)).div_ceil(1000)
                as usize,
            guard_frames: (u64::from(guard_ms) * u64::from(format.sample_rate)).div_ceil(1000)
                as usize,
            window_length,
            levels: VecDeque::with_capacity(window_length),
            sorted_levels: Vec::with_capacity(window_length),
            channel_energy: vec![0.0; format.channels],
            pending_frames: 0,
            analyzed_frames: 0,
            next_frame: 0,
            silent_start: None,
            silent: false,
            finished: false,
        })
    }

    pub fn reset(&mut self) {
        self.levels.clear();
        self.sorted_levels.clear();
        self.channel_energy.fill(0.0);
        self.pending_frames = 0;
        self.analyzed_frames = 0;
        self.next_frame = 0;
        self.silent_start = None;
        self.silent = false;
        self.finished = false;
    }

    pub fn start(&mut self) {
        self.reset();
    }

    pub fn seek(&mut self, source_frame: usize) {
        self.reset();
        self.next_frame = source_frame;
    }

    pub fn frame_length(&self) -> usize {
        self.frame_length
    }

    pub fn warm_up_frames(&self) -> usize {
        self.window_length * self.frame_length
    }

    pub fn process(
        &mut self,
        input: &[f32],
        emit: impl FnMut(SilenceFrameSegment),
    ) -> Result<(), AudioError> {
        self.process_decisions(input, emit, |_| {})
    }

    pub fn process_frames(
        &mut self,
        input: &[f32],
        emit: impl FnMut(SilenceFrameDecision),
    ) -> Result<(), AudioError> {
        self.process_decisions(input, |_| {}, emit)
    }

    fn process_decisions(
        &mut self,
        input: &[f32],
        mut emit_segment: impl FnMut(SilenceFrameSegment),
        mut emit_frame: impl FnMut(SilenceFrameDecision),
    ) -> Result<(), AudioError> {
        ensure_active(self.finished)?;
        self.format.validate_samples(input)?;
        self.next_frame
            .checked_add(self.pending_frames)
            .and_then(|value| value.checked_add(input.len() / self.format.channels))
            .ok_or(AudioError::BufferSizeOverflow)?;
        for frame in input.chunks_exact(self.format.channels) {
            for (energy, sample) in self.channel_energy.iter_mut().zip(frame) {
                *energy += f64::from(*sample).powi(2);
            }
            self.pending_frames += 1;
            if self.pending_frames == self.frame_length {
                emit_frame(self.classify_frame(&mut emit_segment));
            }
        }
        Ok(())
    }

    pub fn finish(&mut self, mut emit: impl FnMut(SilenceFrameSegment)) {
        if self.finished {
            return;
        }
        if self.pending_frames > 0 {
            self.classify_frame(&mut emit);
        }
        self.close_silence(self.next_frame, &mut emit);
        self.finished = true;
    }

    pub fn finish_frames(&mut self, mut emit: impl FnMut(SilenceFrameDecision)) {
        if self.finished {
            return;
        }
        if self.pending_frames > 0 {
            emit(self.classify_frame(&mut |_| {}));
        }
        self.close_silence(self.next_frame, &mut |_| {});
        self.finished = true;
    }

    pub fn allocated_bytes(&self) -> usize {
        size_of::<Self>()
            + self.levels.capacity() * size_of::<f64>()
            + self.sorted_levels.capacity() * size_of::<f64>()
            + self.channel_energy.capacity() * size_of::<f64>()
    }

    fn classify_frame(
        &mut self,
        emit: &mut impl FnMut(SilenceFrameSegment),
    ) -> SilenceFrameDecision {
        self.analyzed_frames += self.pending_frames;
        let level = db_from_power(
            self.channel_energy.iter().copied().fold(0.0, f64::max) / self.pending_frames as f64,
        );
        let (silent, confident_signal) = match &self.config {
            StreamingSilenceConfig::Fixed(config) => (
                level <= config.threshold_dbfs,
                level > config.threshold_dbfs,
            ),
            StreamingSilenceConfig::Adaptive {
                silence: config, ..
            } => {
                if self.levels.len() == self.window_length {
                    self.levels.pop_front();
                }
                self.levels.push_back(level);
                self.sorted_levels.clear();
                self.sorted_levels.extend(self.levels.iter().copied());
                self.sorted_levels.sort_unstable_by(f64::total_cmp);
                let noise_floor = percentile(&self.sorted_levels, config.noise_floor_percentile);
                let high_level = percentile(&self.sorted_levels, 0.9);
                let speech_ceiling = high_level - config.speech_margin_db;
                let threshold = (noise_floor + config.threshold_offset_db)
                    .clamp(config.min_threshold_dbfs, config.max_threshold_dbfs)
                    .min(speech_ceiling);
                let exit_threshold = (threshold + config.hysteresis_db).min(speech_ceiling);
                let confident = self.analyzed_frames >= self.window_length * self.frame_length
                    && high_level.is_finite()
                    && high_level - noise_floor >= config.min_dynamic_range_db;
                (
                    confident
                        && level
                            <= if self.silent {
                                exit_threshold
                            } else {
                                threshold
                            },
                    confident
                        && level > exit_threshold
                        && level >= speech_ceiling
                        && level > config.max_threshold_dbfs,
                )
            }
        };
        if silent {
            self.silent_start.get_or_insert(self.next_frame);
        } else {
            self.close_silence(self.next_frame, emit);
        }
        let decision = SilenceFrameDecision {
            source_start_frame: self.next_frame,
            frames: self.pending_frames,
            silent,
            confident_signal,
        };
        self.silent = silent;
        self.next_frame += self.pending_frames;
        self.pending_frames = 0;
        self.channel_energy.fill(0.0);
        decision
    }

    fn close_silence(&mut self, end: usize, emit: &mut impl FnMut(SilenceFrameSegment)) {
        if let Some(start) = self.silent_start.take() {
            let guarded_start = start.saturating_add(self.guard_frames).min(end);
            let guarded_end = end.saturating_sub(self.guard_frames).max(guarded_start);
            if end - start >= self.minimum_frames && guarded_end > guarded_start {
                emit(SilenceFrameSegment {
                    source_start_frame: guarded_start,
                    source_end_frame: guarded_end,
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streaming_analyzers_keep_fixed_storage_over_long_input() {
        let format = AudioFormat::new(48_000, 1).unwrap();
        let mut loudness = StreamingLoudnessAnalyzer::new(format).unwrap();
        let mut silence = StreamingSilenceDetector::new(
            format,
            StreamingSilenceConfig::Adaptive {
                silence: AdaptiveSilenceConfig::default(),
                window_ms: 1000,
            },
        )
        .unwrap();
        let energy_capacity = loudness.energies.capacity();
        let histogram_capacity = loudness.histogram.capacity();
        let level_capacity = silence.levels.capacity();
        let sorted_capacity = silence.sorted_levels.capacity();
        let chunk = [0.01; 480];
        for _ in 0..10_000 {
            loudness.process(&chunk).unwrap();
            silence.process(&chunk, |_| {}).unwrap();
            assert!(loudness.energies.len() <= loudness.block_length);
            assert_eq!(loudness.energies.capacity(), energy_capacity);
            assert_eq!(loudness.histogram.capacity(), histogram_capacity);
            assert!(silence.levels.len() <= silence.window_length);
            assert_eq!(silence.levels.capacity(), level_capacity);
            assert_eq!(silence.sorted_levels.capacity(), sorted_capacity);
        }
        assert_eq!(loudness.finish().frames, 4_800_000);
        silence.finish(|_| {});
    }

    fn sine(amplitude: f32, frames: usize) -> PcmAudio {
        let samples = (0..frames)
            .map(|frame| {
                amplitude * (2.0 * std::f32::consts::PI * 997.0 * frame as f32 / 48_000.0).sin()
            })
            .collect();
        PcmAudio::new(48_000, 1, samples).unwrap()
    }

    #[test]
    fn loudness_changes_with_signal_level() {
        let quiet = integrated_lufs(&sine(0.1, 48_000));
        let loud = integrated_lufs(&sine(0.2, 48_000));
        assert!((loud - quiet - 6.0206).abs() < 0.1, "{quiet} {loud}");
    }

    #[test]
    fn silence_detector_requires_the_minimum_duration() {
        let mut samples = vec![0.0; 48_000];
        for sample in &mut samples[0..4_800] {
            *sample = 0.1;
        }
        for sample in &mut samples[24_000..] {
            *sample = 0.1;
        }
        let audio = PcmAudio::new(48_000, 1, samples).unwrap();
        let config = SilenceConfig {
            frame_ms: 10,
            min_silence_ms: 300,
            threshold_dbfs: -40.0,
            guard_ms: 0,
        };
        let segments = detect_silence(&audio, &config).unwrap();
        assert_eq!(segments.len(), 1);
        assert!((segments[0].start_seconds - 0.1).abs() < 0.001);
        assert!((segments[0].end_seconds - 0.5).abs() < 0.001);
    }

    #[test]
    fn oversampled_peak_is_not_below_sample_peak() {
        let audio = sine(0.75, 48_000);
        assert!(oversampled_peak(&audio) + 0.000_001 >= sample_peak(&audio));
    }

    #[test]
    fn adaptive_detector_follows_a_noise_floor() {
        let mut samples = Vec::new();
        for frame in 0..48_000 / 2 {
            samples
                .push(0.0005 * (2.0 * std::f32::consts::PI * 37.0 * frame as f32 / 48_000.0).sin());
        }
        samples.extend((0..48_000).map(|frame| {
            0.1 * (2.0 * std::f32::consts::PI * 997.0 * frame as f32 / 48_000.0).sin()
        }));
        for frame in 0..48_000 / 2 {
            samples
                .push(0.0005 * (2.0 * std::f32::consts::PI * 53.0 * frame as f32 / 48_000.0).sin());
        }
        let audio = PcmAudio::new(48_000, 1, samples).unwrap();
        let config = AdaptiveSilenceConfig {
            guard_ms: 0,
            ..AdaptiveSilenceConfig::default()
        };
        let segments = detect_adaptive_silence(&audio, &config).unwrap();
        assert_eq!(segments.len(), 2);
        assert!((segments[0].start_seconds - 0.0).abs() < 0.001);
        assert!((segments[0].end_seconds - 0.5).abs() < 0.011);
        assert!((segments[1].start_seconds - 1.5).abs() < 0.011);
        assert!((segments[1].end_seconds - 2.0).abs() < 0.001);
    }

    #[test]
    fn adaptive_detector_does_not_trim_uniform_quiet_audio() {
        let audio = sine(0.01, 48_000 * 2);
        assert!(
            detect_adaptive_silence(&audio, &AdaptiveSilenceConfig::default())
                .unwrap()
                .is_empty()
        );
    }
}
