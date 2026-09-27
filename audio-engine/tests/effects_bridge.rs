use std::ptr;

use podcst_audio_engine::AudioFormat;
use podcst_audio_engine::ffi::*;
use podcst_audio_engine::speech::{EffectsSettings, SourceSpan, SpeechProcessor};

#[test]
fn effects_native_matches_rust_for_partial_buffers_and_finish() {
    for channels in [1, 2] {
        let config = PodcstEffectsConfig {
            sample_rate: 8_000,
            channels,
            boost_enabled: 1,
            trim_enabled: 1,
        };
        let mut native = ptr::null_mut();
        assert_eq!(
            unsafe { podcst_effects_create(&config, &mut native) },
            PODCST_AUDIO_OK
        );
        let mut rust = SpeechProcessor::new(
            AudioFormat::new(8_000, channels as usize).unwrap(),
            EffectsSettings {
                boost_enabled: true,
                trim_enabled: true,
                revision: 0,
            },
        )
        .unwrap();
        let mut native_output = [0.0; 74];
        let mut rust_output = [0.0; 74];
        let mut native_spans = [PodcstSourceSpan::default(); 1];
        let mut rust_spans = [SourceSpan::default(); 1];
        let mut native_report = PodcstEffectsReport::default();
        let mut source = 0;
        while source < 8_000 * 12 {
            let mut input = [0.0; 514];
            let input_frames = (8_000 * 12 - source).min(257);
            for frame in 0..input_frames {
                let time = (source + frame) as f32 / 8_000.0;
                let level = if (4.0..10.0).contains(&time) || (source + frame) % 8000 < 2000 {
                    0.00001
                } else {
                    0.1
                };
                for channel in 0..channels as usize {
                    input[frame * channels as usize + channel] =
                        level * (time * 317.0 * std::f32::consts::TAU).sin() * (channel + 1) as f32;
                }
            }
            let report = rust
                .process(
                    &input[..input_frames * channels as usize],
                    &mut rust_output[..37 * channels as usize],
                    &mut rust_spans,
                )
                .unwrap();
            let status = unsafe {
                podcst_effects_process(
                    native,
                    input.as_ptr(),
                    input_frames as u32,
                    native_output.as_mut_ptr(),
                    37,
                    native_spans.as_mut_ptr(),
                    1,
                    &mut native_report,
                )
            };
            assert!(matches!(status, PODCST_AUDIO_OK | PODCST_AUDIO_OUTPUT_FULL));
            assert_eq!(native_report.consumed_frames as usize, report.input_frames);
            assert_eq!(native_report.emitted_frames as usize, report.output_frames);
            assert_eq!(native_report.span_count as usize, report.span_count);
            assert_eq!(native_output, rust_output);
            assert_eq!(native_spans, rust_spans);
            source += report.input_frames;
        }
        loop {
            let report = rust
                .finish(&mut rust_output[..37 * channels as usize], &mut rust_spans)
                .unwrap();
            let status = unsafe {
                podcst_effects_finish(
                    native,
                    native_output.as_mut_ptr(),
                    37,
                    native_spans.as_mut_ptr(),
                    1,
                    &mut native_report,
                )
            };
            assert_eq!(native_report.emitted_frames as usize, report.output_frames);
            assert_eq!(native_output, rust_output);
            assert_eq!(native_spans, rust_spans);
            if status == PODCST_AUDIO_FINISHED {
                assert!(rust.is_finished());
                break;
            }
            assert_eq!(status, PODCST_AUDIO_OUTPUT_FULL);
        }
        assert_eq!(
            unsafe { podcst_effects_destroy(&mut native) },
            PODCST_AUDIO_OK
        );
        assert!(native.is_null());
        assert_eq!(
            unsafe { podcst_effects_destroy(&mut native) },
            PODCST_AUDIO_OK
        );
    }
}

