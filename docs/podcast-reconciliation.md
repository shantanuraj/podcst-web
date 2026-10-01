# Guarded podcast reconciliation

This is an implemented, operator-driven repair tool for reviewed **public-source duplicates**, not an automatic identity resolver or a database migration. The [identity plan](feed-identity-resolution-plan.md#existing-identity-conflicts) owns reconciliation policy; the [ownership plan](private-feed-ownership-plan.md#existing-data-classification) owns classification and protected evidence.

Production plans, inventories, source/account mappings, snapshots, backups and execution receipts belong in protected operational storage, never Git. This document uses synthetic examples only. A successful repair does not complete the release hub's ownership or alias-resolution phase.

## Tool and preservation rules

[scripts/reconcile-podcasts.ts](../scripts/reconcile-podcasts.ts) reconciles one approved pair per transaction. It defaults to inspection and requires an explicitly selected `RECONCILE_DATABASE_URL`; it does not silently use the app's database configuration.

The canonical record must have a verified provider identity. The duplicate cannot have a conflicting Apple or Podcast Index ID. This tool refuses the future ownership schema until its authorization behavior has been reviewed; do not use it to classify or merge private feeds.

For a verified pair:

- Shared source-scoped GUIDs map to the canonical episode IDs. Where both rows contain media, enclosure URLs must match exactly; textual URL normalization is not identity proof.
- Canonical-only episodes remain untouched. Duplicate-only episodes are reparented with their existing IDs, content and progress intact. Neither side must be a subset of the other.
- Existing canonical content and publication timestamps win. Missing canonical content is filled from the duplicate. Title/publication differences require an exact reviewed-differences digest. If either side's media was evicted, those cases require a separate `reviewedMissingMedia` digest backed by protected source-equivalence evidence; a missing file is not itself proof of correspondence. Review live sources and historical evidence before authorizing either digest. Disagreeing media URLs when both exist always abort.
- Progress references move through the episode map without changing position, completion or update timestamp. If a user has progress on both corresponding episodes, the tool refuses to choose a winner—even if a maximum position or latest timestamp looks convenient.
- Subscriptions converge on the canonical record, preserving the earliest subscription timestamp per account.
- Duplicate transcripts, genres or chart references require a separate reviewed policy and currently abort. Canonical references are preserved.
- Canonical provider IDs and metadata are retained, except the verified feed locator, derived episode count, essential/access state and update timestamp. Conditional-fetch validators are cleared and the surviving source is scheduled for a fresh poll.

Removed podcast/duplicate episode IDs do not acquire permanent redirects. Old guest queues, local caches or links can become stale. The protected backup contains the ID mapping for recovery. Historical feed URLs can recreate duplicates until the planned alias resolver is deployed.

## Safety boundary

The tool takes existing refresh/import advisory locks, then row locks over affected podcasts, episodes, content and dependent records. It verifies the known foreign-key dependency set and rejects changed source identities. A reviewed full snapshot must match immediately before mutation: new episodes, progress, subscriptions, metadata or poll state require reinspection rather than silently extending the approved operation.

This coordinates existing application paths during the transaction; it is not a permanent writer cutover. Check bulk importers, caches, old clients and non-database references separately. Locks do not prevent a historical URL import after commit.

Every invocation writes a new full affected-row snapshot plus shared-episode mapping, retains unique episode IDs, flushes it to disk, reads it back and checks its digest before any public-table mutation. Artifact files use exclusive creation and mode `0600`; their directory must be operator-owned mode `0700`. Existing files are never overwritten. A backup failure aborts the transaction.

The backup includes affected rows from podcasts, episodes, episode content, subscriptions, progress, transcripts, polling state, genres and charts. It does not include prerequisite users/authors/countries/genres or the entire application database. Those dependencies must be available or reconstructed in an isolated rehearsal.

After mutation, exact postconditions check episode identity/content, progress, subscriptions, surviving metadata, other references and poll-state reset before commit. Dry-run executes the same changes and postconditions, then rolls back. On any failure the database transaction rolls back; the protected pre-change artifact remains useful evidence.

## Operator workflow

1. Obtain explicit approval for each pair and proposed survivor. Verify provider identity and the authoritative public feed, including redirects and live episode correspondence. Matching titles alone is insufficient.
2. Inventory all database and external/client references. Review unique episodes, missing content, conflicting progress and metadata differences. Stop on unverified correspondence.
3. Build a protected JSON plan, not a checked-in repair script:

```json
{
  "canonicalId": 100,
  "duplicateId": 200,
  "canonicalFeedUrl": "https://feeds.example.invalid/current",
  "reviewedDifferences": ""
}
```

4. Inspect with a fresh backup path:

```bash
bun scripts/reconcile-podcasts.ts \
  --plan /protected/plan.json \
  --backup /protected/inspection.json \
  --mode inspect
```

5. Review the protected `differences` and their live-source evidence. Put the reported `differencesDigest` into the plan's `reviewedDifferences` field, including the empty-list digest when there are no differences. If `missingMedia` is nonempty, review every listed case using independently verified source equivalence and retained history, record that evidence privately, and set `reviewedMissingMedia` to the exact `missingMediaDigest`. An archived episode's absence from today's feed is not a reason to discard it or assume it was a different episode. Stop if identity remains uncertain. Reinspect using the finalized plan and a new path; this is the expected snapshot for dry-run/apply. Do not edit a snapshot to bypass a changed-state check.
6. Back up affected cache values and expiry information separately. Address only source-specific keys; never globally flush caches. Verify that a cache hit cannot bypass the newly selected source identity.
7. Run the mutation as a rollback-only rehearsal:

```bash
bun scripts/reconcile-podcasts.ts \
  --plan /protected/plan.json \
  --expected /protected/reviewed-inspection.json \
  --backup /protected/dry-run.json \
  --mode dry-run
```

8. Restore the actual affected-row backup into an isolated PostgreSQL cluster/schema and replay dry-run there. Restore parent records before dependents; use synthetic users/authors for missing prerequisites when testing the backup privately. Never run a restore rehearsal against production.
9. Recheck live writers/state. Apply the same reviewed plan with a new backup path and `--mode apply`. Any snapshot change means stop, inspect and review again. Treat a connection failure near commit as an unknown outcome: inspect the database before retrying.
10. Invalidate only the backed-up affected cache keys. Verify database postconditions independently, public canonical metadata, former duplicate-ID behavior, exact user-state transfers, and cache misses. Record receipts and backup locations privately.

Set connection credentials securely in `RECONCILE_DATABASE_URL` before these commands. Do not paste passwords into commands, transcripts, manifests or Git. The code may be bundled with `bun build --target=bun` for an operational host without installing project dependencies; record and verify the bundle hash before execution.

Cache invalidation is deliberately outside the SQL transaction. If the database commits but cache cleanup fails, report partial completion and repair the specific cache boundary; do not rerun the merge. Public API checks can trigger normal read/access activity, so account for that when comparing post-commit metadata.

## Recovery

Backups are an undo source, not permission to overwrite subsequent user activity. Coordinate writers, inventory changes since commit, review the desired reversal and preserve newer progress/subscriptions. Recreating removed IDs without checking current unique keys or new references can introduce fresh conflicts.

Restore in dependency order: prerequisite parents, podcasts, episodes, content, then subscriptions/progress/transcripts/polling and catalog relations. Retain the original mapping and protect recovered credentials. Do not routinely restore stale cache entries; rebuild them from the authoritative database once the recovery is verified. Keep a separately recorded final commit outcome and artifact digests.

## Verification

The [isolated PostgreSQL suite](../scripts/reconcile-podcasts.test.ts) starts its own Unix-socket database and uses synthetic hosts and accounts:

```bash
PG_BIN=/path/to/postgresql/bin bun test scripts/reconcile-podcasts.test.ts
```

It covers inspection/rollback, preservation of both sides' unique episodes, filling evicted content, exact progress transfer, subscription timestamps, progress collisions, media mismatch, explicit metadata and missing-media review, changed snapshots, unknown foreign keys, unsupported references, protected backup failures, provider conflicts, reapplication refusal, backup restore/replay and artifact permissions.

The suite skips if `PG_BIN` is absent. A default green test run is not evidence that these database tests ran. Production data and operational evidence must never become checked-in fixtures or public CI artifacts.
