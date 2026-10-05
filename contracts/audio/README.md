# Shared audio behaviour contract

Both native clients must produce the same audible and observable behaviour from the same source. They share one signal-processing implementation, the Rust crate in `audio-engine/`, and each owns its platform's decoding, scheduling, output and system integration. This contract states the behaviour that both platforms' tests assert. See the [audio engine README](../../audio-engine/README.md) for API details and [device testing](../../docs/audio-device-validation.md) for checks beyond automated coverage. Speeds and other product values live in [`contracts/playback/rules.json`](../playback/rules.json).

## Signal chain

Audio flows in this order:

1. The platform decoder produces PCM on a worker, never on the render thread.
2. The Rust speech processor (`SpeechProcessor`, C API `podcst_effects_*`) applies Volume Boost and Trim Silence and emits retained PCM with original-source spans.
3. A pitch-preserving time stretch applies the selected speed.
4. The Rust final limiter (`PodcstAudioProcessor`, C API `podcst_audio_*`) runs after time stretching and sample-rate conversion.
5. Output.

Effects analyze the original decoded PCM, so enabling Volume Boost never changes which pauses Trim Silence classifies. The limiter is the last processing stage; a peak ceiling measured before time stretching is insufficient. The current processing constants (Boost target and gain limits, pause eligibility, retained edges, maximum removal per pause, fades) are owned by the engine and recorded in its README; clients do not re-implement or tune them.

## PCM boundary

PCM crossing into Rust is finite, interleaved float32, mono or stereo, at an integral sample rate from 8,000 to 192,000 Hz. Frame counts always mean frames, not samples or bytes. Each call offers at most 8,192 frames of input and output capacity. Planar decoder output is interleaved at one boundary. The iOS decoders reject other formats as unsupported (`AudioProcessingDecoder.open`, `LocalAudioDecoder.open`). The native C header, its status codes, ownership rules and render-thread restrictions are defined in the engine README's "Native C boundary" section.

At 1× speed with both effects off, the rendered output before the limiter is sample-identical to the decoded source: the time stretch is bypassed and the gain stage is an exact identity. The iOS suites assert this exactness (`LocalAudioTests`, `AudioValidationTests`).

## Source time

Progress, chapters, show-note timestamp links, skips, seeks, completion, lock-screen position and server sync always use the **original episode time**. Trim Silence and speed change how long playback takes, never the reported position or duration.

- Each block of retained output carries half-open spans of original source frames. The presented position is the output frame actually rendered, adjusted for limiter and output latency, mapped back through those spans. It is not the decoder position, the last scheduled buffer or wall-clock time multiplied by speed.
- A removed interval is never reported as played through. Position does not advance during an underrun and is monotonic during playback except for deliberate seeks.
- Seeking takes an original-time target, discards queued output and processing state and establishes a new source origin. A seek into a previously trimmed interval reopens at the requested position.
- Duration and remaining time stay on the source timeline. Clients do not present a trim-adjusted time to finish or a guessed average speed.

## End of episode and starvation

An episode finishes only after the decoder has confirmed end of file, the effects and limiter tails have drained and the final audio has been presented for the current generation (`advanceDrain` and `finish` in `LocalAudioWorker.swift`). iOS allows a bounded 250 ms of silence to flush the time stretch; that allowance covers the generated vectors and is not a platform guarantee. A stop, seek or cancellation can never be reported as completion, and each episode produces one completion event.

Empty output is starvation, never end of file. On starvation a client outputs silence without advancing the source clock, lets already-pending real audio play, then resumes from the last scheduled source boundary with a new generation (`detectStarvation` in `LocalAudioWorker.swift`). It never calls the Rust finish function on starvation and never discards pending real audio. Every load, seek, stop and rebuild changes a generation token, and results or callbacks from an older generation are discarded.

## Effect states

Requested effects come from the preference model in [`contracts/playback/preferences.json`](../playback/preferences.json). What is actually applied is reported separately as one of four states (`AudioEffectState` in `ios/Podcst/Playback/AudioPreferences.swift`):

| State | Meaning |
| --- | --- |
| `inactive` | Nothing applied and nothing pending: the initial state, and the basic player with effects off. |
| `preparing` | A change was requested and has not yet reached audible output, or the native engine is being installed. |
| `active(effects)` | The given effect set, possibly with both effects off, is now audible. Reported when the first output block processed with it is presented, not when it is requested. |
| `unavailable(reason)` | Effects are requested but this source or transport cannot apply them; the reason is shown to the listener. Basic playback continues. |

Effects are unavailable, and playback uses the platform's basic player, in these cases (`RoutingAudioTransport.load`, `installNative`):

| Source | Reason shown by iOS |
| --- | --- |
| HLS or live stream (`.m3u8` path or an `mpegurl` type) | "Audio effects are unavailable for live streams." |
| HTTP source without validated random access (ranges ignored, unknown length or no strong validator), until it is downloaded | "Download this episode to use audio effects. This server does not support reliable streaming with effects." |
| Decoder rejects the format: more than two channels, a sample rate outside 8–192 kHz, or a container that requires the complete file | "Audio effects are unavailable for this format." |

When a source that needed a download finishes downloading while it is playing with effects requested, iOS pauses, reports `preparing` and reloads the downloaded file natively at the current position (`resumeEffectsFromDownload`). Completed downloads and validated progressive sources use the native engine with all speeds and both effects.

## Unsupported media

A format unsupported by the native decoder falls back to the platform player at the same position rather than failing. Only a source the platform player also cannot play, or an episode without a valid audio URL, ends in the failed playback state. An enabled effect toggle is never silently ignored: the listener sees the `unavailable` reason.

## Shared test vectors

The Rust engine generates the deterministic signal vectors that both platforms replay:

```sh
cargo run --manifest-path audio-engine/Cargo.toml -- bridge-vectors <directory> [case...]
```

The subcommand is the single source of bridge vectors; its file format is defined by the engine (`audio-engine/src/vectors.rs`), not here. Generated files are not committed. Each platform's native-boundary tests replay the generated cases through that platform's binding to the shared Rust processors and compare the results with the generated expectations, so a divergence identifies the platform integration rather than the DSP.
