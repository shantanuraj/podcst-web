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
    if audio.frames() == 0 {
        return 0.0;
    }
    let mut peak = sample_peak(audio);
    for frame in 0..audio.frames() {
        for phase in 1..4 {
            let position = frame as f64 + f64::from(phase) / 4.0;
            for channel in 0..audio.channels() {
                peak = peak.max(interpolated_sample(audio, position, channel).abs());
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
    if audio.frames() == 0 || config.frame_ms == 0 || config.min_silence_ms == 0 {
        return Vec::new();
    }
    let frame_length =
        ((u64::from(audio.sample_rate()) * u64::from(config.frame_ms)) / 1000).max(1) as usize;
    let minimum_frames = ((u64::from(config.min_silence_ms) + u64::from(config.frame_ms) - 1)
        / u64::from(config.frame_ms)) as usize;
    let guard_frames = (u64::from(config.guard_ms) / u64::from(config.frame_ms)) as usize;
    let mut segments = Vec::new();
    let mut silent_start = None;
    let total_frames = audio.frames();

    let mut frame_start = 0;
    while frame_start < total_frames {
        let frame_end = (frame_start + frame_length).min(total_frames);
        let power = audio.samples()[frame_start * audio.channels()..frame_end * audio.channels()]
            .iter()
            .map(|sample| f64::from(*sample) * f64::from(*sample))
            .sum::<f64>()
            / ((frame_end - frame_start) * audio.channels()) as f64;
        let is_silent = db_from_power(power) <= config.threshold_dbfs;
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
        frame_start = frame_end;
    }
    if let Some(start) = silent_start {
        append_silence_segment(
            &mut segments,
            start,
            total_frames,
            frame_length,
            minimum_frames,
            guard_frames,
            audio,
        );
    }
    segments
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

fn interpolated_sample(audio: &PcmAudio, position: f64, channel: usize) -> f32 {
    const RADIUS: i32 = 16;
    let center = position.floor() as i32;
    let mut result = 0.0;
    let mut weight_sum = 0.0;
    for offset in -RADIUS + 1..=RADIUS {
        let frame = center + offset;
        if frame < 0 || frame >= audio.frames() as i32 {
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
        result += f64::from(audio.samples()[frame as usize * audio.channels() + channel]) * weight;
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
}
