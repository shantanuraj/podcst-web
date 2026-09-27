use std::ptr;

use podcst_audio_engine::ffi::*;
use podcst_audio_engine::{
    AudioFormat, GainProcessor, LimiterConfig, PcmAudio, TruePeakLimiter, process_streaming,
};

struct Native(*mut PodcstAudioProcessor);

impl Native {
    fn new(config: PodcstAudioConfig) -> Self {
        let mut handle = ptr::null_mut();
        assert_eq!(
            unsafe { podcst_audio_create(&config, &mut handle) },
            PODCST_AUDIO_OK
        );
        assert!(!handle.is_null());
        Self(handle)
    }

    fn process(
        &mut self,
        samples: &[f32],
        output: &mut [f32],
        channels: usize,
    ) -> (u32, PodcstAudioReport) {
        let mut report = PodcstAudioReport::default();
        let status = unsafe {
            podcst_audio_process(
                self.0,
                samples.as_ptr(),
                (samples.len() / channels) as u32,
                output.as_mut_ptr(),
                (output.len() / channels) as u32,
                &mut report,
            )
        };
        (status, report)
    }

    fn finish(&mut self, output: &mut [f32], channels: usize) -> (u32, PodcstAudioReport) {
        let mut report = PodcstAudioReport::default();
        let status = unsafe {
            podcst_audio_finish(
                self.0,
                output.as_mut_ptr(),
                (output.len() / channels) as u32,
                &mut report,
            )
        };
        (status, report)
    }
}

impl Drop for Native {
    fn drop(&mut self) {
        assert_eq!(
            unsafe { podcst_audio_destroy(&mut self.0) },
            PODCST_AUDIO_OK
        );
        assert!(self.0.is_null());
    }
}

fn signal(frames: usize, channels: usize) -> Vec<f32> {
    (0..frames * channels)
        .map(|sample| ((sample * 97 % 1021) as f32 - 510.0) / 300.0)
        .collect()
}

fn reference(samples: &[f32], config: PodcstAudioConfig) -> Vec<f32> {
    let format = AudioFormat::new(config.sample_rate, config.channels as usize).unwrap();
    let audio = PcmAudio::new(format.sample_rate, format.channels, samples.to_vec()).unwrap();
    let mut gain = GainProcessor::new(format, f64::from(config.gain_db)).unwrap();
    let gained = process_streaming(&audio, &mut gain, 1024).unwrap();
    if config.limiter_enabled == 0 {
        return gained.samples().to_vec();
    }
    let mut limiter = TruePeakLimiter::new(
        format,
        &LimiterConfig {
            lookahead_ms: f64::from(config.lookahead_ms),
            ceiling_dbfs: f64::from(config.ceiling_dbfs),
            release_ms: f64::from(config.release_ms),
        },
    )
    .unwrap();
    process_streaming(&gained, &mut limiter, 1024)
        .unwrap()
        .samples()
        .to_vec()
}

fn collect(native: &mut Native, samples: &[f32], channels: usize, seed: u32) -> Vec<f32> {
    let mut random = seed;
    let mut result = Vec::new();
    let mut consumed = 0;
    let mut buffer = [0.0; 514];
    while consumed < samples.len() {
        random = random.wrapping_mul(1664525).wrapping_add(1013904223);
        let chunk = ((random as usize % 997) + 1) * channels;
        let end = (consumed + chunk).min(samples.len());
        let capacity = (random as usize % 257) + 1;
        let (status, report) = native.process(
            &samples[consumed..end],
            &mut buffer[..capacity * channels],
            channels,
        );
        assert!(matches!(status, PODCST_AUDIO_OK | PODCST_AUDIO_OUTPUT_FULL));
        assert!(report.consumed_frames > 0);
        assert!(report.emitted_frames <= capacity as u32);
        assert_eq!(
            status == PODCST_AUDIO_OK,
            report.consumed_frames as usize * channels == end - consumed
        );
        consumed += report.consumed_frames as usize * channels;
        result.extend_from_slice(&buffer[..report.emitted_frames as usize * channels]);
    }
    loop {
        let (status, report) = native.finish(&mut buffer[..channels], channels);
        assert_eq!(report.consumed_frames, 0);
        assert!(report.emitted_frames <= 1);
        result.extend_from_slice(&buffer[..report.emitted_frames as usize * channels]);
        if status == PODCST_AUDIO_FINISHED {
            break;
        }
        assert_eq!(status, PODCST_AUDIO_OUTPUT_FULL);
        assert_eq!(report.emitted_frames, 1);
    }
    assert_eq!(
        native.finish(&mut buffer, channels),
        (PODCST_AUDIO_FINISHED, PodcstAudioReport::default())
    );
    result
}

