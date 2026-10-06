# Episode lists and starred-episode sync

Status: Starred synchronization is implemented on web, iOS and Android for a
coordinated pre-release breaking change. The schema, HTTP API, content retention,
durable client outboxes and automatic guest transfer are implemented. Named
playlist management remains out of scope. The
[API contract](../contracts/api/README.md) describes the wire format.

## Decisions

- Starred is a built-in, private list owned by an account. Future playlists are
  private, named and manually ordered, with unique episodes in each list.
- Require canonical episode IDs for starrable episodes in all three clients.
  Feed URLs and GUIDs are catalogue metadata, not fallback membership identities.
- Reset obsolete development star storage rather than support its formats. There
  is no legacy migration, episode-resolution endpoint or special import action.
  This does not call for resetting unrelated downloads, playback or account data.
- Guest stars merge automatically as ordinary add actions, consumed from the
  guest collection once. A guest star can restore a previously unstarred account
  episode: it is a new action, not recovery of an old backup.
- Signed-in edits work offline through a durable outbox. Explicit actions use
  last server-accepted action wins, independent of device clocks. An old offline
  action can win when it finally arrives; a retry cannot count as a new action.
- Removal deletes a membership row. Complete authoritative snapshots and retry
  deduplication make membership tombstones unnecessary.
- Ship star sync first. Playlist ordering and lifecycle commands come later on
  the same foundation. Queues, downloads and generated New Releases remain
  separate features with different lifecycles.

Breaking changes remove compatibility work, not offline-sync correctness.
Never reconstruct an outbox by uploading a cached account collection: a stale
cache is not a set of new user actions.

## Client implementation

All star buttons and memberships use canonical numeric episode IDs. Missing IDs
are rejected rather than resolved through feed URLs/GUIDs. Unrelated media-cache
and playback identities are unchanged. Normal feed discovery/indexing happens
before an episode can be starred, including by a guest.

- [Web state machine](../src/shared/stars/state.ts) and
  [sender](../src/shared/stars/sync.ts): one atomic IndexedDB root in
  `podcst-lists`, shared across tabs. Web Locks serialize senders;
  BroadcastChannel publishes projection changes. Browsers without Web Locks keep
  local work but cannot send. AccountSession tokens fence requests and UI actions.
- [iOS](../ios/Podcst/Core/StarStore.swift): one atomically replaced
  `Podcst/EpisodeLists/lists.json`, protected until first device authentication
  and excluded from backups. Main-actor serialization covers edits, guest
  transfer and account changes.
- [Android state](../android/core/data/src/main/kotlin/app/podcst/data/StarState.kt)
  and [repository](../android/core/data/src/main/kotlin/app/podcst/data/StarRepository.kt):
  one mutex-serialized AtomicFile, `episode-lists.json`, in app-private
  `noBackupFilesDir`. It survives deletion of per-account Room catalogue caches.
  Flow publications carry generation guards, including storage callbacks from IO.

Each root contains account-scoped membership snapshots, metadata, queued intent,
one frozen batch, its durable acknowledgement, stream identity/sequence and
terminal failures. Guest transfer updates the source and destination in the same
commit. Successful device persistence precedes saved-state publication and toast
feedback. Snapshots, not hydrated display pages, define membership; missing or
inaccessible episodes stay visible as removable placeholders.

Authentication changes pause native senders before credential changes and hide
account data until the new scope is ready. Sign-out removes old account metadata
but retains minimal account-bound work and stream state. Cached account membership
is never uploaded as new intent. Reconnect and foreground refresh resume retries;
foreground polling runs every 60 seconds, with more frequent bounded retries for
pending work. Protocol errors stop the affected stream without renumbering it.

There is no legacy import: web deletes the obsolete `stars` key, iOS removes the
old `Podcst/Stars` directory, and Android no longer reads the old Room star table.
Only the new stores participate in guest merging. Downloads, progress and other
catalogue storage are not reset.

## Storage

Use three tables, with no separate stars backend or stored star boolean.

### `episode_lists`

| Column | Purpose |
| --- | --- |
| `id UUID PRIMARY KEY` | Opaque, stable list identity. |
| `user_id TEXT NOT NULL` | Owner; references `users`, cascading on account deletion. |
| `kind TEXT NOT NULL` | `starred` or `playlist`. |
| `name TEXT` | Null for Starred; trimmed, nonempty, at most 100 characters for playlists. |
| `revision BIGINT NOT NULL DEFAULT 0` | Monotonic membership/list-metadata revision. |
| `created_at`, `updated_at TIMESTAMPTZ NOT NULL` | Server timestamps. |

