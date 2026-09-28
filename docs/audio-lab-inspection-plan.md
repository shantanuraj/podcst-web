# Audio Lab inspection

Audio Lab uses the production decoder, effects worker, time-pitch graph and limiter. Inspection is optional and disabled in Podcst. Measurements describe digital audio at a named stage, not the acoustic output of a speaker or Bluetooth headset.

## Delivery

| Package | Behavior | Verification |
| --- | --- | --- |
| Signal inspection | Bounded original and processed envelopes on original episode time; fixed amplitude scale; exact removed intervals; gain and effect events presented with audio | Disabled/enabled output equivalence; trim mapping; presentation gating; bounded history and epoch resets |
| Output measurement | Optional native capture after the final limiter; peak, RMS, loudness, estimated true peak, limiter reduction and invalid/clipped sample counts | Known signals, block partition invariance, ring overflow, disabled capture, no audio changes |
| Repeatable comparison | Select a source passage; identical pre-roll; render Off, Boost, Trim and Both; loop at fixed level or matched loudness using attenuation | Passage bounds, cancellation, gain calculation, deterministic renders, no second DSP pass |
| Inspector interface | Live/frozen waveform, adjustable window, cut replay, direct effect controls, stage-specific meters and event list | Simulator layout and interactions; accessible controls; no unexplained transient effect labels |
| Diagnostic capture | Export bounded summaries, waveform/cut/event history, build, route and settings; exclude source URLs and raw audio | JSON validity including silence; sanitized source identity; matching export/view snapshot |

## Timing and ownership

The decoder measures source and Rust-processed samples outside the render callback. Source-span gaps identify actual removals. Seek, episode replacement and graph epochs cannot create synthetic cuts. The existing source/presentation clock decides which telemetry is visible; requested and presented effects remain distinct.

Final-output capture uses fixed native storage. The render callback never waits for a reader or allocates telemetry storage. Overflow drops measurements and increments a separate counter. Loudness and oversampled peak analysis run on a worker. Pausing, disabling measurement and leaving the lab must not retain growing work queues.

The live inspector retains a bounded rolling window. Freezing captures a value snapshot while playback may continue. Instrumentation can be disabled for power comparisons. The main application keeps it disabled.

## Listening comparison

Comparisons use a local or completely downloaded source and a bounded passage with identical source pre-roll for each preset. The custom engine renders the actual output, including speed processing and final limiting, to temporary audition files. Audition playback does not apply effects again. Matching attenuates variants toward a common measured loudness and never raises device volume. Silence or insufficient measurement remains explicitly unmatched. Custom effects off still includes the final safety limiter and is distinct from the AVPlayer reference launch mode.

## Acceptance

Build both apps and run the relevant Rust, native and Swift regression suites. Exercise the inspector with a deterministic local fixture, verify toggle and freeze behavior, audition presets and export a capture. Physical speaker/Bluetooth listening and power measurements remain separate evidence; visual or numerical tests cannot establish listening quality or accessory latency.

## Validation recorded 2026-09-28

- Podcst and Audio Lab simulator builds succeed with Xcode 27.
- The selected Swift/native regression run passes all 86 tests: inspection, signal metering, comparison, native rendering, playback, local decoding, effects integration, peak safety and validation fixtures. The Rust suite passes 49 tests with one existing ignored test.
- On the iOS 27 simulator, the built-in signal plays through the custom engine. Effect toggles change the measured envelopes, actual cuts appear, and freeze preserves the selected reading. Four-preset comparison renders, fixed/matched selection, direct preset switching, automatic cycling and dismissal work. A 20-second test passage renders to 14.97 seconds with Trim enabled.
- A capture saved through the Files picker parses as strict JSON, contains all four comparison results and frozen-window/build/route metadata, and contains no raw PCM, source URL, episode title or personal route name. Histories remain within their configured bounds.
- A simulator audio-device failure interrupted the first manual attempt. After restarting that simulator and running it without the parallel test simulator, the comparison flow succeeds. This is not evidence about physical-route reliability.
- Speaker/Bluetooth listening quality, accessory transitions and matched power measurements remain pending physical-device validation.
