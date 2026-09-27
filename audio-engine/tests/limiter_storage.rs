use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use podcst_audio_engine::{AudioFormat, LimiterConfig, StreamingProcessor, TruePeakLimiter};

struct CountingAllocator;

thread_local! {
    static ALLOCATIONS: Cell<Option<(usize, usize, usize)>> = const { Cell::new(None) };
}

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

fn record_allocation(allocation: usize, reallocation: usize, deallocation: usize) {
    let _ = ALLOCATIONS.try_with(|counts| {
        if let Some((allocated, reallocated, deallocated)) = counts.get() {
            counts.set(Some((
                allocated + allocation,
                reallocated + reallocation,
                deallocated + deallocation,
            )));
        }
    });
}

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        record_allocation(1, 0, 0);
        unsafe { System.alloc(layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        record_allocation(1, 0, 0);
        unsafe { System.alloc_zeroed(layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        record_allocation(0, 1, 0);
        unsafe { System.realloc(ptr, layout, new_size) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        record_allocation(0, 0, 1);
        unsafe { System.dealloc(ptr, layout) }
    }
}

fn allocations_during(work: impl FnOnce()) -> (usize, usize, usize) {
    ALLOCATIONS.with(|counts| counts.set(Some((0, 0, 0))));
    work();
    ALLOCATIONS.with(|counts| counts.take().unwrap())
}

fn signal(frames: usize, channels: usize) -> Vec<f32> {
    (0..frames)
        .flat_map(|frame| {
            (0..channels).map(move |channel| {
                let signed = ((frame * 97 + channel * 31) % 257) as f32 - 128.0;
                let level = if (512..768).contains(&frame) || frame == 1100 {
                    2.0
                } else {
                    0.03
                };
                signed / 128.0 * level
            })
        })
        .collect()
}

#[test]
fn limiter_processing_and_lifecycle_do_not_allocate_after_construction() {
    for sample_rate in [44_100, 48_000] {
        for channels in [1, 2] {
            for lookahead_ms in [0.0, 0.001, 5.0] {
                let format = AudioFormat::new(sample_rate, channels).unwrap();
                let config = LimiterConfig {
                    lookahead_ms,
                    ..LimiterConfig::default()
                };
                let mut limiter = TruePeakLimiter::new(format, &config).unwrap();
                let samples = signal(4099, channels);
                let descending: Vec<f32> = (0..4099)
                    .flat_map(|frame| std::iter::repeat_n(1.5 - frame as f32 / 4099.0, channels))
                    .collect();
                let mut output = Vec::with_capacity(samples.len());
                let counts = allocations_during(|| {
                    for input in [&samples, &descending] {
                        limiter.start();
                        limiter
                            .process(&input[..17 * channels], &mut output)
                            .unwrap();
                        limiter.reset();
                        output.clear();
                        assert_eq!(limiter.finish(&mut output).unwrap().output_frames, 0);
                        limiter.start();
                        limiter
                            .process(&input[..17 * channels], &mut output)
                            .unwrap();
                        limiter.seek();
                        output.clear();
                        assert_eq!(limiter.finish(&mut output).unwrap().output_frames, 0);
                        for chunk_frames in [1, 7, 257, 4099] {
                            limiter.reset();
                            let mut emitted = 0;
                            for chunk in input.chunks(chunk_frames * channels) {
                                output.clear();
                                let report = limiter.process(chunk, &mut output).unwrap();
                                assert_eq!(report.input_frames, chunk.len() / channels);
                                emitted += report.output_frames;
                            }
                            output.clear();
                            emitted += limiter.finish(&mut output).unwrap().output_frames;
                            assert_eq!(emitted, input.len() / channels);
                            assert_eq!(limiter.finish(&mut output).unwrap().output_frames, 0);
                            limiter.seek();
                            output.clear();
                            assert_eq!(limiter.finish(&mut output).unwrap().output_frames, 0);
                        }
                    }
                });
                assert_eq!(counts, (0, 0, 0), "{sample_rate}/{channels}/{lookahead_ms}");
            }
        }
    }
}

#[test]
fn limiter_rejects_unrepresentable_buffer_capacities() {
    for (channels, lookahead_ms) in [(usize::MAX, 0.0), (usize::MAX / 64, 0.0), (1, f64::MAX)] {
        assert!(
            TruePeakLimiter::new(
                AudioFormat::new(48_000, channels).unwrap(),
                &LimiterConfig {
                    lookahead_ms,
                    ..LimiterConfig::default()
                },
            )
            .is_err()
        );
    }
}

#[test]
fn limiter_matches_preallocation_reference_outputs() {
    let checkpoints = [
        0, 100, 254, 255, 256, 400, 490, 511, 512, 513, 600, 767, 768, 769, 800, 1023, 1099, 1100,
        1101, 1120, 1300, 1378,
    ];
    let cases: [(u32, usize, bool, &[f32]); 4] = [
        (
            44_100,
            1,
            false,
            &[
                -0.03,
                0.014765625,
                0.022265624,
                -0.015234374,
                0.0075,
                0.010725316,
                0.010022016,
                0.008297769,
                -0.37849474,
                0.18633588,
                -0.058095366,
                -0.011634606,
                0.008295995,
                -0.005680542,
                0.010286217,
                -0.00972595,
                0.007708552,
                -0.5540816,
                0.0014027455,
                0.0058781602,
                0.0046946676,
                -0.011836051,
            ],
        ),
        (
            48_000,
            2,
            false,
            &[
                -0.03,
                -0.022734374,
                0.014765625,
                0.02203125,
                0.022265624,
                0.02953125,
                -0.015234374,
                -0.00796875,
                0.0075,
                0.014765625,
                0.010656082,
                -0.009083874,
                0.009957323,
                -0.009782633,
                0.008297769,
                0.011005463,
                -0.37849474,
                -0.19798186,
                0.18633588,
                0.36684877,
                -0.058095366,
                0.12200027,
                -0.011632664,
                0.16867363,
                0.008294097,
                0.011000592,
                -0.0056788917,
                -0.0029704971,
                0.010264277,
                -0.00990726,
                -0.009582344,
                -0.006581812,
                0.0075888294,
                0.010644073,
                -0.5454709,
                -0.34174082,
                0.0013808993,
                0.004438605,
                0.0057829623,
                0.008873856,
                0.0045964336,
                0.00798904,
                -0.011570356,
                -0.008053875,
            ],
        ),
        (
            44_100,
            2,
            true,
            &[
                -0.03,
                -0.022734374,
                0.014765625,
                0.02203125,
                0.022265624,
                0.02953125,
                -0.015234374,
                -0.00796875,
                0.0075,
                0.014765625,
                0.028593749,
                -0.024375,
                0.026718749,
                -0.02625,
                0.0171593,
                0.022758652,
                -0.8488104,
                -0.44399312,
                0.31961098,
                0.62923414,
                -0.061664656,
                0.12949577,
                -0.03125,
                0.453125,
                0.022265624,
                0.02953125,
                -0.015234374,
                -0.00796875,
                0.026953124,
                -0.026015624,
                -0.023203125,
                -0.0159375,
                0.013228571,
                0.01855436,
                -0.84881043,
                -0.53178483,
                0.00328125,
                0.010546875,
                0.01359375,
                0.020859374,
                0.00984375,
                0.017109375,
                -0.02390625,
                -0.016640624,
            ],
        ),
        (
            48_000,
            1,
            true,
            &[
                -0.03,
                0.014765625,
                0.022265624,
                -0.015234374,
                0.0075,
                0.028593749,
                0.026718749,
                0.0171593,
                -0.8488104,
                0.31961098,
                -0.08437518,
                -0.03125,
                0.022265624,
                -0.015234374,
                0.026953124,
                -0.023203125,
                0.013228571,
                -0.84881043,
                0.00328125,
                0.01359375,
                0.00984375,
                -0.02390625,
            ],
        ),
    ];
    for (sample_rate, channels, zero_timing, expected) in cases {
        let config = if zero_timing {
            LimiterConfig {
                lookahead_ms: 0.0,
                ceiling_dbfs: -1.0,
                release_ms: 0.0,
            }
        } else {
            LimiterConfig::default()
        };
        let samples = signal(1379, channels);
        let mut whole = Vec::new();
        for chunks in [&[1379][..], &[1, 7, 31, 257, 3, 19][..]] {
            let mut limiter =
                TruePeakLimiter::new(AudioFormat::new(sample_rate, channels).unwrap(), &config)
                    .unwrap();
            let mut output = Vec::with_capacity(samples.len());
            let mut cursor = 0;
            for chunk in chunks.iter().cycle() {
                let end = (cursor + chunk * channels).min(samples.len());
                limiter.process(&samples[cursor..end], &mut output).unwrap();
                cursor = end;
                if cursor == samples.len() {
                    break;
                }
            }
            limiter.finish(&mut output).unwrap();
            assert_eq!(output.len(), samples.len());
            if whole.is_empty() {
                whole = output.clone();
            } else {
                assert_eq!(output, whole);
            }
            for (index, frame) in checkpoints.into_iter().enumerate() {
                for channel in 0..channels {
                    let actual = output[frame * channels + channel];
                    let expected = expected[index * channels + channel];
                    assert!(
                        (actual - expected).abs() <= 0.000_000_2,
                        "{sample_rate}/{channels}/{zero_timing} frame {frame}, channel {channel}: {actual} vs {expected}"
                    );
                }
            }
        }
    }
}