A partial unique index on `user_id WHERE kind = 'starred'` enforces one built-in
list per account. Authenticated bootstrap ensures it exists with a
concurrency-safe insert. Clients discover it by kind, not localized title.
Starred cannot be renamed or deleted. Playlist names need not be unique.

Ordering is derived from kind: Starred is newest-addition-first; playlists will
use manual order. Counts are computed from membership, not stored separately.
The revision helps reject out-of-order snapshots and will support playlist edit
preconditions; it is not a multipage membership-sync protocol.

### `episode_list_items`

| Column | Purpose |
| --- | --- |
| `list_id UUID NOT NULL` | References `episode_lists`, cascading on list deletion. |
| `episode_id BIGINT NOT NULL` | References the canonical episode identity. |
| `added_at TIMESTAMPTZ NOT NULL` | Server time when this membership was added. |

Primary key: `(list_id, episode_id)`. Every row is a present membership. Remove
with `DELETE`; re-add with a new timestamp. Repeated adds keep the existing time.
No removed flag, tombstone, episode JSON, feed URL or duplicated owner/podcast ID.

Indexes: `(list_id, added_at DESC, episode_id DESC)` for display pagination and
`(episode_id)` for content-retention checks.

Use a deferred `NO ACTION` episode foreign key rather than cascading saved items
away on catalogue deletion. Reconciliation must remap memberships deliberately.
Deferred checking allows account deletion to cascade through its private podcasts
and lists together; test that transaction explicitly.

### `episode_list_clients`

| Column | Purpose |
| --- | --- |
| `user_id TEXT NOT NULL` | Account scope; cascading on account deletion. |
| `client_id UUID NOT NULL` | Durably generated synchronization-stream identity. |
| `last_sequence BIGINT NOT NULL DEFAULT 0` | Last accepted batch in this stream. |
| `last_request_hash TEXT` | Hash of the last accepted list ID and canonicalized request. |
| `last_result JSONB` | Bounded acknowledgement, without episode metadata. |

Primary key: `(user_id, client_id)`. One stream per installation/browser profile
and account, with one unacknowledged batch at a time across all its lists. Each
new batch increments the sequence. This keeps one deduplication record per stream
rather than an indefinitely growing action log.

Keep these records for the account's lifetime: expiring them could make an old
retry a new action. Rate-limit stream creation. A new installation gets a new
client ID; it never resets an existing stream's sequence.

## API

Require the existing session cookie on all list routes. Ownership comes from
`getSession()`, never a body user ID. All responses, including errors, carry
`Cache-Control: private, no-store` and `Vary: Cookie`. Foreign lists return the
same 404 as missing lists. Check `podcastAccess` on additions and reads; owning a
list does not grant access to another account's private episode.

Episode IDs are positive safe JSON integers as today. Addition times are epoch
milliseconds; list/client IDs are UUID strings. Revisions and sequences are
validated decimal strings on the wire, with arithmetic/comparisons in PostgreSQL
or bigint-aware code rather than the existing numeric bigint decoder.

| Method and path | Purpose |
| --- | --- |
| `GET /api/lists` | Bootstrap Starred and return account list summaries. |
| `GET /api/lists/:id/items?view=membership` | Complete compact membership snapshot. |
| `GET /api/lists/:id/items?view=episodes` | Paginated episode display data; the default view. |
| `POST /api/lists/:id/changes` | Apply a deduplicated batch of add/remove actions. |

No `/api/stars`, episode-resolution route or import operation.

### List summaries

`GET /api/lists` returns:

```json
{
  "lists": [
    {
      "id": "0c339753-cb50-477c-843e-e641b414a060",
      "kind": "starred",
      "name": null,
      "revision": "7",
      "itemCount": 2
    }
  ]
}
```

V1 returns the built-in list. `itemCount` includes unavailable memberships; no
localized "Starred" string is stored on the server.

### Complete membership snapshots

The membership view returns every episode ID and addition time in one response:

```json
{
  "listId": "0c339753-cb50-477c-843e-e641b414a060",
  "revision": "7",
  "items": [
    {
      "episodeId": 123,
      "addedAt": 1770000000000,
      "availability": "content_missing"
    },
    {
      "episodeId": 789,
      "addedAt": 1769000000000,
      "availability": "available"
    }
  ]
}
```

