# Podcst audio engine

This crate is the platform-independent audio-processing core and its
regression harness. It contains reference streaming processors for the first
boost, limiter, and silence-trimming experiments; these are not yet the final
mobile playback backend.

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
- Conservative fixed-threshold silence candidates.

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
2. Applies a streaming 4× polyphase true-peak lookahead limiter.
3. Detects silence against an estimated noise floor and emits a source/output
   timeline map.

The true-peak path uses a 32-tap, four-phase windowed-sinc filter and a small
output-gain safety margin for gain-envelope transitions. It still needs
broader conformance vectors and device listening validation before production
use. The adaptive detector uses a lower loudness percentile, dynamic-range
check, hysteresis-free frame grouping, and conservative guards; it should be
tuned against more speech, music, and noisy recordings.

The X Minus One reference workflow is documented in
[`reference/README.md`](reference/README.md).
