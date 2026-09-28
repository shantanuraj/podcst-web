# Audio experience: iPhone validation

All physical-device results are **pending**. The first supported routes to check are the iPhone speaker and Bluetooth headphones. AirPlay is **unverified**. Passing a simulator test or building the app does not complete these checks.

The candidate has one known numerical gap: Apple TimePitch transient displacement reached 18.782 ms against the original 10 ms target; the position discrepancy is not cumulative drift. Conservative device buffering also makes the ≤300 ms effect-response target unverified, particularly for low-rate audio at 0.5×. Record these measurements without assuming the simulator bounds apply to hardware.

This worksheet follows the [audio experience plan](audio-experience-plan.md). Start with the hands-on checks; the longer profiling runs are release gates, not prerequisites for trying the player.

## Test setup

| Detail | Record |
| --- | --- |
| Date and tester | Pending |
| iPhone model and iOS version | Pending |
| App build / commit | Candidate `7f0ea9c`; record the exact device build tested |
| Bluetooth headphones and firmware, if known | Pending |
| Public speech episode | Pending |
| Private-feed episode, using a local label only | Pending |
| Music / noisy recording / quiet speech examples | Pending |

Download one public episode and one existing private-feed episode completely. Choose an episode with show-note timestamps or chapters. Keep the device volume comfortable and fixed when comparing Volume Boost. Use the same source passage when comparing settings.

## Hands-on checks

Repeat playback checks first through the iPhone speaker, then through Bluetooth. Record Pass, Fail, or Not tested; all entries below begin Pending.

| Check | What to do and what should happen | Speaker | Bluetooth |
| --- | --- | --- | --- |
| Start and resume | Play a downloaded episode, pause, and resume. Audio should start promptly, with no missing word, repeated phrase, click, or jump in position. | Pending | Pending |
| Volume Boost | Turn on Volume Boost during quiet speech, then turn it off. Voices should be easier to hear at the same device volume. Loud speech should remain comfortable; pauses should not become noisy. | Pending | Pending |
| Trim Silence | Turn on Trim Silence during conversation with pauses. Pauses should shorten naturally while words, breaths, and the rhythm of dialogue remain intact. Toggle it during a pause and again during speech. | Pending | Pending |
| Both effects | Enable both effects and listen through a quiet speaker, a louder speaker, and background music. There should be no harsh peaks, pumping, chopped words, or unnatural edits. | Pending | Pending |
| All speeds | Try 0.5×, 0.75×, 1×, 1.25×, 1.5×, and 2×. Change speed while playing and while paused. Resume should preserve the requested speed and source position. | Pending | Pending |
| Temporary 2× | At a speed other than 2×, press and hold the episode title in Now Playing, then release. Playback should return to the chosen speed without changing its saved setting. | Pending | Pending |
| Show notes and chapters | With trimming on, open show notes and select a timestamp or chapter. The audio should begin at that point in the original episode. Repeat after seeking backward and changing speed. | Pending | Pending |
| Seek and skip | Seek forward and backward, including into a quiet passage. Use the 10-second back and 30-second forward controls. Positions should refer to the original episode; audio from before the seek must not briefly return. | Pending | Pending |
| Background and lock screen | Play, lock the phone, use other apps, then return. Check cover art, episode title, play/pause, skip, and position on the lock screen. Playback and source position should remain consistent. | Pending | Pending |
| Interruptions | Receive a call or another normal audio interruption. Audio should pause appropriately; dismissal should respect whether you had paused it yourself. No overlapping players or sudden restart. | Pending | Pending |
| End of episode | Listen through the final words into the next queued episode. The tail should play once and the queue should advance once. Seeking or stopping near the end must not mark a different episode complete. | Pending | Pending |

### Settings and layout

| Check | What to verify | Result |
| --- | --- | --- |
| Defaults | Open Settings → Audio defaults. Change speed and effects, then play a podcast with no override. It should inherit those choices. | Pending |
| Podcast override | From Now Playing → Audio, select This podcast and change an effect. Another podcast should keep its own settings. Close and reopen the app; the override should persist. | Pending |
| Return to defaults | Choose Use defaults for that podcast. Future changes to defaults should apply to it again. | Pending |
| Scope stays put | Leave This podcast’s Audio sheet open while the queue advances to another podcast. The sheet must continue editing the podcast named when it opened. | Pending |
| Global scope is honest | While the current podcast has an override, select All podcasts. The sheet should explain that defaults do not replace the current podcast’s settings. | Pending |
| Accessible controls | Use large accessibility text and VoiceOver. Audio controls, download progress, retry, and removal should remain readable, reachable, and clearly labeled in light and dark appearance. | Pending |

