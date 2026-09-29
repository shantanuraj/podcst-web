# First public iOS release roadmap

Status: proposed product scope, not release certification.

Related plans: [pre-release foundations](pre-release-foundations.md) and [private-feed ownership](private-feed-ownership-plan.md).

This public roadmap contains requirements and design decisions. Production inventories, account mappings, security investigation results, deployment receipts and recovery artifacts belong in protected operational storage, not this repository.

## Release promise

Find a show, follow it, listen reliably online or offline on iPhone, save an episode, resume across iPhone and web, and share a moment that someone can open without installing or signing in.

Ship synced Starred episodes and timestamp sharing before a general playlist platform or rendered clip exports. Scope is dependency-based; delivery dates require agreed capacity and target users.

## Roadmap

| Milestone | iOS | Web | Backend and operations | Exit gate |
| --- | --- | --- | --- | --- |
| Trust and accounts | Privacy/support controls, account deletion, working authentication and safe account transitions | Equivalent lifecycle controls and safe feed-content rendering | Private-source authorization, bounded fetching, abuse controls and deletion semantics | Authorization and account-lifecycle tests pass |
| Dependable listening | Background/lock-screen playback, route changes, downloads, queue recovery, resume, sleep timer and accessibility | Reliable queue/restoration, durable pending writes and accessible controls | Revisioned progress, per-episode reads and observable feed freshness | Physical-device and cross-client recovery tests pass |
| Saving and sharing | Star actions, Starred library, timestamp sharing and Universal Links | Synced stars, copy-link fallback and anonymous timestamp playback | Membership, saved-content retention, stable public links and coherent backups | Offline save → sync → web works; shared links work with and without the app |
| Release rehearsal | Signed build, TestFlight, review access and accurate disclosures | Supported-browser smoke tests | Required CI, migration rehearsal, alerts, restore and rollback drills | Release checklist passes for the exact candidate |
| Next release | Manual playlists, bounded clip links and podcast pins if justified | Playlist editing and clip-preview parity | Ordered memberships and explicit conflict handling | Listener demand and regression tests justify expansion |
| Later | Download automation, richer chapters/transcripts and additional platforms/integrations | Richer organization and optional offline audio | Authorized rendered clips, quotas, storage lifecycle and abuse handling | Separate scope and operating-cost decisions |

Start device testing and operational preparation early. Cut optional feature breadth before privacy, data integrity or reliable playback.

## Saving semantics

- **Follow:** receive a show's releases.
- **Starred:** saved episodes, independent of completion, queue and downloads.
- **Playlist:** a reusable ordered episode collection. Playing it does not consume the list.
- **Queue:** the current listening sequence; persist locally before attempting cross-device queue synchronization.
- **Downloads:** a view derived from complete files on the current device, not a server-synced list of available audio.
- **Podcast favorites:** define whether these mean quick-access pins or named show collections before adding them.

Treat Starred as a protected system collection with membership as its sole truth. Use explicit star/unstar operations rather than a retry-sensitive toggle endpoint. Derive counts and visual state; avoid duplicate favorite flags.

Support accessible buttons/menus alongside gestures, Undo, stable sorting and meaningful empty/offline/error states. Guest data remains local until an explicit account merge succeeds. Never replay pending mutations into another account.

Saved episode identity and essential metadata must survive catalog eviction. This does not promise permanent publisher audio availability. Protect referenced episodes individually rather than retaining entire shows unnecessarily, and handle partially missing content explicitly.

Do not expose playlist creation or manual sorting until those operations are persisted and functional.

## Listening semantics

Pause retains the current session. Stop saves position, keeps the queue and clears the active system player. Completion and played/unplayed actions are explicit; transport failure must not mark an episode played.

A basic sleep timer supports durations and end-of-episode. Define its behavior across speed changes, interruptions and automatic queue advance.

Manual downloads are enough initially. Require progress, cancel/retry/remove, storage usage and a clear cellular policy. Test low disk, partial files, changed media, suspension and relaunch. Only complete validated files are described as available offline; do not promise transfers continue after an iOS force-quit.

## Sharing in three steps

1. **Episode/timestamp links:** canonical public IDs and validated original-episode seconds; native routing, copy-link fallback and anonymous web playback. Opening a link does not automatically play, overwrite resume state or destroy the queue.
2. **Bounded clip links:** start/end selection, preview, stop-at-end and “Continue full episode.” Keep preview playback separate from normal progress/completion state.
3. **Rendered audio/video:** a separate product requiring source rights, bounded jobs, quotas, attribution, storage retention and abuse/takedown handling.

Never put private feed locators, credentials or account identifiers in public links. Do not publicly share private-feed content. Dynamic ads and changed enclosures can shift timestamps; do not promise sample-accurate alignment between different audio representations.

## Release gates

- **Security/privacy:** authorized source access across routes, metadata, caches and workers; safe untrusted content/fetching; bounded authentication attempts; tested deletion and account isolation.
- **Listening:** physical-device streaming/downloads, offline relaunch, background/lock-screen playback, Bluetooth transitions, interruptions, queue completion, sustained memory/power and source-time checks.
- **Data integrity:** duplicate/reordered requests, lost acknowledgements, offline conflicts, rewind/relisten, played/unplayed, star/unstar, process death and account switching.
- **Accessibility:** VoiceOver, Dynamic Type, contrast, reduced motion, usable touch targets and keyboard/screen-reader web flows. No essential gesture-only actions.
- **Sharing:** cold/warm native opening and anonymous web fallback; safe handling of invalid, removed and private resources.
- **Operations:** target-load measurements, dependency/worker outage tests, alert delivery, migration/rollback rehearsal and coherent restore including saved-content references.
- **Distribution:** working advertised features, privacy disclosures/policy, account deletion, support contact, accurate metadata and reproducible review access. Add billing/purchase restoration requirements if charging.

Keep the architecture simple. Existing platform-specific audio work should be judged by measured behavior, not replaced reflexively. Proposed availability, recovery and performance objectives need an owner, measurement definitions and an operating budget before they become promises.

## Decisions still needed

- Target listeners, release capacity and the workflows that justify switching.
- Whether bounded clips or manual playlists are essential differentiation for the first release.
- Guest/private-feed behavior, guest merge and conflict UX.
- Monetization, supported platforms/languages/routes, recovery objectives and support ownership.

## Primary references

Competitor features are category signals, not proof that every feature belongs in the first release. Platform obligations and publisher rights must be checked again before submission.

- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple: Offering account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Apple: App privacy details](https://developer.apple.com/app-store/app-privacy-details/)
- [Pocket Casts: Sharing podcasts, episodes and clips](https://support.pocketcasts.com/knowledge-base/sharing-podcasts-and-episodes/)
- [Pocket Casts: Sleep timer](https://support.pocketcasts.com/knowledge-base/sleep-timer/)
- [Overcast](https://overcast.fm/)
- [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
