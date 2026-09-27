use std::fs;
use std::path::Path;

use crate::audio::{AudioError, PcmAudio};

pub fn read_wav(path: impl AsRef<Path>) -> Result<PcmAudio, AudioError> {
    let path = path.as_ref();
    let bytes =
        fs::read(path).map_err(|error| AudioError::Io(format!("{}: {error}", path.display())))?;
    decode_wav(&bytes)
}

pub fn write_wav(path: impl AsRef<Path>, audio: &PcmAudio) -> Result<(), AudioError> {
    let path = path.as_ref();
    let bytes = encode_wav(audio)?;
    fs::write(path, bytes).map_err(|error| AudioError::Io(format!("{}: {error}", path.display())))
}

fn decode_wav(bytes: &[u8]) -> Result<PcmAudio, AudioError> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(AudioError::InvalidWav(
            "missing RIFF/WAVE header".to_owned(),
        ));
    }

    let mut offset = 12;
    let mut format = None;
    let mut data = None;
    while offset + 8 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size = read_u32(bytes, offset + 4)? as usize;
        let start = offset + 8;
        let end = start
            .checked_add(size)
            .ok_or_else(|| AudioError::InvalidWav("chunk size overflows file".to_owned()))?;
        if end > bytes.len() {
            return Err(AudioError::InvalidWav(
                "chunk extends past end of file".to_owned(),
            ));
        }
        match id {
            b"fmt " => format = Some(parse_format(&bytes[start..end])?),
            b"data" if data.is_none() => data = Some(&bytes[start..end]),
            _ => {}
        }
        offset = end + (size & 1);
    }

    let format = format.ok_or_else(|| AudioError::InvalidWav("missing fmt chunk".to_owned()))?;
    let data = data.ok_or_else(|| AudioError::InvalidWav("missing data chunk".to_owned()))?;
    let bytes_per_sample = usize::from(format.bits_per_sample / 8);
    if bytes_per_sample == 0 || format.block_align != format.channels as usize * bytes_per_sample {
        return Err(AudioError::InvalidWav(
            "inconsistent sample alignment".to_owned(),
        ));
    }
    if data.len() % format.block_align != 0 {
        return Err(AudioError::InvalidWav(
            "data is not frame-aligned".to_owned(),
        ));
    }

    let mut samples = Vec::with_capacity(data.len() / bytes_per_sample);
    for chunk in data.chunks_exact(bytes_per_sample) {
        let sample = match (format.audio_format, format.bits_per_sample) {
            (1, 8) => (f32::from(chunk[0]) - 128.0) / 128.0,
            (1, 16) => i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / 32_768.0,
            (1, 24) => signed_24(chunk) as f32 / 8_388_608.0,
            (1, 32) => {
                i32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]) as f32
                    / 2_147_483_648.0
            }
            (3, 32) => f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]),
            (3, 64) => f64::from_le_bytes([
                chunk[0], chunk[1], chunk[2], chunk[3], chunk[4], chunk[5], chunk[6], chunk[7],
            ]) as f32,
            (format, bits) => {
                return Err(AudioError::UnsupportedWav(format!(
                    "format {format} with {bits}-bit samples"
                )));
            }
        };
        if !sample.is_finite() {
            return Err(AudioError::InvalidWav("sample is not finite".to_owned()));
        }
        samples.push(sample);
    }

    PcmAudio::new(format.sample_rate, format.channels as usize, samples)
}

