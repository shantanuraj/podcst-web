# Audio device testing

Simulator and DSP tests do not establish physical-device sound quality, battery
use or route behaviour. Test an optimized build on real devices, including an
older supported model. Record the commit, device/OS, route, speed, effects and
steps with each result; keep personal device identifiers and private media out
of shared reports. Use the [native acceptance worksheet](native-release-validation.md)
for hardware inventory, exact artifact/API identity, testers, results and evidence.
Agree performance thresholds before treating measurements as acceptance.

## Listening and controls

Repeat through the speaker and Bluetooth headphones; test AirPlay and Chromecast
separately where supported. Use speech, quiet/noisy recordings, music and long
pauses, with local/downloaded files as well as streaming.

- Start, pause, resume and stop without lost words, clicks or position jumps.
- Toggle Volume Boost and Trim Silence separately and together. Compare the same
  passage at a fixed comfortable volume; check for pumping, noise and clipped
  words. A louder result alone is not better quality.
- Exercise every supported speed and temporary speed controls, both paused and
  playing. Seek forwards/backwards and across chapter artwork boundaries.
- Confirm chapters, timestamp links, skips and saved progress use original episode
  time with trimming and speed changes enabled.
- Lock the screen, switch apps, receive interruptions, and connect/disconnect
  headphones. Check system controls and respect the listener's pause intent.
- Listen through the final words and queue advance. Starvation, seeking and stop
  must not produce a completion event.
- Test screen readers, large text, touch targets and keyboard controls where
  available. Essential actions must not depend on gestures alone.

## Downloads and account changes

- Download, suspend, interrupt connectivity, relaunch and retry. Partial files
  must not appear as completed downloads or create duplicate entries.
- Test airplane-mode relaunch, playback, seeking and queue advance using two
  completed downloads. Test force-quit separately from ordinary suspension;
  iOS does not promise continued transfers after force-quit.
- Pause offline, reconnect and check resume on another client without an extra
  playback action. Repeat after seeking backwards.
- With disposable accounts, sign out and switch identities online and offline.
  Old private media, artwork, pending writes and queue state must not reach the
  new account. Reconnection must not restore the retired session.
- Confirm errors and shared links never expose private feed or enclosure URLs.

## Measurements

Measure audible response, not just control animation. Include sample count,
median and p95 for start, seek and effect changes. Separate accessory latency
from application delay.

Run sustained downloaded playback at every speed, including screen lock and
background use. Record underruns, source-position errors and memory after warm-up
and at the end. Distinguish owned audio buffers from whole-process memory.

For power comparisons, use the [Audio Lab](../audio-engine/README.md#local-ios-audio-lab)
with measurement overlays off. Compare matched native and platform-reference
runs using the same file, route, volume, speed, build settings, display/network
state and thermal conditions. Alternate order and repeat; battery percentage
alone is not a useful measurement.

Independently measure final output peaks after speed conversion and limiting.
Check marker timing and loudness after warm-up, including cases where gain limits
prevent reaching the target. Use the [audio contract](../contracts/audio/README.md)
and engine tests for expected behaviour, not results from another device.

Keep untested combinations explicitly untested. Attach reproducible failures and
measurements rather than treating a successful build as release approval.

## Playback diagnostic recordings

Open Settings → Playback diagnostics → Start recording, then listen normally.
Recording continues during background playback and screen lock. Use Mark glitch
on that screen or Mark audio glitch in the Now Playing menu when a gap is heard.
For a locked-screen incident, mark it after unlocking and note the approximate
time. Stop and save before sharing a saved recording through the system share
sheet. A recording is a JSON Lines file, not an Instruments capture.

Record one session with streaming, then a separate session starting playback
from a completed download of the same episode. Include the usual speed, effects,
and output route; note any intentional changes. A download finishing during an
existing stream usually does not replace that stream. The trace records the
exceptional effects-related promotion to a downloaded file.

Capture is off by default. The recorder retains up to ten files, each capped at
64 MB, with a bounded pending-event queue and reported drop count. Files are
excluded from backup and flushed every two seconds during activity. Closing the
app can lose the last unsaved events; earlier lines remain shareable after
relaunch. Relaunch does not automatically begin another recording. Delete saved
recordings using their swipe action after exporting them.

Every line contains `sequence`, monotonic `uptime` in seconds, `event`, numeric
`values`, and restricted string `labels`. `trace_start` includes schema version
1, wall-clock time, app/build/device/OS and bundled source revision. Correlate
`sourceId`, playback `generation`, routing `session`, and audio `graph` identifiers;
these are independent lifetimes. Network request IDs connect request timing,
response metrics and completion. Public numeric catalogue IDs identify episodes.
No audio samples, titles, account identifiers, URLs, credentials, headers or
server validators are stored, and recordings are never uploaded automatically.

| Evidence | Events / fields |
| --- | --- |
| Heard incident | `user_glitch`, marker number and source position |
| Streaming delay | `media_cache_miss`, `media_range_wait`, `media_request_*`, redirects, first-byte/body timing and connection reuse |
| Decoder delay | `decoder_*_wait`, `audio_decode_read_wait`, pending-read and worker tick durations |
| Audio starvation | `audio_underrun_started`, branch missing frames and buffer levels, recovery and graph transitions |
| Output scheduling | `audio_snapshot`, callback-gap candidates, sample-time discontinuities, failed/silent frame counters |
| System-player buffering | `avplayer_sample`, `avplayer_stall`, access/error metrics and waiting reason |
| Playback intent and routing | `route_*`, `audio_*`, backend, speed/effects, seeks, pause, downloads and recovery |
| Phone context | `phone_sample`, main-thread tick interval, output latency/buffer size, thermal/power state, interruptions, route and network changes |

The audio render callback records only fixed atomic counters while enabled;
sampling, formatting and bounded file writes happen off the render thread.
Snapshots are approximately once per second. Native output counters are totals
for a graph, so compare consecutive snapshots within that graph. Callback-gap
candidates can reflect callback batching; silent frames can be legitimate source
content. Neither alone proves an audible dropout. Underrun recovery timing ends
at graph restart, not at independently measured speaker output. Interpret these
signals together with buffer depletion, request waits and listener markers.
