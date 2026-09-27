#![allow(clippy::missing_safety_doc)]

use std::mem::{align_of, size_of};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::ptr::NonNull;
use std::slice;

use crate::{AudioError, AudioFormat, LimiterConfig, PcmProcessor, StreamingProcessor};

pub const PODCST_AUDIO_OK: u32 = 0;
pub const PODCST_AUDIO_OUTPUT_FULL: u32 = 1;
pub const PODCST_AUDIO_FINISHED: u32 = 2;
pub const PODCST_AUDIO_INVALID_ARGUMENT: u32 = 3;
pub const PODCST_AUDIO_INVALID_CONFIG: u32 = 4;
pub const PODCST_AUDIO_INVALID_STATE: u32 = 5;
pub const PODCST_AUDIO_INTERNAL_ERROR: u32 = 6;
pub const PODCST_AUDIO_MAX_BLOCK_FRAMES: u32 = 8192;

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct PodcstAudioConfig {
    pub sample_rate: u32,
    pub channels: u32,
    pub gain_db: f32,
    pub limiter_enabled: u32,
    pub lookahead_ms: f32,
    pub ceiling_dbfs: f32,
    pub release_ms: f32,
}

impl Default for PodcstAudioConfig {
    fn default() -> Self {
        Self {
            sample_rate: 48_000,
            channels: 2,
            gain_db: 0.0,
            limiter_enabled: 0,
            lookahead_ms: 5.0,
            ceiling_dbfs: -1.0,
            release_ms: 50.0,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PodcstAudioReport {
    pub consumed_frames: u32,
    pub emitted_frames: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct PodcstAudioInfo {
    pub latency_frames: u32,
    pub max_block_frames: u32,
    pub allocated_bytes: u64,
}

pub struct PodcstAudioProcessor {
    processor: PcmProcessor,
    poisoned: bool,
}

#[derive(Clone, Copy)]
struct Region {
    start: usize,
    end: usize,
}

impl Region {
    fn new<T>(pointer: *const T, count: usize) -> Result<Self, u32> {
        if count == 0 {
            return Ok(Self { start: 0, end: 0 });
        }
        let start = pointer as usize;
        if start == 0 || start % align_of::<T>() != 0 {
            return Err(PODCST_AUDIO_INVALID_ARGUMENT);
        }
        let bytes = count
            .checked_mul(size_of::<T>())
            .filter(|bytes| *bytes <= isize::MAX as usize)
            .ok_or(PODCST_AUDIO_INVALID_ARGUMENT)?;
        let end = start
            .checked_add(bytes)
            .ok_or(PODCST_AUDIO_INVALID_ARGUMENT)?;
        Ok(Self { start, end })
    }

    fn overlaps(self, other: Self) -> bool {
        self.start < other.end && other.start < self.end
    }
}

fn separate(regions: &[Region]) -> Result<(), u32> {
    for (index, region) in regions.iter().enumerate() {
        if regions[..index].iter().any(|other| region.overlaps(*other)) {
            return Err(PODCST_AUDIO_INVALID_ARGUMENT);
        }
    }
    Ok(())
}

fn guarded(work: impl FnOnce() -> Result<u32, u32>) -> u32 {
    catch_unwind(AssertUnwindSafe(work))
        .unwrap_or(Err(PODCST_AUDIO_INTERNAL_ERROR))
        .unwrap_or_else(|status| status)
}

fn audio_error(error: AudioError) -> u32 {
    match error {
        AudioError::ProcessingFinished => PODCST_AUDIO_INVALID_STATE,
        _ => PODCST_AUDIO_INVALID_ARGUMENT,
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn podcst_audio_config_default(config: *mut PodcstAudioConfig) -> u32 {
    guarded(|| {
        Region::new(config, 1)?;
        unsafe { config.write(PodcstAudioConfig::default()) };
        Ok(PODCST_AUDIO_OK)
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn podcst_audio_create(
    config: *const PodcstAudioConfig,
    handle: *mut *mut PodcstAudioProcessor,
) -> u32 {
    guarded(|| {
        separate(&[Region::new(config, 1)?, Region::new(handle, 1)?])?;
        if !unsafe { handle.read() }.is_null() {
            return Err(PODCST_AUDIO_INVALID_ARGUMENT);
        }
        let config = unsafe { config.read() };
        if config.limiter_enabled > 1
            || !(0.0..=100.0).contains(&config.lookahead_ms)
            || !(-24.0..=0.0).contains(&config.ceiling_dbfs)
            || !(0.0..=5_000.0).contains(&config.release_ms)
        {
            return Err(PODCST_AUDIO_INVALID_CONFIG);
        }
        let limiter = LimiterConfig {
            lookahead_ms: f64::from(config.lookahead_ms),
            ceiling_dbfs: f64::from(config.ceiling_dbfs),
            release_ms: f64::from(config.release_ms),
        };
        let processor = PcmProcessor::new(
            AudioFormat {
                sample_rate: config.sample_rate,
                channels: config.channels as usize,
            },
            f64::from(config.gain_db),
            (config.limiter_enabled == 1).then_some(&limiter),
        )
        .map_err(|_| PODCST_AUDIO_INVALID_CONFIG)?;
        unsafe {
            handle.write(Box::into_raw(Box::new(PodcstAudioProcessor {
                processor,
                poisoned: false,
            })))
        };
        Ok(PODCST_AUDIO_OK)
    })
}

unsafe fn with_processor(
    handle: *mut PodcstAudioProcessor,
    work: impl FnOnce(&mut PcmProcessor) -> Result<u32, u32>,
) -> u32 {
    let handle = unsafe { &mut *handle };
    if handle.poisoned {
        return PODCST_AUDIO_INVALID_STATE;
    }
    match catch_unwind(AssertUnwindSafe(|| work(&mut handle.processor))) {
        Ok(result) => result.unwrap_or_else(|status| status),
        Err(_) => {
            handle.poisoned = true;
            PODCST_AUDIO_INTERNAL_ERROR
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn podcst_audio_process(
    handle: *mut PodcstAudioProcessor,
    input: *const f32,
    input_frames: u32,
    output: *mut f32,
    output_capacity_frames: u32,
    report: *mut PodcstAudioReport,
) -> u32 {
    guarded(|| {
        let handle_region = Region::new(handle, 1)?;
        let report_region = Region::new(report, 1)?;
        separate(&[handle_region, report_region])?;
        if input_frames > PODCST_AUDIO_MAX_BLOCK_FRAMES
            || output_capacity_frames > PODCST_AUDIO_MAX_BLOCK_FRAMES
        {
            return Err(PODCST_AUDIO_INVALID_ARGUMENT);
        }
        let channels = unsafe { (*handle).processor.format().channels };
        let input_samples = input_frames as usize * channels;
        let output_samples = output_capacity_frames as usize * channels;
        separate(&[
            handle_region,
            report_region,
            Region::new(input, input_samples)?,
            Region::new(output, output_samples)?,
        ])?;
        let input = if input_samples == 0 {
            NonNull::<f32>::dangling().as_ptr()
        } else {
            input
        };
        let output = if output_samples == 0 {
            NonNull::<f32>::dangling().as_ptr()
        } else {
            output
        };
        Ok(unsafe {
            with_processor(handle, |processor| {
                let input = slice::from_raw_parts(input, input_samples);
                let output = slice::from_raw_parts_mut(output, output_samples);
                let result = processor.process(input, output).map_err(audio_error)?;
                report.write(PodcstAudioReport {
                    consumed_frames: result.input_frames as u32,
                    emitted_frames: result.output_frames as u32,
                });
                Ok(if result.input_frames == input_frames as usize {
                    PODCST_AUDIO_OK
                } else {
                    PODCST_AUDIO_OUTPUT_FULL
                })
            })
        })
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn podcst_audio_finish(
    handle: *mut PodcstAudioProcessor,
    output: *mut f32,
    output_capacity_frames: u32,
    report: *mut PodcstAudioReport,
) -> u32 {
    guarded(|| {
        let handle_region = Region::new(handle, 1)?;
        let report_region = Region::new(report, 1)?;
        separate(&[handle_region, report_region])?;
        if output_capacity_frames > PODCST_AUDIO_MAX_BLOCK_FRAMES {
            return Err(PODCST_AUDIO_INVALID_ARGUMENT);
        }
        let output_samples =
            output_capacity_frames as usize * unsafe { (*handle).processor.format().channels };
        separate(&[
            handle_region,
            report_region,
            Region::new(output, output_samples)?,
        ])?;
        let output = if output_samples == 0 {
            NonNull::<f32>::dangling().as_ptr()
        } else {
            output
        };
        Ok(unsafe {
            with_processor(handle, |processor| {
                let output = slice::from_raw_parts_mut(output, output_samples);
                let result = processor.finish(output).map_err(audio_error)?;
                report.write(PodcstAudioReport {
                    consumed_frames: 0,
                    emitted_frames: result.output_frames as u32,
                });
                Ok(if processor.is_finished() {
                    PODCST_AUDIO_FINISHED
                } else {
                    PODCST_AUDIO_OUTPUT_FULL
                })
            })
        })
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn podcst_audio_reset(handle: *mut PodcstAudioProcessor) -> u32 {
    guarded(|| {
        Region::new(handle, 1)?;
        Ok(unsafe {
            with_processor(handle, |processor| {
                processor.reset();
                Ok(PODCST_AUDIO_OK)
            })
        })
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn podcst_audio_get_info(
    handle: *mut PodcstAudioProcessor,
    info: *mut PodcstAudioInfo,
) -> u32 {
    guarded(|| {
        separate(&[Region::new(handle, 1)?, Region::new(info, 1)?])?;
        Ok(unsafe {
            with_processor(handle, |processor| {
                info.write(PodcstAudioInfo {
                    latency_frames: processor.latency_frames() as u32,
                    max_block_frames: PODCST_AUDIO_MAX_BLOCK_FRAMES,
                    allocated_bytes: (processor.allocated_bytes()
                        + size_of::<PodcstAudioProcessor>()
                        - size_of::<PcmProcessor>()) as u64,
                });
                Ok(PODCST_AUDIO_OK)
            })
        })
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn podcst_audio_destroy(handle: *mut *mut PodcstAudioProcessor) -> u32 {
    guarded(|| {
        let slot = Region::new(handle, 1)?;
        let processor = unsafe { handle.read() };
        if processor.is_null() {
            return Ok(PODCST_AUDIO_OK);
        }
        separate(&[slot, Region::new(processor, 1)?])?;
        unsafe {
            handle.write(std::ptr::null_mut());
            drop(Box::from_raw(processor));
        }
        Ok(PODCST_AUDIO_OK)
    })
}
