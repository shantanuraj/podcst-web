# Playback contract vectors

These files hold the playback rules and behavioural vectors replayed by both native clients' test suites. Change the shared rules and both clients together; this document describes the vector formats.

| File | Contents | iOS source |
| --- | --- | --- |
| `rules.json` | Numeric and product rules | `PlaybackController.swift`, `LibraryStore.swift`, `MediaStore.swift`, `DownloadedMediaFile.swift`, `ArtworkStore.swift`, `SettingsView.swift`, `DiscoverView.swift` |
| `queue.json` | Queue and session transitions | `PlaybackController.swift` |
| `preferences.json` | Speed and effect inheritance | `AudioPreferences.swift`, `PlaybackController.setRate` |
| `shownotes.json` | Chapter and timestamp parsing | `Core/ShowNotes.swift` |
| `releases.json` | New Releases selection and day sections | `LibraryStore.newReleases`, `ReleaseSection.swift` |

## `queue.json`

Each case has `initial`, `steps` and `expected`. Episodes are identity strings; two episodes are the same episode when their strings are equal. `current` is the index into `queue` and is 0 for an empty queue. `active` is iOS `isActive`: a current episode exists and the session is not idle.

Build `initial` by enqueueing `queue` in order into an empty controller. If `active` is true, then play `queue[current]`. If `active` is false and `current` is greater than 0, play `queue[current]` and then stop.

| Operation | Meaning |
| --- | --- |
| `play {episode}` | Play an episode; an unqueued episode is appended. |
| `enqueue {episode, next}` | Add to the queue; `next: true` inserts after the current episode. |
| `finish` | The transport reports the end of the current episode. Used only while active. |
| `markPlayed` | The user marks the current episode played. |
| `next`, `previous` | Skip to the adjacent queue episode, wrapping at either end. |
| `remove {indices}` | Remove queue positions. |
| `removeUpNext {offsets}` | Remove positions within Up Next, where offset 0 is the episode after the current one. |
| `moveUpNext {from, to}` | Move within Up Next; `to` uses insertion-before semantics. |
| `move {from, to}` | Move a queue position; `to` uses insertion-before semantics and is clamped to the queue length. |
| `clear` | Empty the queue. |
| `stop` | Stop playback, keeping the queue and the current episode. |
| `reopen` | Return a stopped session to paused without loading audio. |
| `pause` | Pause. |

Up Next is the queue after the current episode followed by the queue before it (`PlaybackController.upNext`). The two Up Next operations first rotate the queue so the current episode is at index 0.

## `preferences.json`

Each case starts from an empty preference store and applies `steps`. Options are `{speed, volumeBoost, trimSilence}`.

| Operation | Meaning |
| --- | --- |
| `set {feed, options}` | Store options for a podcast feed, or the defaults when `feed` is null. |
| `setRate {currentFeed, speed}` | The player's speed control while an episode of `currentFeed` is current (null when nothing is current). |
| `useDefaults {feed}` | Remove the podcast's override. |
| `restore {defaults, overrides}` | Load a persisted snapshot. |

`expected.overrides` is keyed by the plain feed URL. iOS stores the SHA-256 of the feed URL as the key so credentials never reach disk (`AudioPreferences.key`); the hashed key is a storage detail, not part of the contract. `expected.effective` gives the options that apply to each listed feed.

## `shownotes.json`

`chapters[].html` is show-notes HTML and `expected` the parsed chapters, with `start` in seconds. `timestamps[].text` is plain text and `expected` the timestamp strings that become seek links. `seconds[]` converts a timestamp to seconds; `null` means rejected.

The iOS patterns use ICU semantics. `\s`, `\p{P}`, `\p{S}` and `\p{Pd}` are Unicode classes, line splitting accepts every Unicode newline, and title trimming removes Unicode spaces but not newlines. A Java or Kotlin port needs `Pattern.UNICODE_CHARACTER_CLASS` or equivalent explicit classes to match.

## Library listening state

New episodes/releases means recently published, not unplayed. Completion does not
remove or reorder a release, including in the combined Continue & new preview.
Only unfinished episodes belong in the Continue portion of that preview.

Completed rows show **Played**, never **New**, with chapter-like dimming of artwork
and text. Playback, navigation and other actions remain enabled and undimmed.
Actively replaying an episode restores its emphasis. Use the account's saved
`completed` flag, including manual completion at position zero, rather than
inferring completion from the feed duration. Pending local progress takes
precedence over a remote read, and account changes discard the prior account's
presentation state while retaining protected pending work for its original scope.

Completion comes only from ended/manual played events. Mark unplayed resets to
zero/incomplete; deliberate replay clears completion. Position-only checkpoints
at 94%, 95% or 100% do not complete an episode and use the durable protocol's
explicit `completed:null` mask, so another device's played flag is not cleared.
See [state vectors](../state/fixtures.json) for the transition and wire boundary.

## `releases.json`

`newReleases[]` lists subscribed podcasts and the expected episode IDs, using `releases.perPodcast` from `rules.json`. An episode with a null `published` sorts as the earliest possible date. The cases contain no ties; tie order is unspecified.

`sections[]` groups episodes, in their given order, by UTC calendar day. `expected[].day` is the UTC date or null, `title` is the `en_US` title relative to `now`, and `recent` is true for days 0–6 before `now`. Titles are `Today`, `Yesterday`, the weekday name for two to six days ago, the long date otherwise (including future days), and `Date unavailable` for a null date. Other locales use the platform's localized forms of the same rule.
