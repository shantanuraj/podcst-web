# Podcst audio engine

This crate is the platform-independent audio-processing core and its
regression harness. It contains reference streaming processors for the first
boost, limiter, and silence-trimming experiments; these are not yet the final
mobile playback backend.

Native integration follows the audio experience plan:
a reusable local iOS player first, followed by production effects and progressive
playback. The plan owns the work ledger, processing contracts, and release gates.

## Run the harness

```sh
cargo test --manifest-path audio-engine/Cargo.toml
cargo run --manifest-path audio-engine/Cargo.toml -- generate-fixtures /tmp/podcst-audio-fixtures
cargo run --manifest-path audio-engine/Cargo.toml -- analyze /tmp/podcst-audio-fixtures/speech-gaps.wav
cargo run --manifest-path audio-engine/Cargo.toml -- analyze /tmp/podcst-audio-fixtures/speech-gaps.wav --json
```

The generated WAV files are deterministic and are not checked into the
repository. They cover quiet/loud level changes, speech-like material with
known gaps, and independent stereo channels.

`analyze` currently reports:

- RMS and sample peak in dBFS.
- A 4x windowed-sinc oversampled peak estimate.
- Integrated loudness using the BS.1770-style K-weighting and gating model.
- Fixed-threshold and adaptive noise-floor silence candidates.

The oversampled value is an analysis estimate, not yet a standards-certified
true-peak meter. The silence detector is deliberately simple and exists to
make future detector changes measurable; it is not the final trim algorithm.

## Design constraints

- The library has no platform or UI dependencies.
- PCM audio is interleaved float32 with an explicit sample rate and channel
  count.
- Analysis is deterministic and can run in the command-line harness.
- WAV input supports PCM 8/16/24/32-bit and IEEE float 32/64-bit files.
- WAV output is 16-bit PCM for portable fixtures.

## Processing experiments

```sh
cargo run --manifest-path audio-engine/Cargo.toml -- \
  process input.wav output.wav --boost --adaptive-silence --limit --json
```

The current reference pipeline:

1. Measures integrated loudness and applies a bounded episode-level gain.
2. Detects silence against an estimated noise floor, condenses pauses, and
   emits a source/output timeline map.
3. Applies a streaming 4× polyphase true-peak lookahead limiter after edits.

The true-peak path uses a 32-tap, four-phase windowed-sinc filter and a small
output-gain safety margin for gain-envelope transitions. It still needs
broader conformance vectors and device listening validation before production
use. The adaptive detector uses a lower loudness percentile, dynamic-range
check, hysteresis, speech-level protection, retained pause audio, bounded
condensation, and short boundary fades. It should be tuned against more
speech, music, and noisy recordings.

The X Minus One reference workflow is documented in
[`reference/README.md`](reference/README.md). Generate a 30-second listening
comparison without committing audio:

```sh
audio-engine/reference/make-listening-clips.sh
```

## Bounded streaming APIs

The offline `analyze`, `integrated_lufs`, `detect_adaptive_silence`,
`process_audio`, WAV I/O, and CLI remain reference/whole-file APIs. Passing a
chunk size to `process_audio` does **not** make that pipeline streaming.
The separate APIs below consume interleaved, channel-aligned finite PCM chunks
without retaining episode audio or an episode-length list of levels/events.
Constructors begin an active stream. Empty chunks are allowed. Invalid chunks
are rejected before changing state.

### Loudness

`StreamingLoudnessAnalyzer::new(AudioFormat)` provides `process(&[f32])`,
`metrics()`, and `finish()`. Metrics include frame count, source origin, RMS,
sample peak, and estimated integrated LUFS; they do not include oversampled
peak. K-weighting is continuous across chunks. Memory is one 400 ms ring of
per-frame energies, per-channel filters, and 9,602 fixed histogram bins,
independent of episode duration. Blocks advance every 100 ms. Before the first
400 ms block, integrated loudness is negative infinity. `finish()` measures a
shorter-than-400 ms stream as one partial block; for longer streams it does
not pad/add an incomplete final block, matching the offline reference.

The histogram rounds block loudness to 0.1 LU for gate membership, but stores
unquantized energy sums and counts. It uses the offline reference's positive
block mean for the relative gate, then applies the -70 LUFS absolute gate.
Bins cover -160 through +800.1 LUFS (extremes clamp). Gate decisions near bin
boundaries can differ from the offline reference; **0.1 LU is not a guaranteed
bound on the final integrated-loudness error**. This is not a certified loudness
meter or an automatic causal gain controller.

### Pause detection and adaptive tracking

`StreamingSilenceDetector::new(format, StreamingSilenceConfig)` provides
`process(input, emit)` and `finish(emit)`. The callback receives
`SilenceFrameSegment` with absolute, half-open source-frame endpoints. Events
are emitted only when a classified silent run ends, or on finish. Thus event
latency includes the entire open pause and up to one analysis frame; PCM is
not buffered while waiting. Callers own any retained event history.

`Fixed(SilenceConfig)` matches offline fixed-threshold detection, including
minimum duration, stereo maximum-channel RMS, guards, and the partial final
frame. `Adaptive { silence, window_ms }` tracks an exact percentile over a
bounded trailing window of frame levels; only that window is sorted, not the
episode. Window length is rounded up to analysis-frame units. Storage is two
window-length level arrays plus per-channel energy sums. `frame_length()` and
`warm_up_frames()` expose framing and adaptive startup requirements.

Adaptive classification begins only after a full window of source frames.
Warm-up audio is not retrospectively classified. Current-frame levels enter
the window before classification. Dynamic-range, speech-margin and hysteresis
rules match the offline detector, but the causal window deliberately cannot
match its episode-global thresholds. In particular, an extended uniform quiet
section can stop being classified as a pause when speech leaves the window.
Tune the explicitly supplied window for the intended material; no new default
adaptive editing policy is introduced.

