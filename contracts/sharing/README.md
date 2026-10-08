# Sharing contract

[`links.json`](links.json) holds the public link vectors that web, iOS and Android all replay. A public link names a show or an episode by its canonical decimal IDs, and an episode link may also carry a moment.

| Mode | Link |
| --- | --- |
| Show | `https://www.podcst.app/episodes/{podcastId}` |
| Episode | `https://www.podcst.app/episodes/{podcastId}/{episodeId}` |
| From a time | `…/{episodeId}?t=18m12s` |
| Clip | `…/{episodeId}?t=18m12s-21m40s` |
| Chapter | `…/{episodeId}?ch=3&t=17m40s-36m05s` |

## Generating

- The origin is always `https://www.podcst.app`.
- IDs must be canonical (`contracts/state/schema.json#/definitions/id`). Content without canonical IDs, or private content, cannot be shared publicly. There is no fallback to a feed URL or GUID.
- Times are whole seconds of the original media, floored from the playhead. The format is `{s}s` under a minute, `{m}m{ss}s` under an hour, and `{h}h{mm}m{ss}s` otherwise.
- A clip or chapter range must still satisfy `start < end` after flooring.
- `ch` is the chapter's one-based position in the episode's chapter list. A chapter link always carries the chapter's range, so it still plays the right span after the feed's chapters change.
- Every time must fall within `0…maxSeconds` (seven days).
- A target that breaks a rule produces no link (`expected: null`).
- In `generate` vectors, the string `"NaN"` stands for a non-finite playhead.

## Parsing

A link is ours only when all of these hold. Anything else returns `null` and is not handled.

- The scheme is `https` and the host is exactly `podcst.app` or `www.podcst.app`.
- There is no port and no userinfo.
- The path is exactly `/episodes/{podcastId}` or `/episodes/{podcastId}/{episodeId}`, with canonical IDs and no trailing slash.

Query keys other than `t` and `ch` are ignored and never re-emitted. The fragment is ignored.

A malformed moment never rejects the link. The episode or show still opens normally, and `invalidMoment: true` tells the client to show "That moment isn't available". The value is never clamped or guessed. A moment is malformed when any of these hold:

- `t` or `ch` appears more than once.
- A time is not `[{h}h][{m}m][{s}s]` with at least one component and decimal digits only.
- A component that follows a larger unit is 60 or more.
- A time is greater than `maxSeconds`.
- A range does not have exactly one `-`, or its end is not after its start.
- `ch` is not a decimal without leading zeros, starting at 1.
- `ch` appears without a range `t`.
- `t` or `ch` appears on a show link.

Whether the time is before the end of the media is checked when playing, against the measured duration first and the RSS duration second.

## Behaviour

| Mode | Opening the link |
| --- | --- |
| Show | Opens the podcast page. |
| Episode | Opens the episode. |
| From a time | Plays from `start` to the end, like any episode, and saves progress normally. A toast or snackbar says "Started at 18:12 from a shared link" and offers to start from the beginning. |
| Clip / Chapter | Plays `start…end` in clip mode, as described below. |

In clip mode:

- The seek bar covers only the range, and a strip shows where the range sits in the episode.
- Nothing writes progress or completion, and the saved place in the episode does not move.
- At `end`, playback pauses and the listener chooses:
  - Keep listening from `end`, which leaves clip mode and saves progress from then on.
  - Replay.
  - Next chapter, which is the first choice for a chapter link when a next chapter exists.
  - Add episode to queue.
- Play full episode leaves clip mode where the playhead is.
- Stopping, or playing another episode, also leaves clip mode.

The linked episode only borrows the queue while in clip mode:

- Keep listening and Play full episode keep it as the current episode.
- Add episode to queue moves it to the end of the queue and makes the previously current episode current again, paused.
- Close, or leaving clip mode any other way, removes it from the queue unless it was already queued before the link opened. The previously current episode becomes current again, paused.

Arrival rules:

- iOS and Android start playback on arrival. The linked episode becomes current and the previously current episode moves to the top of Up Next. Nothing else in the queue changes.
- On the web, the page renders the moment and waits for a tap, because browsers block autoplay.
- When a moment cannot be played (its start is at or after the end of the media), the episode opens normally with the "isn't available" message.

## Public lookup

`GET /api/episodes/{episodeId}?podcastId={podcastId}` returns `{ "podcast": PodcastInfo, "episode": Episode }` for public content only, whoever is signed in. Responses:

- 400: an ID is not canonical.
- 404: the episode is missing, belongs to another podcast, or is private.
- 503: the backend failed.

Native clients use this endpoint to resolve an incoming link without loading the whole catalogue.