### Offline, downloads, and recovery

| Check | What to verify | Result |
| --- | --- | --- |
| Offline relaunch | After downloads finish, enable airplane mode and keep Wi-Fi off. Relaunch the app, open Library → Downloads, and play both public and private episodes. Show notes and seeking should still work. Re-enable Bluetooth separately to repeat through headphones. | Pending |
| Partial download | Pause a download before it finishes. Relaunch, resume it, and confirm it becomes available offline only when complete. Removing a partial download should remove its pending entry. | Pending |
| Failed download | Interrupt a download with a connection loss. Its status should remain understandable, with a working retry. Retry should not create a duplicate episode. | Pending |
| Active download removal | Try to remove the downloaded episode currently in use. The app should explain why it cannot remove it yet. Play a different episode and try again. | Pending |
| Streaming interruption | Play an episode that is not fully downloaded, disconnect the network, and wait for buffered audio to run out. The source position must stop when audio stops. Restore connectivity and resume without lost or repeated speech. | Pending |
| Private feed | Play an existing private-feed episode online and offline, then reopen its details. Download and playback errors must not display the private feed or enclosure URL. | Pending |
| Web resume | After listening with trimming and speed changes, pause at a recognizable passage. Open the web player and verify resume at the same original-episode position. Seek backward in iOS, listen for over 30 seconds, pause, and verify again. | Pending |
| Account separation | Using test accounts and expendable downloads, sign out and switch accounts. Previous private downloads, queue entries, and library screens must not appear in the other account. Repeat sign-out offline; reconnecting must not silently sign the old account back in. | Pending |

### Bluetooth transitions

| Check | What to verify | Result |
| --- | --- | --- |
| Connect while playing | Connect the headphones during speaker playback. Check route, position, volume, and active effects. | Pending |
| Disconnect | Disconnect the headphones during playback and while the app is buffering. Audio should pause instead of unexpectedly continuing on the speaker. | Pending |
| Reconnect | Reconnect and resume. There should be no stale audio, incorrect speed, or lost effect settings. | Pending |
| Headphone controls | Test the accessory’s play/pause and skip controls while the phone is locked. | Pending |

## Listening notes

Use short labels for private material; do not include private URLs, credentials, episode audio, or show notes in shared reports.

| Source label and timestamp | Route | Speed / effects | Observation | Result |
| --- | --- | --- | --- | --- |
| Pending | Pending | Pending | Pending | Pending |

For artifact comparisons, compare the same passage at similar perceived loudness. Separately assess whether Boost improves quiet speech with the device volume fixed. Include whispered speech, breaths, an old noisy recording, music beds, already-loud audio, and unusually long pauses. A louder result alone is not a quality pass.

## Profiling and release gates

These measurements require development tooling. Do not replace them with impressions from the hands-on checks, or fill them from simulator results.

### Responsiveness

Measure gesture-to-audible response, not just the time until a control changes appearance. Record the sample count, median, and p95. Include repeated starts and forward/backward seeks in a downloaded file, plus effect toggles outside buffering.

| Route | Operation | Samples | Median | p95 | Acceptance | Result |
| --- | --- | --- | --- | --- | --- | --- |
| iPhone speaker | Start / seek | Pending | Pending | Pending | p95 ≤500 ms on the oldest available supported iPhone | Pending |
| iPhone speaker | Audible effect change | Pending | Pending | Pending | ≤300 ms outside buffering | Pending |
| Bluetooth | Start / seek / effect change | Pending | Pending | Pending | Record accessory latency separately from application delay | Pending |

### Sustained playback and memory

Run a downloaded file for **60 minutes at each supported speed**, with both effects enabled. Repeat for speaker and Bluetooth. Log underruns, unexpected stops, position errors, and memory after warm-up and at the end. The target is zero underruns during local playback and no memory growth with episode length. Include lock/background use without changing the route during the baseline run; test route changes separately.

