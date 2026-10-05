# Public feed aliases

A feed URL is a locator, not a permanent podcast identity. Accepted aliases map
old public URLs to a stable podcast ID without moving episodes or user data.
Private feeds remain exact-URL, owner-scoped records; public aliases never grant
access to another account's feed.

## Identity rules

- `podcasts.feed_url` is the canonical locator. Alias rows store other accepted
  locators with verification evidence.
- Preserve the complete URL: scheme, path case, query parameters and trailing
  slash. Stripping a token is not proof that two feeds are equivalent.
- Canonical, alias and provider claims must agree. Conflicting records are not
  automatically merged.
- Aliases target public sources only. Database guards reject cross-source
  collisions and ordinary reassignment.
- A canonical move keeps the old URL as an alias, preserves IDs and user state,
  clears HTTP validators and schedules a fresh poll.
- Feed aliases do not redirect deleted podcast or episode IDs.

Schema and guards live in migrations
[`0002`](../migrations/active/0002-public-feed-aliases.sql) and
[`0003`](../migrations/active/0003-alias-trigger-search-path.sql).
[Apple listing associations](apple-authoritative-associations.md) use a separate
provider-ID namespace.

## Verification

[Public move verification](../src/server/ingest/public-feed-moves.ts) accepts an
all-permanent 301/308 chain to a valid RSS feed with episode evidence. Temporary
redirects, contradictory publisher hints, query-bearing destinations, HTTPS
downgrades and ambiguous identities require review rather than automatic claims.

The verifier validates DNS destinations and pins connections across redirects,
with bounded bodies and deadlines. These protections apply to this verifier;
they are not a claim that every RSS-fetching path uses the same transport.

An authenticated import through an accepted public alias reuses its public
source. An unknown URL still follows the private-by-default import rule. Neither
application startup nor a migration infers historical aliases from titles or
matching episode GUIDs.

## Reviewing a mapping

[`scripts/feed-aliases.ts`](../scripts/feed-aliases.ts) requires an explicit
`ALIAS_DATABASE_URL`. Plans and snapshots belong outside Git, in operator-owned
mode `0700` directories with mode `0600` files. They may contain private locators.

To inspect a public source's move without mutation, using an illustrative ID:

```sh
bun scripts/feed-aliases.ts verify 100 /private/review/verified-plan.json
```

Only a verified claim plan is applicable; unchanged or pending status artifacts
are not plans. A manually reviewed plan names the source, expected current URL,
aliases, optional canonical move and source-equivalence evidence.

```sh
bun scripts/feed-aliases.ts review /private/review/plan.json /private/review/rehearsal.json
bun scripts/feed-aliases.ts apply /private/review/plan.json /private/review/apply.json
```

Review exercises the changes then rolls back. Apply commits the batch atomically.
Both lock the claims and write a protected snapshot before mutation. Reinspect
stale plans; never edit a snapshot to defeat a changed-state check. A failure near
commit needs a database-state check before retrying.

Snapshots cover affected metadata, not a complete backup. Recovery must preserve
newer claims and user activity. Alias rows alone cannot restore parent identity
or private ownership. Merging duplicate catalogues is a separate,
[reviewed operation](podcast-reconciliation.md).

## Tests

```sh
PG_BIN=/path/to/postgresql/bin bun test scripts/public-feed-aliases.test.ts
bun test src/server/ingest/public-feed-moves.test.ts
```