fn encode_wav(audio: &PcmAudio) -> Result<Vec<u8>, AudioError> {
    let data_size = audio
        .samples()
        .len()
        .checked_mul(2)
        .ok_or_else(|| AudioError::InvalidWav("encoded data is too large".to_owned()))?;
    let riff_size = 36usize
        .checked_add(data_size)
        .ok_or_else(|| AudioError::InvalidWav("WAV is too large".to_owned()))?;
    if riff_size > u32::MAX as usize || data_size > u32::MAX as usize {
        return Err(AudioError::InvalidWav("WAV is too large".to_owned()));
    }
    if audio.channels() > u16::MAX as usize {
        return Err(AudioError::InvalidWav(
            "WAV format fields overflow".to_owned(),
        ));
    }

    let channels = audio.channels() as u16;
    let block_align = channels * 2;
    let byte_rate = audio.sample_rate() * u32::from(block_align);
    let mut output = Vec::with_capacity(44 + data_size);
    output.extend_from_slice(b"RIFF");
    output.extend_from_slice(&(riff_size as u32).to_le_bytes());
    output.extend_from_slice(b"WAVE");
    output.extend_from_slice(b"fmt ");
    output.extend_from_slice(&16u32.to_le_bytes());
    output.extend_from_slice(&1u16.to_le_bytes());
    output.extend_from_slice(&channels.to_le_bytes());
    output.extend_from_slice(&audio.sample_rate().to_le_bytes());
    output.extend_from_slice(&byte_rate.to_le_bytes());
    output.extend_from_slice(&block_align.to_le_bytes());
    output.extend_from_slice(&16u16.to_le_bytes());
    output.extend_from_slice(b"data");
    output.extend_from_slice(&(data_size as u32).to_le_bytes());
    for sample in audio.samples() {
        let sample = sample.clamp(-1.0, 1.0);
        let scaled = if sample < 0.0 {
            (sample * 32_768.0).round() as i16
        } else {
            (sample * 32_767.0).round() as i16
        };
        output.extend_from_slice(&scaled.to_le_bytes());
    }
    Ok(output)
}

#[derive(Clone, Copy)]
struct WavFormat {
    audio_format: u16,
    channels: u16,
    sample_rate: u32,
    block_align: usize,
    bits_per_sample: u16,
}

fn parse_format(bytes: &[u8]) -> Result<WavFormat, AudioError> {
    if bytes.len() < 16 {
        return Err(AudioError::InvalidWav("fmt chunk is too short".to_owned()));
    }
    let audio_format = read_u16(bytes, 0)?;
    let channels = read_u16(bytes, 2)?;
    let sample_rate = read_u32(bytes, 4)?;
    let block_align = usize::from(read_u16(bytes, 12)?);
    let bits_per_sample = read_u16(bytes, 14)?;
    if channels == 0 || sample_rate == 0 {
        return Err(AudioError::InvalidWav(
            "invalid channels or sample rate".to_owned(),
        ));
    }
    if !matches!(
        (audio_format, bits_per_sample),
        (1, 8 | 16 | 24 | 32) | (3, 32 | 64)
    ) {
        return Err(AudioError::UnsupportedWav(format!(
            "format {audio_format} with {bits_per_sample}-bit samples"
        )));
    }
    Ok(WavFormat {
        audio_format,
        channels,
        sample_rate,
        block_align,
        bits_per_sample,
    })
}

fn signed_24(bytes: &[u8]) -> i32 {
    let value = i32::from(bytes[0]) | (i32::from(bytes[1]) << 8) | (i32::from(bytes[2]) << 16);
    if value & 0x0080_0000 != 0 {
        value | !0x00ff_ffff
    } else {
        value
    }
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, AudioError> {
    let bytes = bytes
        .get(offset..offset + 2)
        .ok_or_else(|| AudioError::InvalidWav("truncated chunk".to_owned()))?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, AudioError> {
    let bytes = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| AudioError::InvalidWav("truncated chunk".to_owned()))?;
    Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_pcm_samples_with_expected_16_bit_quantization() {
        let audio = PcmAudio::new(48_000, 2, vec![-1.0, -0.25, 0.25, 1.0]).unwrap();
        let encoded = encode_wav(&audio).unwrap();
        let decoded = decode_wav(&encoded).unwrap();
        assert_eq!(decoded.sample_rate(), 48_000);
        assert_eq!(decoded.channels(), 2);
        assert_eq!(decoded.samples(), &[-1.0, -0.25, 0.25, 0.9999695]);
    }
}
