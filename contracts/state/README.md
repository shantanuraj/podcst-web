# Durable state protocol

This is the executable contract for the next progress/follow protocol. Validators,
HTTP change-handler factories and native wire models are implemented; the existing
API routes and client stores have **not** switched to this protocol. See
[the current API](../api/README.md) for deployed request shapes.

[`schema.json`](schema.json) is ordinary JSON Schema draft-07. Definitions are
validated with Ajv without coercion, defaults or removal of unknown properties.
[`fixtures.json`](fixtures.json) is synthetic and shared by web/server, Swift and
Kotlin tests. Request/response shape validation is not database, storage, device or
recovery acceptance evidence.

## Values and bounds

- Canonical podcast/episode IDs and stream sequences are decimal strings from `1`
  through `9223372036854775807`. Revisions additionally allow `"0"`. No numeric
  JSON IDs, signs, exponents, whitespace or leading zeroes are accepted.
- Account IDs remain opaque strings, not decimal catalogue IDs. Client IDs and
  recovery generations are canonical lower-case UUIDs. A client stream belongs to
  exactly one account **and** one resource; progress and follows are independent.
- `positionSeconds` is an integer in `0...2147483647`, measured on the original
  source timeline, never speed-adjusted or silence-trimmed elapsed time.
- `updatedAtMs` and `followedAtMs` are server epoch-millisecond integers. They are
  presentation data, not conflict clocks. Revisions determine accepted order.
- A batch contains 1–100 ordered desired-state actions, up to 64 KiB UTF-8, with a
  five-second body deadline. The array index identifies an action within a batch.
  Duplicate resource IDs are permitted: actions execute in array order.
- Progress reads accept at most 200 distinct canonical IDs. Each requested ID has
  one item; `progress: null` means no accessible saved progress, never an omitted
  field. It must not clear a newer local intent.
- A follow snapshot is complete compact membership truth, not a hydrated preview
  page. Only followed memberships appear. No pagination/truncation may imply an
  unfollow. `unavailable` hides all foreign private metadata but preserves the owned
  membership reference so the user can remove it.

## Acceptance and replay

A batch supplies `protocol: 1`, `accountId`, `generation`, `clientId`, `sequence`
and resource-specific `changes`. The authenticated session is authority;
`accountId` only asserts which account may receive that previously persisted work.
An account/generation mismatch is checked before accepting **or replaying** work.

Progress actions set `{episodeId, positionSeconds, completed}`. Follow actions set
`{podcastId, followed}`. There are no toggles, whole-cache replacements or implicit
writes from reads. Following requires current visibility. Unfollowing can remove
an account-owned reference without revealing inaccessible podcast metadata.

The server serializes a resource's accepted actions. Each successfully accepted
action receives the next resource revision, including a new action whose desired
value is unchanged. A progress action can rewind; neither device time nor maximum
position wins. Each affected row stores its accepted revision. `not_found` is a
terminal per-action outcome without a row update or revision increment. The
acknowledgement's revision is the resource head after the batch.

Stream state, effects, revisions and acknowledgement commit atomically. Each
stream starts at `"1"`, with one frozen batch in flight. Repeating the immediately
preceding sequence and canonical payload returns the saved acknowledgement,
without touching rows, timestamps, revisions, membership order or latest playback.
An older, changed or skipped sequence is blocked, not renumbered. Keep stream
high-water marks and the last acknowledgement for the account lifetime.

Canonical SHA-256 input is UTF-8 `JSON.stringify` of keys in this order:
`protocol, resource, accountId, generation, clientId, sequence, changes`.
`resource` is `progress` or `follows`. Progress action keys are
`episodeId, positionSeconds, completed`; follow keys are `podcastId, followed`.
Object input order does not matter; action order and exact decimal strings do.
This is **not** a change to the existing Starred hash contract.

A saved acknowledgement is not current state. Keep the local overlay until an
authoritative post-ack read from the same account/generation has a revision at
least as high as both the acknowledgement and the last installed snapshot. For
example: A saves position 90 and loses the acknowledgement; B saves position 12;
A's identical retry acknowledges its old revision, leaving B's 12 current. The
same rule prevents a lost-ack follow retry from undoing B's later unfollow.

## Completion and account lifecycle

Only an ended event or explicit Mark played completes an episode. A checkpoint
at 94%, 95% or 100% does not. Mark unplayed resets to zero/incomplete. Deliberate
replay clears completion at the chosen source position. A passive checkpoint
preserves completion. Transport failures, reads, queue hydration, shared-link
arrival and timer expiry do not create a completion event.

Guest follows are automatically unioned into the verified account's outbox in
one local transaction, consuming the transferred guest intent exactly once.
Guest progress stays local unless a position is explicitly selected for transfer.
Automatic guest-Starred transfer is unchanged. Never infer intent from a cached
signed-in collection. Queues and downloaded files remain device-local.

Logout checkpoints and retains minimal account-bound pending work, hides its
projection, and resumes it only for the same verified account. Confirmed account
deletion terminally erases that account's pending work. Unknown deletion outcomes
suspend it; a 401 is not deletion confirmation. Persistence errors must remain
visible and cannot be reported as a successful save.

## Errors and recovery fencing

All responses, including errors, are private/no-store and vary on Cookie. Mutation
request defenses are the same as other authenticated APIs. Error bodies contain
stable `code` and bounded human-readable `message` fields:

| Code | HTTP | Client action |
| --- | --- | --- |
| `invalid_request` | 400 | Preserve work; surface invalid input |
| `unauthenticated` | 401 | Pause until the original account authenticates |
| `request_forbidden` | 403 | Preserve work; fix request context |
| `account_mismatch` | 409 | Suspend the old account's work |
| `sequence_conflict` | 409 | Block the stream; never reset or renumber |
| `recovery_required` | 409 | Preserve work; explicit reconciliation required |
| `update_required` | 426 | Require an update without discarding local work |
| `request_too_large` | 413 | Preserve the frozen batch; fix before sending |
| `request_timeout` | 408 | Retry identical work |
| `rate_limited` | 429 | Retry identical work after `Retry-After` seconds |
| `unavailable` | 503 | Retry identical work with backoff |

`generation` is a recovery fence, not a retry counter. A restored server can be
behind a client even when its next expected sequence appears valid. Before
restored traffic is admitted, the recovery procedure must rotate the generation
and fence old writers. Clients must never automatically replace a persisted
batch's generation, renumber it, or upload cached collections after a mismatch.

Generation persistence/rotation, post-restore reconciliation, obsolete-writer
fencing and preserving existing frozen Starred requests must be proven before
activation. This contract does not implement or authorize a restore procedure.
