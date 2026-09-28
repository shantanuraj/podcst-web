# Podcst audio engine

This crate is the platform-independent audio-processing core and its
regression harness. It supplies the bounded speech-effects worker and final
render limiter used by the native iOS backend, alongside whole-file reference
tools. The implementation has automated validation; physical listening and
power release gates remain recorded separately.

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
same bounded `PcmProcessor` used by Rust callers. This render-facing processor
provides fixed gain and the final limiter. Zero gain with the limiter disabled
is an exact identity path. The separate `PodcstEffectsProcessor` provides causal
Volume Boost and Trim Silence on the decoder worker.

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

### Apple packaging and linking

On macOS, install Xcode with the iOS SDK and select it with `xcode-select`.
Install Rust using rustup, then add the three Apple targets:

```sh
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
audio-engine/scripts/build-apple.sh
audio-engine/scripts/test-native.sh --apple
```

The build produces `audio-engine/target/apple/PodcstAudioEngine.xcframework`
with device arm64 and simulator arm64/x86_64 static-library slices, a C header
and the `PodcstAudioEngine` Swift module. Deployment starts at iOS 18. Generated
binaries remain under ignored `target/`. Run with `RUSTUP_TOOLCHAIN=stable` to
select stable explicitly; the scripts use the active rustup toolchain otherwise.
The Xcode app target links the same Rust static library through
`scripts/build-xcode.sh`, which builds only the active destination architectures
into Derived Data. It uses the same committed header and module. The XCFramework
remains the standalone distribution artifact. Normal podcast playback routes
completed files and supported progressive sources through the native backend;
AVPlayer handles explicitly unsupported formats and streaming capabilities.

`test-native.sh` runs C ABI/layout and Swift import/processing checks on the Mac.
With `--apple`, it also links the Swift checks against every packaged architecture;
cross-linking does not execute a device binary. Run the simulator executable on
a booted simulator by supplying its identifier:

```sh
xcrun simctl spawn <simulator-id> "$PWD/audio-engine/target/native-tests/swift-simulator-$(uname -m)"
```

`.github/workflows/audio.yml` runs Rust tests, strict Clippy, Apple packaging,
C/Swift checks, the packaged Swift executable on iOS Simulator and the app's
playback tests. Its Apple runner needs an available iPhone simulator with iOS 18
or later. Local builds need the same SDKs, targets and command-line tools; no
prebuilt binary is downloaded or checked in. The iOS test target also needs
`ffmpeg` (`brew install ffmpeg`) to generate deterministic VBR MP3 and surround
AAC fixtures in Derived Data. The test build copies them into the test bundle; it is never an app resource
or a checked-in media file.

### Local iOS Audio Lab

Open `ios/Podcst.xcodeproj`, select the **Podcst Audio Lab** scheme and run on an
iPhone or simulator. Choose **Browse podcasts** for the US top podcasts, search
by name or RSS feed link, then select a podcast and episode. The episode list also
supports title filtering. Choose **Open audio file** to select a local audio file.
Selected podcast episodes offer **Download** and **Play download** for repeatable
comparisons using the same completed file with either engine.
The scheme builds the `AudioLab` target, a separate app installed beside Podcst
with its own bundle identifier, icon and entry point. The lab uses `RoutingAudioTransport`
with the existing `PlaybackController`, so streaming, decoding, seeking, speed,
audio sessions, interruptions and Now Playing use the production path. Lab media
has its own cache, and test playback never updates subscriptions or listening
history. Audio preferences begin fresh for each lab launch.

Choose **Use test signal** for a deterministic 45-second signal with quiet and loud
tones and pauses. **Measure audio** enables original/processed waveforms on the
same amplitude and episode-time scales. Freeze a reading, change the 5–60 second
window, and inspect earlier audio without changing playback. Shaded intervals
show actual removed source audio. Gain and RMS describe the effects stage;
the separate final-output meters include speed processing and limiting.

**Compare a passage** renders Off, Boost, Trim and Both from the same local or
downloaded source, with the same pre-roll. Loop a version or cycle all four at
fixed level or attenuation-only matched loudness. Selecting a silence cut opens
a passage around it; cuts longer than the thirty-second limit focus on the
return to audio. Comparisons use the current playback speed and leave ordinary
playback paused when dismissed.

**Export capture** saves bounded JSON with waveform envelopes, cuts, effect and
route events, output metrics, comparison results, settings, selected inspection
window and Git/build provenance. It excludes raw audio, episode titles, source
URLs and personal accessory names. The source identity hash identifies the
episode/import session, not the file's byte contents. Frozen exports retain the
reading's capture time and settings; final-output meters show that capture time
when inspecting an earlier waveform window. True peak is an oversampled estimate.

Disable **Measure audio** for engine power comparisons. It is always disabled
in Podcst. The lab's separate `-AudioLabReference` launch mode uses AVPlayer and
hides unsupported inspection/effects. See inspection design and validation.

