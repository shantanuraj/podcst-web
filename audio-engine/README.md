# Podcst audio engine

This crate is the platform-independent audio-processing core and its
regression harness. It contains reference streaming processors for the first
boost, limiter, and silence-trimming experiments; these are not yet the final
mobile playback backend.

Native integration follows the [audio experience plan](../docs/audio-experience-plan.md):
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

`StreamingProcessor` now requires `reset()`, `latency_frames()` and `finish()`;
`start()` and `seek()` reset state. Gain has zero latency. The true-peak limiter
withholds `max(1, round(lookahead_ms * sample_rate / 1000)) + 15` frames, exposed
by `latency_frames()`. Finish zero-pads only the peak detector, emits the real
pending audio without adding output frames, and is idempotent. Reset/seek
throws away queued audio and restores unity gain/filter history. Processors
have no absolute source clock: callers establish it on seek and discard old
queued device output themselves. They preserve frame count and order; latency
is delivery delay, not a source/output timeline shift. The convenience
`process_streaming` collects all output and does not implicitly reset state.
The limiter remains bounded-memory but is not yet allocation-free real-time
callback code.

### Deliberately unresolved: streaming condensation

Offline edits still retain 250 ms, trim at most 1,500 ms per guarded pause,
apply 8 ms boundary fades, and run the limiter **after** editing. Source/output
mapping is unchanged. Exact center-of-pause removal is noncausal for an
arbitrarily long pause: its end determines which earlier samples must be
removed. A bounded-memory, bounded-latency editor cannot reproduce this for
all pause lengths. This milestone therefore does not pretend that streaming
detection makes condensation streaming. A different long-pause removal or
bypass policy requires approval before an online editor can be introduced.
