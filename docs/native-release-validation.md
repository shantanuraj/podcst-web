# Native acceptance worksheet

Copy this worksheet into a private release record. Do not commit populated device
inventories, account details, private media URLs, raw captures or store receipts.
Use disposable accounts and synthetic/public media. Start with
[audio device testing](audio-device-validation.md) and
[signed distribution](native-distribution.md).

## Candidate and inventory

Record full app SHA, API revision and protocol/migrations, release version/build,
artifact SHA-256, store build/release identity, toolchain/dependency lock hashes,
installation channel and predecessor artifact for update tests. Assign separate
iOS and Android testers plus a release owner. Unknown assignments stay unassigned.

| Required slot | Actual model / OS build | Tester | Availability | Status |
| --- | --- | --- | --- | --- |
| Older supported iPhone at minimum supported OS | Unassigned | Unassigned | Unknown | Untested |
| Current iPhone / current OS | Unassigned | Unassigned | Unknown | Untested |
| iPad while device family 2 is enabled | Unassigned | Unassigned | Unknown | Untested |
| Android 13 low/mid-tier arm64 | Unassigned | Unassigned | Unknown | Untested |
| Current stock Android | Unassigned | Unassigned | Unknown | Untested |
| Current OEM Android | Unassigned | Unassigned | Unknown | Untested |
| 16 KB Android environment (emulator supplements hardware) | Unassigned | Unassigned | Unknown | Untested |

Record available Bluetooth, AirPlay and Cast routes separately. A simulator cannot
fill a physical hardware slot. Explicit owner approval is needed to change device
scope or declare a combination not applicable.

## Per-case evidence

Each row must identify the candidate above and record:

| Field | Required content |
| --- | --- |
| Case / combination | Stable case ID; model/OS, route, speed, effects and streaming/download source |
| Setup and steps | Reproducible actions; clean install/update, account scope, connectivity and interruption details |
| Expected / observed | Exact outcome, including absence of unwanted state writes or private disclosure |
| Execution | Tester, date/time, repetition count and duration |
| Result | Pass, fail, blocked, untested, or owner-approved not applicable |
| Evidence | Sanitized capture/log/measurement reference and defect reference; raw data protected separately |

Do not collapse a matrix into one passing checkbox. Enumerate each supported speed
and effects off/boost/trim/both, routes and hardware actually exercised. Reuse old
unit/simulator evidence only with exact source/build-input/lockfile/workflow
comparison and original run references. Signing or behavioral changes invalidate
affected evidence; final store-installed smoke tests cannot be inherited.

## Acceptance cases

| ID | Exercise and expected boundary |
| --- | --- |
| A01 | Streaming and downloaded audio across the listening matrix in the audio guide; source-time seeks, final words and exactly-once completion |
| A02 | Lock screen/background, interruption/call, route disconnect and manual pause; no unintended auto-resume |
| A03 | Duration/end-of-episode timers, seek/speed/trim, background expiry, interruption resume, manual next and account change; no timer-generated completion |
| A04 | Two completed downloads in airplane-mode relaunch: seek and queue advance; partial/cancel/retry/remove, low disk and no false offline availability |
| A05 | Suspension versus force-quit transfer behavior, file protection and restart; distinguish OS limitations from app promises |
| S01 | Offline rewind, process death, reconnect and another-client resume; retry is not new intent, including completed/null checkpoints |
| S02 | Lost-ack star/follow then another-client removal, restart/replay; no resurrection or stale-cache upload |
| S03 | Account A → B → A with pending work, offline departure and session expiry; no wrong-account writes, metadata or media |
| S04 | Confirmed deletion, lost acknowledgement, restart/storage failure and deletion during playback/download; no false erasure or late cache recreation |
| S05 | Retained-state upgrade: queues, downloads, exact IDs and frozen numeric-Starred migration; unresolved data stays visible/blocked, not guessed |
| L01 | Canonical episode/moment/chapter/clip links cold/warm from external apps, both hosts, guest and signed-in; verify native arrival versus web tap-to-play |
| L02 | Installed/uninstalled anonymous web fallback, offline/private/missing/mismatched/malformed target, newer link superseding lookup, account change; no private locator exposure |
| L03 | Clip borrowed queue slot and restoration, bounded seeks, close/keep-listening/full-episode choices; clip mode does not save progress or completion |
| H01 | Store-installed passkey registration/login/cancellation and expiry on both hosts; preserve auth trust when changing association identities |
| X01 | VoiceOver/TalkBack, large text, contrast, reduced motion, focus and keyboard where supported; no essential gesture-only action |
| P01 | Sustained every-speed runs: underruns, source error, warm/end memory, matched native/reference power measurements |
| P02 | Audible start/seek/effect latency: sample count, median, p95; separate accessory latency and record test duration/conditions |
| I01 | TestFlight/Play internal clean install and update from the recorded predecessor; versions, actual signer, pending work, auth and links |

Cases whose feature or dependency is unavailable remain **blocked**, not passed or
silently removed. Route defects to the responsible implementation owner and repeat
affected combinations on the integrated candidate.

## Performance and sign-off

Before measurement, the owner records acceptable underruns, source-time error,
warm/end memory, power and latency thresholds plus sample counts/durations and
comparison conditions. Empty thresholds mean no performance acceptance, even if
measurements exist. Use matched runs and the Audio Lab procedure; battery
percentage alone is insufficient.

Record each gate's approver, date, evidence references, open defects and explicit
scope exclusions. Physical listening/state/accessibility, coherent recovery,
signed internal installation and public submission each require their own result.
Neither a completed worksheet template nor a successful build is release proof.
