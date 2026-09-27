use std::cmp::Reverse;
use std::collections::BinaryHeap;

use crate::audio::PcmAudio;

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
}

impl Default for AdaptiveSilenceConfig {
    fn default() -> Self {
        Self {
            frame_ms: 10,
            min_silence_ms: 300,
            guard_ms: 20,
            noise_floor_percentile: 0.1,
            threshold_offset_db: 8.0,
            min_threshold_dbfs: -50.0,
            max_threshold_dbfs: -35.0,
            min_dynamic_range_db: 12.0,
        }
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

pub fn analyze(audio: &PcmAudio, config: &AnalysisConfig) -> AudioMetrics {
    AudioMetrics {
        sample_rate: audio.sample_rate(),
        channels: audio.channels(),
        frames: audio.frames(),
        duration_seconds: audio.duration_seconds(),
        rms_dbfs: rms_dbfs(audio),
        sample_peak_dbfs: db_from_amplitude(sample_peak(audio)),
        oversampled_peak_dbfs: db_from_amplitude(oversampled_peak(audio)),
        integrated_lufs: integrated_lufs(audio),
        silence_segments: detect_silence(audio, &config.silence),
    }
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

pub fn detect_silence(audio: &PcmAudio, config: &SilenceConfig) -> Vec<SilenceSegment> {
    if config.frame_ms == 0 {
        return Vec::new();
    }
    let (frame_length, levels) = frame_levels(audio, config.frame_ms);
    let mask = levels
        .iter()
        .map(|level| *level <= config.threshold_dbfs)
        .collect::<Vec<_>>();
    silence_segments_from_mask(
        audio,
        frame_length,
        config.min_silence_ms,
        config.guard_ms,
        &mask,
    )
}

pub fn detect_adaptive_silence(
    audio: &PcmAudio,
    config: &AdaptiveSilenceConfig,
) -> Vec<SilenceSegment> {
    if audio.frames() == 0
        || config.frame_ms == 0
        || config.min_silence_ms == 0
        || !(0.0..=1.0).contains(&config.noise_floor_percentile)
        || !config.threshold_offset_db.is_finite()
        || !config.min_threshold_dbfs.is_finite()
        || !config.max_threshold_dbfs.is_finite()
        || !config.min_dynamic_range_db.is_finite()
    {
        return Vec::new();
    }
    let (frame_length, levels) = frame_levels(audio, config.frame_ms);
    let mut finite_levels = levels
        .iter()
        .copied()
        .filter(|level| level.is_finite())
        .collect::<Vec<_>>();
    if finite_levels.is_empty() {
        return Vec::new();
    }
    finite_levels.sort_by(f64::total_cmp);
    let noise_floor = percentile(&finite_levels, config.noise_floor_percentile);
    let high_level = percentile(&finite_levels, 0.9);
    if high_level - noise_floor < config.min_dynamic_range_db {
        return Vec::new();
    }
    let threshold = (noise_floor + config.threshold_offset_db)
        .clamp(config.min_threshold_dbfs, config.max_threshold_dbfs);
    let mask = levels
        .iter()
        .map(|level| *level <= threshold)
        .collect::<Vec<_>>();
    silence_segments_from_mask(
        audio,
        frame_length,
        config.min_silence_ms,
        config.guard_ms,
        &mask,
    )
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
        let power = audio.samples()[frame_start * audio.channels()..frame_end * audio.channels()]
            .iter()
            .map(|sample| f64::from(*sample) * f64::from(*sample))
            .sum::<f64>()
            / ((frame_end - frame_start) * audio.channels()) as f64;
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
    let minimum_frames = minimum_samples.max(1).div_ceil(frame_length);
    let guard_frames =
        (u64::from(guard_ms) * u64::from(audio.sample_rate()) / 1_000) as usize / frame_length;
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
                frame_length,
                minimum_frames,
                guard_frames,
                audio,
            );
        }
    }
    if let Some(start) = silent_start {
        append_silence_segment(
            &mut segments,
            start,
            audio.frames(),
            frame_length,
            minimum_frames,
            guard_frames,
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
    frame_length: usize,
    minimum_frames: usize,
    guard_frames: usize,
    audio: &PcmAudio,
) {
    let frame_count = (end - start).div_ceil(frame_length);
    if frame_count < minimum_frames {
        return;
    }
    let guarded_start = (start + guard_frames * frame_length).min(end);
    let guarded_end = end
        .saturating_sub(guard_frames * frame_length)
        .max(guarded_start);
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

#[cfg(test)]
mod tests {
    use super::*;

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
        let segments = detect_silence(&audio, &config);
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
        let segments = detect_adaptive_silence(&audio, &config);
        assert_eq!(segments.len(), 2);
        assert!((segments[0].start_seconds - 0.0).abs() < 0.001);
        assert!((segments[0].end_seconds - 0.5).abs() < 0.011);
        assert!((segments[1].start_seconds - 1.5).abs() < 0.011);
        assert!((segments[1].end_seconds - 2.0).abs() < 0.001);
    }

    #[test]
    fn adaptive_detector_does_not_trim_uniform_quiet_audio() {
        let audio = sine(0.01, 48_000 * 2);
        assert!(detect_adaptive_silence(&audio, &AdaptiveSilenceConfig::default()).is_empty());
    }
}
