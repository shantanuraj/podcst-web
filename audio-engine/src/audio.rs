use std::fmt;

#[derive(Clone, Debug, PartialEq)]
pub struct PcmAudio {
    sample_rate: u32,
    channels: usize,
    samples: Vec<f32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AudioError {
    InvalidSampleRate,
    InvalidChannelCount,
    MisalignedSamples { samples: usize, channels: usize },
    NonFiniteSample { index: usize },
    InvalidWav(String),
    UnsupportedWav(String),
    Io(String),
}

impl fmt::Display for AudioError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidSampleRate => write!(formatter, "sample rate must be greater than zero"),
            Self::InvalidChannelCount => {
                write!(formatter, "channel count must be greater than zero")
            }
            Self::MisalignedSamples { samples, channels } => write!(
                formatter,
                "sample count ({samples}) is not divisible by channel count ({channels})",
            ),
            Self::NonFiniteSample { index } => write!(formatter, "sample {index} is not finite"),
            Self::InvalidWav(message) => write!(formatter, "invalid WAV: {message}"),
            Self::UnsupportedWav(message) => write!(formatter, "unsupported WAV: {message}"),
            Self::Io(message) => write!(formatter, "I/O error: {message}"),
        }
    }
}

impl std::error::Error for AudioError {}

impl PcmAudio {
    pub fn new(sample_rate: u32, channels: usize, samples: Vec<f32>) -> Result<Self, AudioError> {
        if sample_rate == 0 {
            return Err(AudioError::InvalidSampleRate);
        }
        if channels == 0 {
            return Err(AudioError::InvalidChannelCount);
        }
        if samples.len() % channels != 0 {
            return Err(AudioError::MisalignedSamples {
                samples: samples.len(),
                channels,
            });
        }
        if let Some(index) = samples.iter().position(|sample| !sample.is_finite()) {
            return Err(AudioError::NonFiniteSample { index });
        }
        Ok(Self {
            sample_rate,
            channels,
            samples,
        })
    }

    pub fn silence(sample_rate: u32, channels: usize, frames: usize) -> Result<Self, AudioError> {
        Self::new(sample_rate, channels, vec![0.0; frames * channels])
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn channels(&self) -> usize {
        self.channels
    }

    pub fn frames(&self) -> usize {
        self.samples.len() / self.channels
    }

    pub fn duration_seconds(&self) -> f64 {
        self.frames() as f64 / self.sample_rate as f64
    }

    pub fn samples(&self) -> &[f32] {
        &self.samples
    }

    pub fn samples_mut(&mut self) -> &mut [f32] {
        &mut self.samples
    }

    pub fn frame(&self, frame: usize) -> Option<&[f32]> {
        let start = frame.checked_mul(self.channels)?;
        self.samples.get(start..start + self.channels)
    }
}
