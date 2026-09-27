use std::fs;
use std::path::{Path, PathBuf};

use crate::audio::{AudioError, PcmAudio};
use crate::wav::write_wav;

pub const FIXTURE_SAMPLE_RATE: u32 = 48_000;

pub fn generate_fixtures(directory: impl AsRef<Path>) -> Result<Vec<PathBuf>, AudioError> {
    let directory = directory.as_ref();
    fs::create_dir_all(directory)
        .map_err(|error| AudioError::Io(format!("{}: {error}", directory.display())))?;
    let fixtures = [
        ("quiet-and-loud-tone.wav", quiet_and_loud_tone()),
        ("speech-gaps.wav", speech_gaps()),
        ("stereo-phase.wav", stereo_phase()),
    ];
    let mut paths = Vec::with_capacity(fixtures.len());
    for (name, audio) in fixtures {
        let path = directory.join(name);
        write_wav(&path, &audio)?;
        paths.push(path);
    }
    Ok(paths)
}

fn quiet_and_loud_tone() -> PcmAudio {
    let mut samples = Vec::with_capacity(FIXTURE_SAMPLE_RATE as usize * 6);
    append_sine(&mut samples, 0.05, 440.0, 2.0, 0.0);
    append_silence(&mut samples, 2.0);
    append_sine(&mut samples, 0.35, 440.0, 2.0, 2.0);
    PcmAudio::new(FIXTURE_SAMPLE_RATE, 1, samples).expect("fixture is valid")
}

fn speech_gaps() -> PcmAudio {
    let mut samples = Vec::with_capacity(FIXTURE_SAMPLE_RATE as usize * 8);
    append_silence(&mut samples, 1.0);
    append_speech_like(&mut samples, 2.0, 0.12, 0.0);
    append_silence(&mut samples, 0.65);
    append_speech_like(&mut samples, 1.5, 0.2, 2.0);
    append_silence(&mut samples, 1.0);
    append_speech_like(&mut samples, 1.25, 0.08, 3.5);
    append_silence(&mut samples, 0.5);
    PcmAudio::new(FIXTURE_SAMPLE_RATE, 1, samples).expect("fixture is valid")
}

fn stereo_phase() -> PcmAudio {
    let frames = FIXTURE_SAMPLE_RATE as usize * 3;
    let mut samples = Vec::with_capacity(frames * 2);
    for frame in 0..frames {
        let time = frame as f32 / FIXTURE_SAMPLE_RATE as f32;
        let left = 0.25 * (2.0 * std::f32::consts::PI * 220.0 * time).sin();
        let right = 0.25 * (2.0 * std::f32::consts::PI * 330.0 * time).sin();
        samples.extend([left, right]);
    }
    PcmAudio::new(FIXTURE_SAMPLE_RATE, 2, samples).expect("fixture is valid")
}

fn append_sine(samples: &mut Vec<f32>, amplitude: f32, frequency: f32, seconds: f32, offset: f32) {
    let frames = (seconds * FIXTURE_SAMPLE_RATE as f32).round() as usize;
    for frame in 0..frames {
        let time = offset + frame as f32 / FIXTURE_SAMPLE_RATE as f32;
        samples.push(amplitude * (2.0 * std::f32::consts::PI * frequency * time).sin());
    }
}

fn append_speech_like(samples: &mut Vec<f32>, seconds: f32, amplitude: f32, offset: f32) {
    let frames = (seconds * FIXTURE_SAMPLE_RATE as f32).round() as usize;
    let burst_frames = FIXTURE_SAMPLE_RATE as usize / 5;
    for frame in 0..frames {
        let time = offset + frame as f32 / FIXTURE_SAMPLE_RATE as f32;
        let burst = 0.35 + 0.65 * ((frame / burst_frames) % 2) as f32;
        let envelope = (std::f32::consts::PI * (frame % (FIXTURE_SAMPLE_RATE as usize / 4)) as f32
            / (FIXTURE_SAMPLE_RATE as usize / 4) as f32)
            .sin()
            .abs();
        let carrier = (2.0 * std::f32::consts::PI * 180.0 * time).sin();
        let overtone = 0.35 * (2.0 * std::f32::consts::PI * 510.0 * time).sin();
        samples.push(amplitude * burst * (0.25 + 0.75 * envelope) * (carrier + overtone));
    }
}

fn append_silence(samples: &mut Vec<f32>, seconds: f32) {
    let frames = (seconds * FIXTURE_SAMPLE_RATE as f32).round() as usize;
    samples.resize(samples.len() + frames, 0.0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_fixtures_have_stable_lengths() {
        assert_eq!(
            quiet_and_loud_tone().frames(),
            6 * FIXTURE_SAMPLE_RATE as usize
        );
        assert_eq!(
            speech_gaps().frames(),
            7_900 * FIXTURE_SAMPLE_RATE as usize / 1_000
        );
        assert_eq!(stereo_phase().channels(), 2);
    }
}
