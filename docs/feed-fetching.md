# Feed fetching

Ordinary RSS refreshes and imports use the bounded transport in
`src/server/ingest/feed-http.ts`. Private ownership does not permit fetching local
or internal-network destinations.

## Transport policy

- HTTP(S) only, without URL credentials. Query parameters, order and escaping are
  retained; private locators never go through public-alias normalization.
- Resolve every hop and reject empty, mixed public/private, local, reserved,
  multicast and non-global IPv6 answers. Connect to the selected IP without a
  second lookup, preserving Host and TLS verification against the original name.
- At most five redirects, without HTTPS-to-HTTP downgrade.
- One 30-second deadline covers DNS, redirects, headers and bodies. Wire and
  decoded bodies are each capped at 32 MiB; headers at 16 KiB. Truncation and
  invalid/unsupported compressed encodings are failures.
- Only application-selected HTTP headers are sent. No cookies or authorization
  are forwarded. ETag and Last-Modified are validated and dropped across origins.
- Conditional 304 responses preserve prior metadata. Unconditional rebuilds
  require a body. Identical bodies still avoid redundant writes.
- Transport and parser failures do not include locators or feed contents.

XML is bounded before object construction: 32 MiB, depth 64, 250,000 elements,
64 attributes per element, 256-character names and 512 KiB attribute values.
DTD/entity/SGML declarations are rejected; declaration-like text inside comments
or CDATA remains text. No external XML resources are loaded.

Chapter metadata retains its separate range/redirect/validator policy. Public
move verification retains its own locator/evidence policy. These callers share
only the applicable DNS, pinned-request, validator and RSS-body primitives.

## Refresh transactions

Migration `0011-feed-refresh-leases.sql` adds a token and expiry to the disposable
`feed_poll_state` row. Refresh uses three phases:

1. Briefly acquire the existing per-podcast advisory lock, lock/recheck the source,
   apply scheduling/backoff rules, and claim a 60-second lease.
2. Release the transaction and connection before DNS, HTTP and parsing.
3. Reacquire locks in the same order and recheck the token, expiry, owner and exact
   locator before publishing metadata/content and the next schedule atomically.

Active leases return `busy` and are excluded from scheduled polling. A dead worker's
lease expires; a late worker cannot publish, charge failure backoff or release a
replacement's token. If the commit lock is busy, the unused claim also expires.
Source URL/owner changes invalidate the lease and HTTP validators and make the new
source due, even if a URL changes away and back. Ordinary metadata/access updates
do not invalidate it. Deleted sources are never recreated by refresh completion.

Saved-content writers and eviction retain their existing advisory-lock ordering.
They can run during network I/O; the refresh write phase still serializes with
those mutations. Conditional responses, rebuilds and failure backoff keep their
existing behavior. Public move verification runs only after a successful commit.

Apply the migration only under a separately approved writer/activation plan. Old
refresh workers do not honor leases and must be retired at cutover. The new
trigger also requires source writers to retain their existing poll-state UPDATE
permission. Leases are reconstructible scheduler state, not durable user intent;
restores may omit them and resume cold polling.

## Verification and remaining work

Synthetic suites cover private/mixed/IPv6 destinations, pinning and rebinding,
redirects, token preservation, TLS hostname verification, compressed expansion,
chunked limits, stalled lookup/body, truncation, validators and parser limits.
Local integration tests inject a fixture resolver; production has no loopback
switch or environment bypass. Existing publisher fixtures still parse, but this
is not a broad publisher-compatibility survey.

Disposable PostgreSQL tests additionally prove connection/lock release during
fetch, single-worker admission, expired-worker recovery, stale success/failure
refusal, source/owner/deletion races, exact large IDs, Starred retention, populated
migration rollback and trigger search-path isolation.

Import fetching already precedes its write transaction, but global interactive
admission and import identity/ownership races still require review. Reads still
await content rebuilds. No pending/freshness DTO or background-job API is introduced
here; nonblocking reads and changed response contracts remain separate work.