Graph control, refill scheduling and source clocks run on a dedicated serial
audio executor. The main actor sends ordered commands and consumes coalesced
position snapshots; a stalled UI cannot block PCM delivery. Shutdown waits for
decoder closure before releasing media leases. Periodic Now Playing metadata
publishes at most once per second, with controls and source changes published
immediately.

The decoder reads bounded planar Float32 blocks on a worker. The Rust speech
processor emits retained PCM and original-source spans. Each of two native
source Audio Units has a preallocated single-producer/single-consumer ring;
rendering reads raw storage using lock-free counters. There are no Swift or
Objective-C object operations, locks, allocation, dispatch or I/O in the custom
render callbacks. The graph is native PCM source → conversion → fixed-rate
TimePitch → priming/crossfade gate → route conversion → final Rust limiter.

Source position comes from the final rendered clock, the committed rate handoff
and bounded source spans, with limiter and output presentation latency accounted
for. A dormant branch primes without being heard, then crosses into the output
at a scheduled render-frame boundary. The active branch keeps its fixed rate;
changing a live TimePitch rate is deliberately avoided. Pause/resume pauses the
engine without resetting its processors. TimePitch is bypassed at 1× to preserve
source samples exactly before limiting. Owned-memory diagnostics include the
explicit pools, replay window, mapping and custom Audio Unit storage, excluding
Apple codec/graph internals; whole-process residency is measured separately.

At EOF, the decoder schedules a bounded 250 ms of output-equivalent silence to
flush TimePitch, then explicitly drains the Rust limiter and waits for downstream
presentation. That allowance covers the generated test vectors; it is not an
Apple-guaranteed tail bound. A scheduling underrun preserves the last scheduled
source boundary, lets pending real audio pass, and reopens there with a new graph
generation. It never treats missing input as EOF. All retired worker results and
callbacks are rejected by generation.

The lab identifies the active engine and exposes source/output formats, queued
buffers, owned audio memory and underrun counts for the custom engine. Sources
requiring AVPlayer fallback are labeled explicitly. It keeps the selected
document security scope while using the file. Lab playback state and diagnostics
are not synchronized, and each launch begins without a selected episode.
For simulator automation, `-AudioLabFile <local-path>` opens an existing file
alongside `-LocalAudioHarness`. Do not put private media paths in checked-in
scheme arguments or scripts.

The shared graph runs offline in `LocalAudioTests`, `AudioValidationTests` and
`EffectsIntegrationTests`: original-source marker timing, all speed transitions,
generated PCM/compressed input, seek/pause/EOF races, exact 1× processed samples,
finite storage and forced starvation. `EffectsPeakTests` warms up both effects
before measuring final converted output with an independent 16× peak meter.
`NativeRenderTests` compares the final limiter AU directly with Rust;
`HandoffRenderTests` exercises raw PCM rings and crossfade publication.

Add `-AudioLabReference` to the debug lab launch arguments to use AVPlayer with
the same controller and selected episode or local file. The reference hides
unsupported effect controls while keeping speed controls available. Completed
cached files are reused; uncached episodes stream directly through AVPlayer.
Remove the argument to return to custom playback and use the Audio control to
enable effects. This comparison mode exists for the
physical validation worksheet;
it is not a production playback preference. Test source, route, volume, rate and
optimized build settings must match when comparing power.

### Causal speech effects

`SpeechProcessor` and the matching `podcst_effects_*` C API process interleaved
mono/stereo float32 at 8–192 kHz. Input/output blocks are bounded to 8,192 frames;
callers own output PCM and source-span storage. Process reports partial consumed
and emitted counts. Zero emitted frames during priming are not EOF. Resubmit
unconsumed input and repeatedly finish until the processor reports completion.

Original PCM drives loudness and silence classification. Boost targets -14 LUFS
where the ±12 dB gain limits permit, begins at unity, smooths linked channel gain
and freezes upward adaptation during uncertain/quiet material. It is followed
by the final limiter after time stretching and conversion, not used as a peak
safety substitute.

The online editor waits for 500 ms pause eligibility and retains 205 ms at each
edge. It removes confirmed excess interior incrementally, caps removal at
1,500 ms per pause and applies 8 ms boundary fades. Its working PCM is bounded
to at most 510 ms. Warm-up and uncertain material pass through. This is a causal
policy rather than the whole-file reference editor’s center cut; it never waits
for an arbitrarily long pause to end. The cap persists through uncertainty and
toggles until confident signal returns.

Configuration revisions apply at analysis-frame boundaries. Each retained span
maps original source frames to offsets in the current output block. The caller
merges adjacent spans and drops presented history. Reset establishes a new source
origin and clears measurement/edit history. Allocation regressions cover process,
configure, reset, query and drain, including a six-hour synthetic stream. Natural
speech rhythm and perceived gain quality still require the listening review.