#[test]
fn effects_reject_invalid_regions_and_config_without_mutation() {
    unsafe {
        let config = PodcstEffectsConfig {
            sample_rate: 8_000,
            channels: 1,
            ..Default::default()
        };
        let mut native = ptr::null_mut();
        assert_eq!(podcst_effects_create(&config, &mut native), PODCST_AUDIO_OK);
        let input = [0.1; 80];
        let mut output = [9.0; 80];
        let sentinel = PodcstEffectsReport {
            consumed_frames: 42,
            emitted_frames: 43,
            span_count: 44,
        };
        let mut report = sentinel;
        let mut spans = [PodcstSourceSpan {
            source_start_frame: 55,
            output_start_frame: 66,
            frame_count: 77,
        }; 1];
        let old_spans = spans;
        for invalid in [f32::NAN, f32::INFINITY, f32::MAX] {
            assert_eq!(
                podcst_effects_process(
                    native,
                    &invalid,
                    1,
                    output.as_mut_ptr(),
                    80,
                    spans.as_mut_ptr(),
                    1,
                    &mut report
                ),
                PODCST_AUDIO_INVALID_ARGUMENT
            );
        }
        assert_eq!(
            podcst_effects_process(
                native,
                input.as_ptr(),
                8193,
                output.as_mut_ptr(),
                80,
                spans.as_mut_ptr(),
                1,
                &mut report
            ),
            PODCST_AUDIO_INVALID_ARGUMENT
        );
        assert_eq!(
            podcst_effects_process(
                native,
                input.as_ptr(),
                80,
                output.as_mut_ptr(),
                80,
                output.as_mut_ptr().cast(),
                1,
                &mut report
            ),
            PODCST_AUDIO_INVALID_ARGUMENT
        );
        assert_eq!(
            podcst_effects_process(
                native,
                input.as_ptr(),
                80,
                output.as_mut_ptr(),
                80,
                spans.as_mut_ptr(),
                1,
                spans.as_mut_ptr().cast()
            ),
            PODCST_AUDIO_INVALID_ARGUMENT
        );
        assert_eq!(
            podcst_effects_process(
                native,
                input.as_ptr(),
                80,
                output.as_mut_ptr(),
                80,
                (spans.as_mut_ptr() as *mut u8).add(1).cast(),
                1,
                &mut report
            ),
            PODCST_AUDIO_INVALID_ARGUMENT
        );
        assert_eq!(
            podcst_effects_process(
                native,
                ptr::null(),
                80,
                output.as_mut_ptr(),
                80,
                spans.as_mut_ptr(),
                1,
                &mut report
            ),
            PODCST_AUDIO_INVALID_ARGUMENT
        );
        assert_eq!(
            podcst_effects_configure(native, 2, 0, 10),
            PODCST_AUDIO_INVALID_CONFIG
        );
        assert_eq!(report, sentinel);
        assert_eq!(spans, old_spans);
        assert_eq!(output, [9.0; 80]);
        let mut info = PodcstEffectsInfo::default();
        assert_eq!(podcst_effects_get_info(native, &mut info), PODCST_AUDIO_OK);
        assert_eq!(info.pending_frames, 0);
        assert_eq!(info.applied_revision, 0);
        assert_eq!(
            podcst_effects_process(
                native,
                input.as_ptr(),
                80,
                ptr::null_mut(),
                0,
                ptr::null_mut(),
                0,
                &mut report
            ),
            PODCST_AUDIO_OUTPUT_FULL
        );
        assert_eq!(report.consumed_frames, 80);
        assert_eq!(report.emitted_frames, 0);
        assert_eq!(
            podcst_effects_process(
                native,
                input.as_ptr(),
                80,
                ptr::null_mut(),
                0,
                ptr::null_mut(),
                0,
                &mut report
            ),
            PODCST_AUDIO_OUTPUT_FULL
        );
        assert_eq!(report.consumed_frames, 0);
        assert_eq!(
            podcst_effects_finish(native, ptr::null_mut(), 0, ptr::null_mut(), 0, &mut report),
            PODCST_AUDIO_OUTPUT_FULL
        );
        assert_eq!(
            podcst_effects_process(
                native,
                input.as_ptr(),
                80,
                output.as_mut_ptr(),
                80,
                spans.as_mut_ptr(),
                1,
                &mut report
            ),
            PODCST_AUDIO_INVALID_STATE
        );
        assert_eq!(
            podcst_effects_finish(
                native,
                output.as_mut_ptr(),
                80,
                spans.as_mut_ptr(),
                1,
                &mut report
            ),
            PODCST_AUDIO_FINISHED
        );
        assert_eq!(output, input);
        assert_eq!(
            spans[0],
            PodcstSourceSpan {
                source_start_frame: 0,
                output_start_frame: 0,
                frame_count: 80
            }
        );
        assert_eq!(
            podcst_effects_configure(native, 1, 1, 11),
            PODCST_AUDIO_INVALID_STATE
        );
        assert_eq!(podcst_effects_reset(native, 1234), PODCST_AUDIO_OK);
        assert_eq!(podcst_effects_get_info(native, &mut info), PODCST_AUDIO_OK);
        assert_eq!(info.applied_source_frame, 1234);
        assert_eq!(info.pending_frames, 0);
        assert_eq!(podcst_effects_destroy(&mut native), PODCST_AUDIO_OK);
        for (sample_rate, channels, boost_enabled, trim_enabled) in [
            (0, 1, 0, 0),
            (7999, 1, 0, 0),
            (192001, 1, 0, 0),
            (48000, 3, 0, 0),
            (48000, 1, 2, 0),
            (48000, 1, 0, 2),
        ] {
            assert_eq!(
                podcst_effects_create(
                    &PodcstEffectsConfig {
                        sample_rate,
                        channels,
                        boost_enabled,
                        trim_enabled
                    },
                    &mut native
                ),
                PODCST_AUDIO_INVALID_CONFIG
            );
            assert!(native.is_null());
        }
    }
}