Read the revision and memberships in one consistent database snapshot. Sort by
`(added_at DESC, episode_id DESC)`. There is no cursor, continuation or silent
truncation; reject pagination parameters on this view. Atomically replace the
local authoritative index only after the entire response succeeds, then apply
pending local actions over it. Failed reads preserve the previous index.

Availability is `available`, `content_missing` or `unavailable`. Preserve an owned
membership even when its episode cannot be hydrated. Expose no private metadata
for inaccessible episodes; only the already-owned reference remains. An
`unavailable` result immediately invalidates any cached private snapshot.

Discard older membership revisions and superseded read responses. Revisions do
not track catalogue content or access changes, so recheck availability even for
unchanged revisions and do not use revision alone as a body cache validator.

Start with full compact snapshots and measure payload size/latency. If library
sizes later justify incremental sync, design an explicit change-feed/reset
protocol then; do not add a change log or deletion history speculatively now.

### Hydrated display pages

The episode view returns the same entry fields plus `episode`, using the existing
Episode shape or null. It includes `listId`, the page's `revision`, `items` and
`nextCursor` (null on the last page). Default limit is 100; validate 1–200.

Use keyset pagination by `(added_at DESC, episode_id DESC)`. The opaque cursor
binds list ID and ordering tuple, not a list revision. Concurrent changes may
move entries between pages: deduplicate by episode ID and refresh from the start
when needed. This is display pagination, not authoritative membership sync;
never infer an unstar from an absent display row. Render membership/order from
the compact snapshot plus pending actions, and filter stale display rows through
that projection. A membership not yet hydrated remains visible as a placeholder.

Use left joins and authorize before projecting episode metadata. Content-missing
entries may use a same-account cached snapshot; inaccessible entries may not.
Metadata retention cannot guarantee that a publisher's audio URL stays playable.

### Batched changes

Accept 1–100 actions and at most 64 KiB per request:

```json
{
  "clientId": "a7a2e014-b64f-4487-9c92-71cd59fc0cf7",
  "sequence": "12",
  "changes": [
    { "op": "add", "episodeId": 123 },
    { "op": "remove", "episodeId": 456 }
  ]
}
```

- `add`: validate episode visibility and insert if absent; otherwise a no-op.
  Newly added items receive server time. Guest timestamps are not uploaded.
- `remove`: delete the row from the caller's list if present; otherwise a no-op.
  Removing a known membership works after access revocation. Do not inspect or
  reveal whether an arbitrary nonmember episode exists elsewhere.

Process actions in array order. Never toggle or replace the entire list. Return
one ordered result per action:

```json
{
  "clientId": "a7a2e014-b64f-4487-9c92-71cd59fc0cf7",
  "sequence": "12",
  "listId": "0c339753-cb50-477c-843e-e641b414a060",
  "revision": "8",
  "results": [
    { "episodeId": 123, "status": "applied" },
    { "episodeId": 456, "status": "unchanged" }
  ]
}
```

An add can instead return `not_found` for either a missing or inaccessible
reference. That is a terminal action failure: surface it, retire the action and
refresh, rather than guessing a replacement identity or retrying as a new add.
Successful effects and all action results commit together with the stream
acknowledgement. A database failure rolls the whole transaction back.

Errors retain `{ "message": string }`: 400 for invalid input, 413 for oversized
requests, 401 for no session, 404 for a missing/foreign list and 409 for a broken
stream sequence/hash contract. Clients do not branch on English messages.
Transient failures and 429s retry the identical batch with backoff. A current
batch's protocol 409 stops that stream and preserves its outbox for diagnosis;
never silently renumber/reidentify it. Ignore late responses for retired batches.

### Retry and transaction rules

After authorizing the list, lock the account's stream row in a transaction:

1. A new stream must start at sequence 1.
2. The same sequence and request hash returns the saved acknowledgement without
   applying anything. A different payload at that sequence returns 409.
3. Anything below the high-water mark or above `last_sequence + 1` returns 409.
4. For the next sequence, lock affected podcasts in ascending ID order, then the
   list. Recheck ownership/access, apply actions, and increment the list revision
   once if any membership state changed. No-op actions do not advance it.
5. Save the sequence, hash and result in the same transaction.

List-row locking serializes different devices' actions. Podcast locking protects
content retention, as below. Persist the exact in-flight request and sequence
before sending. Coalesce only unsent actions, never mutate an in-flight batch.