| Route | Speed | 60-minute run | Underruns / unexpected stops | Memory after warm-up → end | Source-position check | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Speaker | 0.5× / 0.75× / 1× / 1.25× / 1.5× / 2×, record each separately | Pending | Pending | Pending | Pending | Pending |
| Bluetooth | 0.5× / 0.75× / 1× / 1.25× / 1.5× / 2×, record each separately | Pending | Pending | Pending | Pending | Pending |

Record owned audio/mapping storage separately from total process memory. The initial owned-storage budget is **8 MiB** for supported mono/stereo audio up to 48 kHz, excluding codec internals. Verify that paused and stopped playback does not leave the audio graph doing unnecessary work. Device memory measurements supplement the six-hour synthetic processing gate in the implementation plan.

### Power: matched 30-minute runs

The development-only Audio Lab can run both transports. Use the **Podcst Audio Lab** scheme, which installs the separate Audio Lab app; enable its `-AudioLabReference` launch argument for AVPlayer, and disable it for the native path. Open the same local file in each run. The Audio control exposes effects on the native path; the reference hides unsupported effects and keeps speed controls available. The Podcst app always uses production routing. Profile equivalent optimized builds and verify that scheme/build settings match; neither comparison establishes release performance if build settings differ.

For streaming checks, choose **Browse podcasts** to pick from US charts or search by podcast name or RSS link, then select an episode. Lab media uses a separate cache and test playback does not update listening history. The Engine label distinguishes the custom engine, AVPlayer reference, and format/server fallbacks. A fallback run does not measure the custom engine. Keep local-file power comparisons separate from streaming comparisons, which also measure network and cache behavior.

The selected episode's **Download** control stores its complete audio in the lab cache. Choose **Play download** to restart from that file. This also lets the custom engine test downloadable formats from servers that cannot stream reliably through the progressive decoder.


Compare the native player with both effects enabled against an AVPlayer reference using the same downloaded file, route, device volume, playback speed, display state, and network conditions. Alternate the order and repeat matched pairs; compare medians. Use at least three pairs for each reported condition. Record charging state, thermal state, and the profiling tool so results can be repeated. Battery percentage alone is insufficient for this comparison.

| Pair / order | Device / OS / route / rate | Charging / thermal / display state | AVPlayer: 30-minute energy | Native: 30-minute energy | Relative difference | Worker + render CPU | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |

Initial targets from the plan: worker plus custom rendering below **5% of one core**, measured separately from whole-process energy; whole-process energy regression provisionally **≤20%** relative to AVPlayer. Establish repeatability before treating the energy budget as final. Record failures and their cause rather than loosening the target to obtain a pass.

### Output and reliability evidence

| Gate | Required evidence | Result |
| --- | --- | --- |
| Final peaks | Independent oversampled measurement of the final rendered output at every supported speed and tested route format; no nonfinite output or hard clipping. Initial target: no more than -1 dBTP + 0.2 dB measurement tolerance on the declared vectors. | Pending |
| Loudness | Steady speech within 2 LU of the chosen target after a declared warm-up where gain limits permit; uncertain quiet/noise does not cause uncontrolled upward gain. | Pending |
| Source time | Measured position against known audio markers, with graph latency compensated and route uncertainty reported separately; chapters and web resume use the same source position. | Pending |
| Network recovery | Controlled starvation, retry, changed media, range rejection, and expired private authorization behave predictably without corrupting downloads or source time. | Pending |
| System recovery | Background playback, interruptions, route transitions, and media-services reset preserve the appropriate playback intent. | Pending |
| AirPlay | A separate physical route matrix, latency, effects, and reliability run is required before claiming support for effects. | Unverified |

## Result summary

| Area | Status | Evidence / issue reference |
| --- | --- | --- |
| Speaker experience | Pending | Pending |
| Bluetooth experience | Pending | Pending |
| Offline and private feeds | Pending | Pending |
| Settings, accessibility, and sync | Pending | Pending |
| Sound quality | Pending | Pending |
| Responsiveness, sustained playback, and memory | Pending | Pending |
| Power | Pending | Pending |
| AirPlay | Unverified | No physical evidence recorded |

For a failure, record the build, route, source label, original-episode timestamp, speed/effects, exact steps, and expected versus observed behavior. Keep physical gates pending until their evidence has been recorded and reviewed.