#[test]
fn native_pipeline_matches_shared_reference_across_capacities_reset_and_seeking() {
    for sample_rate in [44_100, 48_000] {
        for channels in [1, 2] {
            for limiter_enabled in [0, 1] {
                for gain_db in [0.0, 6.0] {
                    let config = PodcstAudioConfig {
                        sample_rate,
                        channels,
                        gain_db,
                        limiter_enabled,
                        ..Default::default()
                    };
                    let samples = signal(4099, channels as usize);
                    let expected = reference(&samples, config);
                    let mut native = Native::new(config);
                    assert_eq!(
                        collect(&mut native, &samples, channels as usize, 5),
                        expected
                    );
                    let mut report = PodcstAudioReport {
                        consumed_frames: 11,
                        emitted_frames: 13,
                    };
                    let mut output = [42.0; 4];
                    assert_eq!(
                        unsafe {
                            podcst_audio_process(
                                native.0,
                                samples.as_ptr(),
                                1,
                                output.as_mut_ptr(),
                                1,
                                &mut report,
                            )
                        },
                        PODCST_AUDIO_INVALID_STATE
                    );
                    assert_eq!(
                        report,
                        PodcstAudioReport {
                            consumed_frames: 11,
                            emitted_frames: 13
                        }
                    );
                    assert_eq!(output, [42.0; 4]);
                    assert_eq!(unsafe { podcst_audio_reset(native.0) }, PODCST_AUDIO_OK);
                    assert_eq!(
                        collect(&mut native, &samples, channels as usize, 191),
                        expected
                    );
                    assert_eq!(unsafe { podcst_audio_reset(native.0) }, PODCST_AUDIO_OK);
                    native.process(
                        &samples[..12 * channels as usize],
                        &mut [],
                        channels as usize,
                    );
                    assert_eq!(unsafe { podcst_audio_reset(native.0) }, PODCST_AUDIO_OK);
                    assert_eq!(
                        collect(
                            &mut native,
                            &samples[107 * channels as usize..],
                            channels as usize,
                            22
                        ),
                        reference(&samples[107 * channels as usize..], config)
                    );
                }
            }
        }
    }
}

#[test]
fn zero_capacity_primes_only_bounded_lookahead_and_tail_drains_once() {
    let mut native = Native::new(PodcstAudioConfig {
        limiter_enabled: 1,
        ..Default::default()
    });
    let mut info = PodcstAudioInfo::default();
    assert_eq!(
        unsafe { podcst_audio_get_info(native.0, &mut info) },
        PODCST_AUDIO_OK
    );
    assert_eq!(info.latency_frames, 255);
    assert_eq!(info.max_block_frames, 8192);
    assert!(info.allocated_bytes < 1_048_576);
    let samples = signal(400, 2);
    let mut report = PodcstAudioReport::default();
    assert_eq!(
        unsafe {
            podcst_audio_process(
                native.0,
                samples.as_ptr(),
                400,
                ptr::null_mut(),
                0,
                &mut report,
            )
        },
        PODCST_AUDIO_OUTPUT_FULL
    );
    assert_eq!(
        report,
        PodcstAudioReport {
            consumed_frames: info.latency_frames,
            emitted_frames: 0
        }
    );
    let suffix = &samples[info.latency_frames as usize * 2..];
    assert_eq!(
        native.process(suffix, &mut [], 2),
        (PODCST_AUDIO_OUTPUT_FULL, PodcstAudioReport::default())
    );
    assert_eq!(
        native.finish(&mut [], 2),
        (PODCST_AUDIO_OUTPUT_FULL, PodcstAudioReport::default())
    );
    assert_eq!(
        native.process(&[], &mut [], 2).0,
        PODCST_AUDIO_INVALID_STATE
    );
    let actual = collect(&mut native, &[], 2, 0);
    assert_eq!(
        actual,
        reference(
            &samples[..info.latency_frames as usize * 2],
            PodcstAudioConfig {
                limiter_enabled: 1,
                ..Default::default()
            }
        )
    );
    assert_eq!(unsafe { podcst_audio_reset(native.0) }, PODCST_AUDIO_OK);
    assert_eq!(
        native.finish(&mut [], 2),
        (PODCST_AUDIO_FINISHED, PodcstAudioReport::default())
    );
    assert_eq!(
        native.finish(&mut [], 2),
        (PODCST_AUDIO_FINISHED, PodcstAudioReport::default())
    );
}

