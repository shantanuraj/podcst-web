# Apple listing associations

Fresh, unambiguous Apple data determines which public feed an Apple listing
identifies. Correcting that association does not merge podcast catalogues or
transfer subscriptions and progress.

## Rules

- A trusted lookup must return the requested listing ID and one complete HTTP(S)
  feed URL. Missing, contradictory, invalid or stale evidence cannot change a
  claim. Client-supplied IDs and Podcast Index hints are not verification.
- Resolve the verified feed independently of the old Apple claim. If it identifies
  another public source, move only the association and preserve both sources,
  episodes, feed locators and user references.
- Preserve unrelated preferred and secondary listing claims. Additional listings
  become aliases; a removed preferred claim can be replaced by an already
  accepted alias on that same source.
- Accepted [feed aliases](public-feed-aliases.md) remain valid locators. Public
  association changes must not bypass private ownership or broaden exact-feed
  promotion rules.
- Lock and recheck the complete claim set, then update atomically. Concurrent
  changes or incomplete evidence fail rather than select a guessed winner.
- Known Apple-ID selections fetch fresh evidence. Stable internal podcast links
  remain independent of provider reassignment.
- Chart ingestion isolates unresolved entries and regional failures. An unusable
  replacement retains the previous chart; successful regions can still refresh.

Verification and mutation live in
[`apple-listing.ts`](../src/server/ingest/apple-listing.ts) and
[`apple-identity.ts`](../src/server/ingest/apple-identity.ts).
The [database guards](../migrations/active/0004-apple-listing-aliases.sql) protect
the shared preferred/secondary namespace. Search does not attach a stored source
when Apple's feed locator disagrees with it.

An association change can leave two separate catalogues. Matching titles, media
or GUIDs is not enough to merge them. Use the separately reviewed
[reconciliation tool](podcast-reconciliation.md) only when source and episode
correspondence have been established.

## Tests

```sh
PG_BIN=/path/to/postgresql/bin bun test scripts/apple-listing-aliases.test.ts src/server/ingest/apple-identity.integration.test.ts
```
