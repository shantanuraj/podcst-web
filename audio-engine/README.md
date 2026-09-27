# Podcst audio engine

This crate is the platform-independent audio-processing core and its first
regression harness. It intentionally starts with analysis and fixtures before
implementing playback processing.

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

The next engine step is to add streaming processor interfaces and reference
implementations for adaptive loudness gain, true-peak limiting, and silence
condensation. Each should be tested against these metrics before being wired
into iOS, Android, or WebAssembly playback.
