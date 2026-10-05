# Audio device testing

Simulator and DSP tests do not establish physical-device sound quality, battery
use or route behaviour. Test an optimized build on real devices, including an
older supported model. Record the commit, device/OS, route, speed, effects and
steps with each result; keep personal device identifiers and private media out
of shared reports.

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
