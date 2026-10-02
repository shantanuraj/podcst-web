# Public feed aliases

Status: implemented and locally verified; not deployed or backfilled in production. The owner approved public aliases first, with verified permanent moves and reviewed mappings. Private aliases and credential rotation remain outside this slice.

The [identity plan](feed-identity-resolution-plan.md) owns source-resolution policy. The [ownership plan](private-feed-ownership-plan.md) remains authoritative for private access and exact-URL promotion. This reference documents the implemented boundary and operator workflow, not a production inventory.

## Stored identity and invariants

[Migration `0002-public-feed-aliases.sql`](../migrations/active/0002-public-feed-aliases.sql) adds `podcast_feed_aliases` after the ownership migration. It creates an empty alias table and database guards; it does not rewrite the catalog or infer historical aliases.

- `podcasts.feed_url` remains the sole canonical locator. An alias maps a complete URL to a stable podcast ID, with evidence type/reference, verification details and acceptance time.
- Canonical URLs do not need duplicate alias rows. Lookup checks indexed canonical, alias and provider keys and rejects disagreement rather than selecting the first match.
- Keys preserve scheme, path case, query parameters and trailing slashes. The application trims surrounding whitespace, but never assumes HTTP and HTTPS are equivalent or strips a token to find a public show.
- Alias targets must be public. Private source access and trusted exact-URL Apple promotion remain unchanged. Another account's private locator cannot be claimed, duplicated or promoted through an alias.
- Database guards reject alias reassignment, aliases colliding with another source's canonical URL, and new source rows claiming an accepted alias. Making an aliased source private requires explicitly removing its public aliases within a reviewed ownership operation first.
- A canonical move retains the old locator as an alias, preserves podcast/episode IDs and user state, and clears conditional-fetch validators before scheduling a fresh poll. Canonical changes also take the source's existing refresh lock; an active refresh defers the move so its old response cannot overwrite the new locator's validators.

The schema does not implement podcast-ID or episode-ID redirects. Reconciliation and alias registration are different operations; an alias claim never merges existing sources or episodes.

## Accepted evidence

### Reviewed mappings

An operator supplies a protected plan naming the existing public source, its expected current canonical URL, historical aliases, optional new canonical URL and a review reference. Every locator is checked under identity locks. A stale expected URL or conflicting source aborts the transaction.

This is how already-reconciled historical URLs are seeded. Neither the migration nor application startup imports mappings from old receipts or guesses them from titles, GUIDs, subscriptions or directory-ID absence.

### Verified permanent moves

[The verifier](../src/server/ingest/public-feed-moves.ts) accepts an all-permanent 301/308 chain ending in a valid podcast RSS feed with episode evidence. It records the redirect chain, body digest, policy version and verification time. It refuses automatic acceptance when:

- Any hop is temporary, a redirect loops or exceeds the five-hop limit.
- HTTPS is downgraded, the target is not a permitted public destination, or credentials appear in URL authority.
- The final URL has delivery/query parameters requiring review.
- Parsed self-links or publisher move hints disagree with the final URL.
- The final response is unavailable, malformed or lacks usable episodes.

A publisher move hint without a verified redirect produces `verification_pending`, not an alias. A temporary CDN endpoint is transport, not canonical identity. Query-bearing sources are not silently normalized; an appropriate reviewed mapping remains possible.

The [verification transport](../src/server/ingest/public-feed-http.ts) resolves and validates every destination, pins the selected address while preserving HTTP Host and TLS server-name verification, and never forwards cookies or authorization headers. It bounds raw and decompressed bodies to 32 MiB, supports bounded gzip/Brotli/deflate decoding, and uses a shared 30-second network deadline across DNS and redirect requests. Private, loopback, link-local, reserved and mapped-local destinations are rejected conservatively.

This transport governs durable identity changes. It does **not** retrofit all ordinary RSS fetching: the existing ingest/refresh transport, its broader safe-fetch/egress requirements and refresh transaction structure remain separate hardening work. Do not mark those release gates complete because alias verification is bounded.

## Integrated callers

| Caller | Behavior |
| --- | --- |
| Public provider ingestion | A newly fetched public redirect candidate is verified before claiming aliases. Imports through verified aliases and the destination converge under shared identity locks. An established canonical choice is not downgraded by a stale provider locator. |
| Authenticated URL import / OPML | Accepted public aliases reuse public sources. Unknown URLs still follow the approved private-by-default exact-URL policy; private redirects do not create public aliases. |
| Feed reads, search, legacy pages and short links | Resolve accepted aliases, reapply source access checks, and return canonical IDs/locators rather than the submitted historical URL. |
| Public refresh | A redirect observed during ordinary refresh triggers separate bounded verification after the existing refresh transaction. Private refresh does not trigger alias discovery. A conflict produces a redacted review diagnostic; it does not merge sources. |
| Apple charts | Use the shared alias/provider lookup and conflict handling while retaining country-level transaction semantics. |
| Full/incremental Podcast Index sync | Use the shared identity claims and preserve canonical URLs. New directory locators are not accepted aliases merely because the dump advertises them. Private candidates retain the trusted exact-URL verification requirement. |
| Null-Apple-ID patch importer | Uses bounded alias-aware insert batches. Existing public aliases, canonical sources and private exact locators are skipped rather than duplicated or published. |