#[test]
fn invalid_arguments_preserve_audio_state_report_and_output() {
    let config = PodcstAudioConfig {
        gain_db: 6.0,
        limiter_enabled: 1,
        ..Default::default()
    };
    let mut native = Native::new(config);
    let samples = signal(777, 2);
    assert_eq!(
        native.process(&samples[..20], &mut [], 2).0,
        PODCST_AUDIO_OK
    );
    let mut output = [42.0f32; 8];
    let unchanged = PodcstAudioReport {
        consumed_frames: 11,
        emitted_frames: 13,
    };
    let mut report = unchanged;
    unsafe {
        for input in [
            [0.1, 0.2, f32::NAN, 0.2],
            [0.1, 0.2, f32::INFINITY, 0.2],
            [0.1, 0.2, f32::MAX, 0.2],
        ] {
            assert_eq!(
                podcst_audio_process(
                    native.0,
                    input.as_ptr(),
                    2,
                    output.as_mut_ptr(),
                    1,
                    &mut report
                ),
                PODCST_AUDIO_INVALID_ARGUMENT
            );
        }
        assert_eq!(
            podcst_audio_process(
                native.0,
                ptr::null(),
                1,
                output.as_mut_ptr(),
                1,
                &mut report
            ),
            PODCST_AUDIO_INVALID_ARGUMENT
        );
        assert_eq!(
            podcst_audio_process(
                native.0,
                samples.as_ptr(),
                1,
                ptr::null_mut(),
                1,
                &mut report
            ),
            PODCST_AUDIO_INVALID_ARGUMENT
        );
        assert_eq!(
            podcst_audio_process(
                native.0,
                samples.as_ptr(),
                8193,
                output.as_mut_ptr(),
                1,
                &mut report
            ),
            PODCST_AUDIO_INVALID_ARGUMENT
        );
        assert_eq!(
            podcst_audio_process(
                native.0,
                samples.as_ptr(),
                1,
                output.as_mut_ptr(),
                8193,
                &mut report
            ),
            PODCST_AUDIO_INVALID_ARGUMENT
        );
        assert_eq!(
            podcst_audio_process(
                native.0,
                samples.as_ptr().byte_add(1),
                1,
                output.as_mut_ptr(),
                1,
                &mut report
            ),
            PODCST_AUDIO_INVALID_ARGUMENT
        );
        assert_eq!(
            podcst_audio_process(
                native.0,
                samples.as_ptr(),
                1,
                output.as_mut_ptr().byte_add(1),
                1,
                &mut report
            ),
            PODCST_AUDIO_INVALID_ARGUMENT
        );
        assert_eq!(
            podcst_audio_process(
                native.0,
                output.as_ptr(),
                1,
                output.as_mut_ptr(),
                1,
                &mut report
            ),
            PODCST_AUDIO_INVALID_ARGUMENT
        );
        assert_eq!(
            podcst_audio_process(
                native.0,
                samples.as_ptr(),
                1,
                output.as_mut_ptr(),
                1,
                output.as_mut_ptr().cast()
            ),
            PODCST_AUDIO_INVALID_ARGUMENT
        );
        assert_eq!(
            podcst_audio_process(
                native.0,
                native.0.cast(),
                1,
                output.as_mut_ptr(),
                1,
                &mut report
            ),
            PODCST_AUDIO_INVALID_ARGUMENT
        );
        assert_eq!(
            podcst_audio_process(
                native.0,
                samples.as_ptr(),
                1,
                output.as_mut_ptr(),
                1,
                native.0.cast()
            ),
            PODCST_AUDIO_INVALID_ARGUMENT
        );
        assert_eq!(
            podcst_audio_process(
                native.0,
                (usize::MAX - 3) as *const f32,
                1,
                output.as_mut_ptr(),
                1,
                &mut report
            ),
            PODCST_AUDIO_INVALID_ARGUMENT
        );
        assert_eq!(
            podcst_audio_finish(native.0, ptr::null_mut(), 1, &mut report),
            PODCST_AUDIO_INVALID_ARGUMENT
        );
        assert_eq!(
            podcst_audio_finish(native.0, output.as_mut_ptr(), 1, output.as_mut_ptr().cast()),
            PODCST_AUDIO_INVALID_ARGUMENT
        );
        assert_eq!(
            podcst_audio_finish(native.0, output.as_mut_ptr(), 8193, &mut report),
            PODCST_AUDIO_INVALID_ARGUMENT
        );
        assert_eq!(
            podcst_audio_get_info(native.0, native.0.cast()),
            PODCST_AUDIO_INVALID_ARGUMENT
        );
    }
    assert_eq!(report, unchanged);
    assert_eq!(output, [42.0; 8]);
    assert_eq!(
        collect(&mut native, &samples[20..], 2, 55),
        reference(&samples, config)
    );
}