Example: A's add commits but its response is lost. B removes the episode. A's
retry gets the original acknowledgement, not a second add; its subsequent full
snapshot sees B's removal. This is why deleting memberships is safe without
membership tombstones. An independent offline add arriving later is a new action
and can restore the episode by the chosen conflict rule.

## Client synchronization

Keep an account-scoped authoritative membership cache, durable action outbox and
cached episode metadata. The visible list is the cache with ordered pending
intent applied, not a second independently authoritative star collection.

1. Hydrate local state immediately. Persist each tap in the outbox before
   reporting it as saved on the device; the optimistic view derives from it.
2. Bootstrap the account-owned list UUID and fetch its full compact snapshot.
   Pending actions always overlay the fetched membership.
3. Send one frozen batch at a time. Persist its acknowledgement, then fetch a
   snapshot started after that acknowledgement, at least as recent as its returned
   revision. Atomically install it and retire that batch, retaining newer actions.
   Until then, pause sending and keep an acknowledged-awaiting-refresh state
   across read failures/restarts. Never lose the overlay or resend it as new
   work. Failed actions must not remain optimistically successful.
4. Refresh on launch, sign-in, reconnect, foreground/focus, manual refresh and
   after writes. Poll compact membership every 60 seconds while the library is
   visible. No push/WebSocket transport in v1.

Use session-generation and request-order guards for all reads/acknowledgements.
Web tabs share the IndexedDB outbox and stream, with transactional sequence
allocation, a cross-tab sender lock and projection-change notifications. A
network failure is not an empty list or an acknowledgement. Show pending/failure
state separately from server-confirmed preservation.

### Guest merge

After confirming the signed-in account, perform one local transaction that:

1. Enqueues ordinary add actions for the current guest memberships into that
   account's outbox, behind any existing account actions.
2. Removes those exact entries from the guest collection.

Use a local list store capable of atomically updating guest membership and
account outboxes together, not independent per-account file/database writes.
A crash therefore leaves either the guest collection or the account-bound work,
never neither or both. A concurrent guest edit must serialize with this transfer.
This is normal product behaviour, not a migration manifest/checkpoint system.

If bootstrap has not returned the list UUID yet, keep the transferred actions
bound to the confirmed account and logical Starred target locally. Bind to that
account's UUID before sending; the wire API never accepts a magic current-account
Starred target. New signed-in taps follow the transferred actions, so an unstar
while merging is not undone by a later queued guest add.

Existing memberships keep their server addition times. Reintroduced memberships
get new server times, not their old guest times. Once transferred, entries cannot
merge into a different account on the next sign-in. New guest stars created
later form a new collection. Re-login retries the same durable work; it never
re-enqueues the account cache. Terminally failed guest adds are surfaced as sync
failures, not put back into an unclaimed guest bucket.

### Account changes

Stop the sender and invalidate its session generation before switching scopes.
Writes always target a discovered account-owned list UUID, which prevents an
old-account request from silently writing to a new account's session.

Clear visible account data and ordinary private caches on sign-out. Keep minimal
account-bound pending work and stream state in protected native storage or
account-scoped IndexedDB; never expose it in a guest or different account's UI.
Resume only after the same account authenticates. Session expiry pauses work;
it does not turn account actions into guest stars.

Adjust native account-switch deletion accordingly. The pending-work store must
survive deletion of ordinary per-account catalogue caches. An explicit device
reset can discard unsynced edits with a warning; no server can preserve edits it
never received after local data is deleted.

## Retention and catalogue maintenance

Membership pins the corresponding `episode_content` row, not its whole podcast.
Do not implicitly subscribe, mark the entire podcast essential or increase its
polling tier because one episode was saved.

Saved references are excluded from warm-row counts, eviction candidates and
deletion. Both list changes and eviction acquire the existing per-podcast advisory
transaction lock before checking retention. List writers take the stream lock,
sorted podcast locks, then the list lock; eviction takes the podcast lock and
rechecks membership. Feed refresh already uses the podcast lock. Retry if the
required lock set changes through catalogue maintenance.

An episode whose content was already evicted can still be added by ID. Reads
return a content-missing placeholder and schedule recovery after the response;
accepted adds also schedule a check. Recovery considers up to 20 missing-content
podcasts in least-recently-polled order and rebuilds at most three concurrently.
A Redis claim throttles each podcast to one attempt per 15 minutes, and existing
feed failure backoff still applies. Missing individual episodes trigger rebuilds
even when the rest of a fresh feed remains cached. No upstream feed request is
awaited by the membership response. Recovery is best-effort; later reads retry.
Membership survives feed removal, but missing metadata/audio may be unrecoverable.

