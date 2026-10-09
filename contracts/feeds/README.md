# Feed refresh and import contract

`schema.json`, `fixtures.json` and `limits.json` define the coordinated refresh/read
and import cutover. TypeScript, Swift and Kotlin consume the shared validation
vectors. Server/web/iOS/Android implement retryable scoped imports, bounded OPML,
nonblocking reads and refresh admission. The [API reference](../api/README.md)
describes the serving shapes and fixtures. Native/browser persisted catalogue
models may omit freshness for older local content; new wire responses may not.
No frozen progress, follow or Starred request changes as part of this contract.

OPML uses strict streaming parsers across all clients with shared `opml.json`
fixtures: reject unsafe declarations, malformed XML, excessive depth/outlines,
more than 1000 distinct feeds and documents over 5 MiB. File intake checks known
size before loading or uses a byte-bounded stream; UTF-8 decoding is strict.
Errors never consume prior imports. Guest imports are persisted before resolution,
with atomic successful membership/input updates and the same pending capacity
rule as accounts. Existing larger pending sets remain retryable.

## Freshness

Podcast, episode-page and hydrated subscription responses carry `freshness`:

```json
{"content":"cached","state":"pending","checkedAtMs":1791499200000,"retryAtMs":1791499205000}
```

- `content` is `cached` or `missing` for this representation, not a promise that all
  historical episodes remain available. Successfully fetched empty feeds are cached;
  evicted content is missing, not authoritative empty membership.
- `state` is `fresh`, `stale`, `pending`, `backoff` or `unavailable`. Fresh requires
  usable cached content and a successful check within 15 minutes. Pending requires
  durably admitted demand or active work, not merely a request in flight. Backoff is
  a failed attempt with a future retry boundary. Unavailable does not mean deleted.
- `checkedAtMs` is the last successful validation of this exact source, or null.
  Failures do not renew it. `retryAtMs` is required for pending/backoff and null
  otherwise. Both use exact nonnegative epoch milliseconds, not completion promises.
- Poll/lease/demand data determine state. Never expose lease tokens, raw errors or
  private locators in status responses. Cache access remains ownership-checked.

Reads return available content without awaiting a publisher. They may admit bounded
repair for missing content. Cached authorized reads survive admission outages; a
failed enqueue must not be labelled pending. Content still absent after a successful
full rebuild is unavailable rather than an endless repair loop.

`POST /api/feed/refresh` accepts only `{podcastId}` and returns
`{podcastId,freshness}`. 202 means accepted/joined work; 200 means no work needed or
existing backoff. There is no `onlyIfStale` or full-podcast response mode. Refusals
use 429 `rate_limited` with Retry-After or 503 `unavailable`. Refresh never forces a
fetch through backoff. Follow-up polling reads content instead of creating demand.

Known visible shared episode identities with absent content return 202
`content_pending` plus freshness only after accepted repair; otherwise 503
`content_unavailable`. Missing/mismatched/private resources remain generic 404.
Pending/error responses are no-store. Successful public episode responses retain
public cache headers; private/optional responses are private/no-store, varying on
Cookie. List hydration preserves nullable episode memberships and adds nullable
freshness: visible sources have a status; invisible sources have null.

## Bounded import resolution

The scoped resolution envelope and input order stay unchanged. Each input gets one
`resolutionItem`, including duplicates and work not started by the deadline:

| Status | podcastId | retryAfterSeconds | Meaning |
| --- | --- | --- | --- |
| `resolved` | Exact decimal string | null | Enqueue an ordinary follow intent |
| `retry` | null | 1–86400 | Temporary failure/deadline/admission; no queued server import |
| `unavailable` | null | null | Invalid, unsafe, hidden or conflicting source |

Retain unresolved input locally for retry; never guess IDs or treat a timeout as
proof that nothing committed. Imports remain synchronous and bounded, not another
job service. Scoped batches, RSS search, single imports and interactive Apple
resolution (including SSR) share admission. Cached authorized identities do not
need a network permit. Private commits recheck account/session,
recovery generation and source identity after network work. Resolution never writes
membership directly.

`limits.json` is the executable source for new-work ceilings. Batch by both item
count and UTF-8 bytes. Reject excessive/unsafe OPML before consuming existing local
work; do not truncate silently. Preserve older over-limit pending sets and allow
bounded retries. Shared expiring concurrency claims are token-owned; stale workers
cannot publish or release replacement claims. Limiter outages fail new work closed,
not cached reads or local durable state.

## Client behavior

Keep current-scope content visible while refreshing. Missing/pending is preparing,
not an empty feed, rejected Follow or successful deletion. Honor retry advice;
foreground automatic rechecks stop after the bounded window, on navigation or
scope/intent changes. Offer Retry without discarding data. Delayed link results
cannot autoplay after a newer intent or change progress/completion implicitly.

This contract does not change server chapter caching, media persistence, deletion
policy or durable-state recovery generations. HTTP/client activation must be
coordinated; foundation fixtures alone are not an activated endpoint contract.
