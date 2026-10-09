# Durable state protocol

This is the executable contract implemented by the server and web/iOS/Android
adapters. See [the API reference](../api/README.md) for route selection and payload
fixtures. Activation is a coordinated server, storage and client cutover, not
permission to apply a migration or deploy an incomplete candidate.

[`schema.json`](schema.json) is ordinary JSON Schema draft-07. Definitions are
validated with Ajv without coercion, defaults or removal of unknown properties.
[`fixtures.json`](fixtures.json) is synthetic and shared by web/server, Swift and
Kotlin tests. [`transitions.json`](transitions.json) supplies lost-ack/opposite-action
vectors executed against disposable PostgreSQL. Client tests exercise IndexedDB,
protected atomic files and Room migrations with source retention and failure
injection. These checks are not physical-device or operational recovery proof.

`migrations/active/0010-durable-state.sql` adds the generation, revision heads and
resource streams and backfills existing state deterministically. Invalid historical
positions refuse the migration instead of being silently clamped. Coordinate
writers and backups before activation; required row revisions reject obsolete
inserts, while public obsolete deployments still need their own retirement plan.

## Values and bounds

- Canonical podcast/episode IDs and stream sequences are decimal strings from `1`
  through `9223372036854775807`. Revisions additionally allow `"0"`. No numeric
  JSON IDs, signs, exponents, whitespace or leading zeroes are accepted.
- Account IDs remain opaque strings, not decimal catalogue IDs. Client IDs and
  recovery generations are canonical lower-case UUIDs. A client stream belongs to
  exactly one account **and** one resource; progress and follows are independent.
- `positionSeconds` is an integer in `0...2147483647`, measured on the original
  source timeline, never speed-adjusted or silence-trimmed elapsed time.
- Every progress action includes `completed`: true sets completion, false explicitly
  clears it, and null preserves the server's current completion under the resource
  lock (false for a new row). Snapshots always return a concrete boolean.
- `updatedAtMs` and `followedAtMs` are server epoch-millisecond integers, or explicit
  `null` for an unknown legacy timestamp. They are presentation data, not conflict
  clocks. Revisions determine accepted order.
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

The web client retains terminal follow outcomes for diagnostics without showing
historical failures as Library warnings. An unavailable result appears beside
Follow only for that control's current attempt in the active account session.
This keeps stale actions for removed or merged podcasts quiet while storage,
transport and protocol failures remain visible.

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
This hash is specific to progress/follows. The legacy numeric Starred hash remains
pinned behind its one-time bridge; new list batches include their scope and list ID.

A saved acknowledgement is not current state. Keep the local overlay until an
authoritative post-ack read from the same account/generation has a revision at
least as high as both the acknowledgement and the last installed snapshot. For
example: A saves position 90 and loses the acknowledgement; B saves position 12;
A's identical retry acknowledges its old revision, leaving B's 12 current. The
same rule prevents a lost-ack follow retry from undoing B's later unfollow.

## Import resolution

`POST /api/subscriptions/resolve` returns one ordered item per input with
`status: resolved | retry | unavailable` and explicit `retryAfterSeconds` nullability.
Its executable item schema is shared with the [feed contract](../feeds/README.md).
Only resolved IDs become follow intents; deadline, capacity and temporary failures
remain retryable without claiming that an import job was queued. Unsafe/hidden
sources remain generic unavailable. Session/generation errors are whole-request
refusals, not successful empty resolution.

Clients preserve unresolved input and per-feed retry deadlines across restart,
account departure and transport failures, and batch by UTF-8 bytes as well as count.
A new-import capacity check never truncates older over-limit pending work. Existing
frozen follow/progress/Starred payloads, sequences and generations are unchanged.

## Completion and account lifecycle

Only an ended event or explicit Mark played completes an episode. A checkpoint
at 94%, 95% or 100% does not. Mark unplayed resets to zero/incomplete. Deliberate
replay clears completion at the chosen source position. A passive checkpoint sends
`completed:null` and preserves server completion, even if another device changed it
after the local cache was read. It still supplies a new position action. Transport failures, reads, queue hydration, shared-link
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
| `not_found` | 404 | Preserve work; resource unavailable |
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

The schema also retains the initial `legacy_generation`. Numeric Starred flights
predate generation fencing. The migration service checks the authenticated account
and current generation, then refuses legacy replay if the current generation has
changed since migration. Fetching a new generation cannot make an old ambiguous
flight safe. The original numeric Starred hash and stored acknowledgement remain
unchanged; converting that frozen request to strings is not a retry.

The `/api/lists/:id/migration` bridge and client conversion journals preserve both
accepted and unaccepted legacy batches across an intervening opposite action. They
return a normalized scoped/string-ID acknowledgement without changing the stored
legacy result. Unsafe stored numeric IDs remain visibly unresolved, not guessed.
Ambiguous unsequenced progress stays local until explicit reapply creates new intent.

Guest-position selection is explicit and commits the new account intent with its
consumed-source marker. Queue and migration sources remain scoped and survive failed
activation. Terminal erasure uses durable fences; an unreadable source whose owner
cannot be established is retained and prevents a false successful-erasure report.
Ordinary logout never writes that terminal fence.

Generation rotation, post-restore reconciliation, obsolete-writer fencing and
client storage conversion must be proven before activation. This contract does
not implement or authorize a restore procedure.