[Podcast reconciliation](podcast-reconciliation.md) recognizes the membership
foreign key but refuses any saved references in either affected source, including
ones added after inspection. It locks the membership table during the check;
unrelated saved episodes do not block a merge. Remapping needs a separate reviewed
implementation; never cascade away items or choose arbitrary same-list winners.
Deleted episode IDs currently have no redirects: an old offline add fails
explicitly, without
a feed/GUID resolver. Transparent continuity across destructive ID merges would
require a separate catalogue identity decision, not list compatibility machinery.

Account deletion removes lists, memberships and stream records. Test cascades
through private podcasts too. Explicit catalogue purges must deliberately handle
saved references; normal eviction only deletes unpinned content.

## Named playlists later

Keep the same list IDs, unique memberships and account mutation stream. Add:

- Creation with a client-generated UUID, renaming and list deletion.
- `position BIGINT` for playlist memberships, with a deferred unique constraint
  on `(list_id, position)`. Starred leaves it null. Start with dense integer
  positions and transactional renumbering, not fractional ranks or a CRDT.
- Append-on-add and relative moves by episode ID; an existing add does not move
  an item, and a move does not insert a missing membership.
- Expected-revision checks on moves, with an acknowledged terminal conflict on
  stale order. Refetch before creating a new rebased intent.

Define list-deletion/recreation semantics with that feature. List tombstones may
be useful there, but are not needed for membership deletion or Starred today.
Playing a list projects its order into a queue; it does not bind a running queue
to subsequent list edits. Sharing, collaboration and repeated entries stay out.

## Delivery and validation

1. Add schema, authenticated API, deduplication and retention integration, with
   database/route tests. Document the live contract only once implemented.
2. Add shared API fixtures and sync transition vectors; update all three client
   decoders and test suites together.
3. Replace development star storage and implement canonical-ID cache/outbox
   adapters plus atomic guest transfer. No compatibility migration. Reuse account
   boundaries and existing star-button presentation.
4. Deploy server and coordinated pre-release client updates. Verify fresh/offline
   installs and guest/account transitions rather than supporting old star formats.
5. Ship playlist ordering/lifecycle separately on these tables.

Required tests:

- Concurrent built-in bootstrap, account isolation, private visibility, missing
  IDs rejected, feed URL changes leaving ID-based membership intact.
- Duplicate add/remove, absent remove leaving no row, re-add timestamp and two
  episodes with the same GUID but different IDs.
- Lost response followed by another device's opposite action, exact replay,
  changed replay payload, skipped/old sequences and transaction rollback.
- Offline restart, rapid toggles, browser tabs, clock skew and last-accepted wins.
- Atomic guest transfer interrupted by crashes/account switches; guest re-star
  after an account unstar; same-account re-login without repeated merge; unstar
  while guest adds are in flight.
- Expired sessions, late callbacks and pending work never reaching another account.
- Complete snapshots, out-of-order reads, failed/truncated responses preserving
  the cache, physical deletion reaching another device, and display pagination
  never being treated as membership truth.
- Eviction racing an add, individual content loss, revoked private access and
  placeholders rather than disappearing memberships.
- Account deletion, foreign-key safety and reconciliation refusing unhandled
  list dependencies.

The three clients run the same
[offline transition vectors](../contracts/fixtures/sync/star-outbox.json), plus
platform tests for durable acknowledgements, exact lost-response replay, frozen
batches with newer edits, account isolation, stale reads, storage failures,
revocation and placeholders. Server mutation and stream-creation limits are in
place. Production telemetry for snapshot sizes/latency, pending-work age and
failures remains a follow-up; do not log private payloads, URLs or tokens.

### Release checks

- Deploy the list schema and all server routes before releasing clients. Drain
  old server instances before native clients begin posting list changes.
- Verify with a synthetic account on all three clients: guest star/sign-in,
  another device's add/remove, offline taps followed by process restart, then
  reconnect. Confirm the pending indicator clears only after a fresh snapshot.
- Sign out while a request is in flight, sign into another account, then return.
  Verify pending work resumes only for its original account and guest entries
  were consumed once.
- Test unavailable content and failed additions, and confirm unstar remains
  possible without episode metadata. Check storage-denied/quota-full feedback.
- Validate real-device foreground/network transitions. Automated simulator and
  unit tests do not replace this final cross-device smoke test.