### Lifecycle and timelines

Both analyzers expose `start()`/`reset()` to clear history at source frame zero
and `seek(source_frame)` to discard history and establish a new source origin.
Frame grids restart at that origin, without pre-roll: K-weighting starts from
zero, loudness gates restart, and adaptive tracking warms up again. Results
are for the new stream, not the episode before the seek. `finish()` is
idempotent; processing after finish returns an error until reset/start/seek.
A pending partial silence-analysis frame is classified at finish, and any
remaining guarded pause is emitted exactly once.

`StreamingProcessor` takes caller-owned output slices and returns a
`ProcessReport` with consumed input frames and emitted output frames. A small
output buffer can accept only part of the input; resubmit the unconsumed suffix.
Output lengths must be channel-aligned. Validation rejects the whole offered
input, including nonfinite samples and gain overflow, before changing state or
output. A zero-capacity output may consume limiter priming frames, then makes
no progress until output capacity is available.

`reset()`, `start()` and `seek()` clear state. Gain has zero latency. The true-peak limiter
withholds `max(1, round(lookahead_ms * sample_rate / 1000)) + 15` frames, exposed
by `latency_frames()`. Finish zero-pads only the peak detector, emits the real
pending audio without adding output frames. Call `finish(output)` repeatedly
until `is_finished()`; subsequent finish calls produce no frames. Processing
after the first finish call is rejected until reset, even while a tail remains.
Reset/seek
throws away queued audio and restores unity gain/filter history. Processors
have no absolute source clock: callers establish it on seek and discard old
queued device output themselves. They preserve frame count and order; latency
is delivery delay, not a source/output timeline shift. The convenience
`process_streaming` collects all output and does not implicitly reset state.
The gain/limiter process, drain and reset paths do not allocate after creation;
allocation regressions cover success and validation errors. This variable-output
worker API still needs a render adapter that supplies the exact requested frame
count and handles startup latency. It is not a drop-in Audio Unit render callback.

### Native C boundary

`include/podcst_audio.h` exposes opaque `PodcstAudioProcessor` handles around the
same bounded `PcmProcessor` used by Rust callers. Version 1 supports fixed gain
and an optional limiter; causal Volume Boost and Trim Silence are later work.
Zero gain with the limiter disabled is an exact identity path.

| Configuration | Supported range |
| --- | --- |
| Sample rate | 8,000–192,000 Hz |
| Channels | Mono or stereo, interleaved float32 |
| Gain | -24 to +24 dB |
| Limiter enabled | 0 or 1 |
| Lookahead | 0–100 ms |
| Ceiling | -24 to 0 dBFS |
| Release | 0–5,000 ms |
| Input/output capacity per call | 0–8,192 frames each |

Initialize the configuration with `podcst_audio_config_default`, edit the desired
fields and pass an initialized null handle slot to `podcst_audio_create`.
`podcst_audio_get_info` reports latency, maximum block frames and owned storage
bytes, including the handle and allocated buffer capacities. The largest allowed
configuration uses less than 1 MiB; caller buffers and allocator overhead are
excluded. All configuration fields are validated, including disabled limiter
parameters. Configuration changes require a new handle on its non-render owner.

`podcst_audio_process` returns `OK` when all offered input is consumed or
`OUTPUT_FULL` when some input remains. Both are successful operations and write
the consumed/emitted report. Only the emitted output prefix is valid audio;
resubmit the unconsumed input suffix with fresh output capacity. Limiter latency
means input and output counts can differ. Do not call finish on starvation.

`podcst_audio_finish` returns `OUTPUT_FULL` while real audio remains and
`FINISHED` when the tail has drained; its report may include final audio even
with `FINISHED`. Repeated finish is harmless. Reset discards pending audio and
history without allocating. Reset does not preserve a source timeline; the
caller owns source positions and invalidation of already-scheduled audio.
Destroy takes the handle slot and clears it; destroying a null handle is harmless.

Use one serial owner per handle, with no concurrent operations, reset or destroy.
All nonempty pointers must reference live, correctly sized, aligned storage for
the entire call. Input and output must not overlap each other, the handle or the
report. Input and output sample storage must already contain initialized float32
values; output values need not be finite. Null sample pointers are allowed only
for zero frames. A copied handle becomes invalid when its owner destroys it.
Numeric pointer checks cannot establish allocation lifetime or protect against
arbitrary dangling pointers; those are caller preconditions.

`INVALID_ARGUMENT`, `INVALID_CONFIG` and `INVALID_STATE` leave the processor,
output, report and handle slot unchanged. Panics are caught at the C boundary;
an internal processing panic returns `INTERNAL_ERROR` and poisons the handle,
which must then be destroyed. Internal errors do not promise unchanged state or
output. Abort-level failures such as allocation exhaustion cannot be recovered
through this status contract. Creation/destruction and configuration happen off
the render callback.

The pinned cbindgen test checks the committed header against Rust declarations.
After deliberately changing the ABI, regenerate it with:

```sh
PODCST_UPDATE_HEADER=1 cargo test --manifest-path audio-engine/Cargo.toml --test header
```

### Deliberately unresolved: streaming condensation

Offline edits still retain 250 ms, trim at most 1,500 ms per guarded pause,
apply 8 ms boundary fades, and run the limiter **after** editing. Source/output
mapping is unchanged. Exact center-of-pause removal is noncausal for an
arbitrarily long pause: its end determines which earlier samples must be
removed. A bounded-memory, bounded-latency editor cannot reproduce this for
all pause lengths. This milestone therefore does not pretend that streaming
detection makes condensation streaming. A different long-pause removal or
bypass policy requires approval before an online editor can be introduced.