No application alias cache is introduced. Private responses remain outside shared caches. Chart-cache results are checked against current source IDs/locators; old URL-keyed feed caches remain bypassed by the ownership slice. Canonical metadata is read after content preparation where a refresh can change the locator.

An existing origin and destination that are different database records produce `identity_conflict`. Follow the [reconciliation policy](feed-identity-resolution-plan.md#existing-identity-conflicts), not an automatic merge. The older reconciliation utility intentionally refuses unknown dependency/ownership schemas; it must be reviewed for the new alias references before reuse.

## Operator workflow

[The CLI](../scripts/feed-aliases.ts) requires `ALIAS_DATABASE_URL`, independently of application database settings. Supply connection credentials securely through the environment. Plans/receipts must be operator-owned regular files with mode `0600` inside a mode `0700` directory. Outputs use exclusive creation; existing artifacts are never overwritten.

To inspect a public source's move without changing the database:

```bash
bun scripts/feed-aliases.ts verify 100 /protected/verified-plan.json
```

A verified move writes a claim plan. Pending/unchanged results write a status artifact that cannot be applied as a claim plan. The command does not follow private sources.

For a reviewed historical mapping, create a protected plan such as:

```json
{
  "claims": [
    {
      "podcastId": 100,
      "expectedFeedUrl": "https://feeds.example.invalid/current",
      "aliases": ["http://feeds.example.invalid/historical"],
      "evidence": {
        "type": "reviewed",
        "reference": "review-case-example"
      }
    }
  ]
}
```

Set `canonicalFeedUrl` only for an explicitly approved canonical change. The expected locator is mandatory; stale plans fail closed. Plans are limited to 100 claims and 32 supplied aliases per claim.

Rehearse before applying:

```bash
bun scripts/feed-aliases.ts review /protected/plan.json /protected/review.json
bun scripts/feed-aliases.ts apply /protected/plan.json /protected/apply.json
```

Both modes lock the claim set and source rows, then write/read back a protected snapshot of source, alias and polling records before mutation. Review exercises the changes and rolls back. Apply commits atomically; a conflict in any claim rolls back the whole batch. Each invocation also writes a `.result.json` terminal receipt. A connection/artifact failure near commit can leave the outcome uncertain: inspect the database and protected evidence rather than retrying blindly.

These snapshots cover the metadata changed by this tool, not a complete database backup. Recovery requires coordinating writers, comparing later alias/canonical/poll changes and restoring only a reviewed state. Never overwrite newer claims or automatically transfer an alias to a different source.

## Rollout

1. Complete the applicable R1 migration adoption/recovery work and ownership cutover decisions. Local tests are not production authorization.
2. Apply the append-only active migration chain with the explicit migration target, then deploy compatible web/API, poller and catalog-writer code together. Retire obsolete readers/writers; the new guards do not replace the ownership boundary.
3. Review and seed historical public aliases from protected reconciliation evidence. There is no automatic full-catalog backfill or new network fetch per bulk-imported source.
4. Exercise anonymous public alias reads, authenticated imports, private denial, short links, chart/cold-content behavior and both full/incremental catalog jobs on the deployed candidate.
5. Monitor typed conflicts, pending verification and redacted move diagnostics. No durable reconciliation queue or automatic resolution of disputed identities is claimed.

Unregistered historical URLs can still create separate records under the existing import policy. Accepted aliases prevent that recurrence; registration and coordinated production deployment are required for the previously repaired sources. Permanent move detection is conservative, not universal URL equivalence.

## Verification and remaining scope

Local verification uses synthetic feeds, disposable PostgreSQL/Redis and protected temporary artifacts. It covers alias lookup, canonical responses, privacy, database bypass guards, concurrent claims/imports, stale/conflicting identities, validator reset, provider/catalog writers, operator rollback/apply and artifact safety, redirects/hints, DNS destination policy, pinned HTTP routing, decompression and deadline limits. The actual API-handler subprocess also checks alias reads, URL search, OPML and short-link canonical routing.

The complete Bun run passed **329 tests**, with **28 unrelated platform/SSR skips**; TypeScript and the production web build passed against disposable services. Existing warnings remain in touched legacy parser/importer code. No production migration, alias seed, private-source classification or device validation was performed.

Private alias fingerprints/rotation, automatic acceptance of publisher hints or temporary/delivery URLs, disputed alias reassignment, durable review scheduling and comprehensive RSS fetch hardening remain separate work. This slice does not change the approved private exact-URL model or sign off the broader release phase.