#[test]
fn creation_enforces_limits_and_ownership() {
    let defaults = PodcstAudioConfig::default();
    let invalid = [
        PodcstAudioConfig {
            sample_rate: 0,
            ..defaults
        },
        PodcstAudioConfig {
            sample_rate: 192_001,
            ..defaults
        },
        PodcstAudioConfig {
            channels: 0,
            ..defaults
        },
        PodcstAudioConfig {
            channels: 3,
            ..defaults
        },
        PodcstAudioConfig {
            channels: u32::MAX,
            ..defaults
        },
        PodcstAudioConfig {
            gain_db: f32::NAN,
            ..defaults
        },
        PodcstAudioConfig {
            gain_db: 24.1,
            ..defaults
        },
        PodcstAudioConfig {
            limiter_enabled: 2,
            ..defaults
        },
        PodcstAudioConfig {
            lookahead_ms: f32::MAX,
            ..defaults
        },
        PodcstAudioConfig {
            ceiling_dbfs: 0.1,
            ..defaults
        },
        PodcstAudioConfig {
            release_ms: f32::INFINITY,
            ..defaults
        },
    ];
    let mut handle = ptr::null_mut();
    for config in invalid {
        assert_eq!(
            unsafe { podcst_audio_create(&config, &mut handle) },
            PODCST_AUDIO_INVALID_CONFIG
        );
        assert!(handle.is_null());
    }
    assert_eq!(
        unsafe { podcst_audio_create(ptr::null(), &mut handle) },
        PODCST_AUDIO_INVALID_ARGUMENT
    );
    assert_eq!(
        unsafe { podcst_audio_config_default(ptr::null_mut()) },
        PODCST_AUDIO_INVALID_ARGUMENT
    );
    assert_eq!(
        unsafe { podcst_audio_reset(ptr::null_mut()) },
        PODCST_AUDIO_INVALID_ARGUMENT
    );
    assert_eq!(
        unsafe { podcst_audio_destroy(ptr::null_mut()) },
        PODCST_AUDIO_INVALID_ARGUMENT
    );
    assert_eq!(
        unsafe { podcst_audio_destroy(&mut handle) },
        PODCST_AUDIO_OK
    );
    let mut maximum = Native::new(PodcstAudioConfig {
        sample_rate: 192_000,
        limiter_enabled: 1,
        lookahead_ms: 100.0,
        release_ms: 5000.0,
        gain_db: 24.0,
        ..defaults
    });
    let mut info = PodcstAudioInfo::default();
    assert_eq!(
        unsafe { podcst_audio_get_info(maximum.0, &mut info) },
        PODCST_AUDIO_OK
    );
    assert!(info.allocated_bytes < 1_048_576);
    let same = maximum.0;
    assert_eq!(
        unsafe { podcst_audio_create(&defaults, &mut maximum.0) },
        PODCST_AUDIO_INVALID_ARGUMENT
    );
    assert_eq!(maximum.0, same);
    assert_eq!(
        unsafe { podcst_audio_destroy(&mut maximum.0) },
        PODCST_AUDIO_OK
    );
    assert_eq!(
        unsafe { podcst_audio_destroy(&mut maximum.0) },
        PODCST_AUDIO_OK
    );
    let mut config = defaults;
    assert_eq!(
        unsafe { podcst_audio_create(&config, (&mut config as *mut PodcstAudioConfig).cast()) },
        PODCST_AUDIO_INVALID_ARGUMENT
    );
}

#[test]
fn bounded_rust_api_rejects_partial_frames_without_mutation() {
    use podcst_audio_engine::{AudioError, PcmProcessor, StreamingProcessor};

    let format = AudioFormat::new(48_000, 2).unwrap();
    let config = LimiterConfig::default();
    for limiter in [None, Some(&config)] {
        let mut processor = PcmProcessor::new(format, 6.0, limiter).unwrap();
        let input = [0.1, 0.2, 0.3, 0.4];
        let mut output = [42.0; 4];
        assert_eq!(
            processor.process(&input[..1], &mut output),
            Err(AudioError::MisalignedSamples {
                samples: 1,
                channels: 2
            })
        );
        assert_eq!(
            processor.process(&input, &mut output[..3]),
            Err(AudioError::MisalignedSamples {
                samples: 3,
                channels: 2
            })
        );
        assert_eq!(
            processor.finish(&mut output[..3]),
            Err(AudioError::MisalignedSamples {
                samples: 3,
                channels: 2
            })
        );
        assert!(!processor.is_finished());
        assert_eq!(output, [42.0; 4]);
        let actual = process_streaming(
            &PcmAudio::new(48_000, 2, input.to_vec()).unwrap(),
            &mut processor,
            1,
        )
        .unwrap();
        let expected = reference(
            &input,
            PodcstAudioConfig {
                gain_db: 6.0,
                limiter_enabled: u32::from(limiter.is_some()),
                ..Default::default()
            },
        );
        assert_eq!(actual.samples(), expected);
    }
}
