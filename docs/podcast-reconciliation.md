# Podcast reconciliation

[`scripts/reconcile-podcasts.ts`](../scripts/reconcile-podcasts.ts) merges one
reviewed pair of duplicate **public** sources. It is not an automatic identity
resolver and never classifies ownership or merges private feeds.

The helper refuses databases with the durable-state generation/revision schema.
Changing canonical IDs there requires an explicit episode-reference and retry-stream
reconciliation contract, including offline clients. Do not bypass that refusal or
edit its schema checks to reuse the older merge procedure.

Plans, source-equivalence evidence, snapshots and receipts may contain account
records and credential-bearing URLs. Keep them outside Git in private storage.

## What it preserves

The canonical source needs a verified provider identity. Shared source-scoped
GUIDs map to canonical episode IDs; duplicate-only episodes retain their IDs
when reparented. Canonical-only episodes remain untouched.

- Existing canonical content wins; missing content can be filled from the
  duplicate. Metadata differences, missing media and differing media locators
  each require their own exact review digest.
- Progress keeps position, completion and update time. Conflicting progress for
  the same account is refused rather than choosing a winner.
- Subscriptions retain the earliest timestamp. Catalogue-reference changes and
  provider-claim retirement require explicit review.
- Accepted feed aliases survive. Canonical Apple aliases remain unchanged;
  duplicate Apple-alias transfer is not supported.
- Any saved episode membership in either source aborts the operation, including
  memberships added after inspection. List remapping requires a separate reviewed
  implementation. Unrelated saved episodes do not block a merge. The tool locks
  the membership table while checking this condition.
- Duplicate transcripts, unknown dependencies, changed guards and unsupported
  schema features abort the operation.
- Nonempty sources with no shared GUIDs cannot be merged. An empty canonical
  catalogue requires separate approval before moving episodes into it.

Source-equivalence evidence and an exact identity-transition review are mandatory.
Matching titles, missing user references or redirects alone are not approval.
Removed internal IDs do not acquire redirects; account for old links and caches.

## Workflow

Set `RECONCILE_DATABASE_URL` securely to the intended database. It does not fall
back to application settings. Use mode `0700` artifact directories and new mode
`0600` files outside the repository; outputs refuse overwrite.

1. Verify both sources and episode correspondence. Inventory database and client
   references, including missing content and conflicting progress.
2. Prepare a protected plan using the fields in the
   [tool](../scripts/reconcile-podcasts.ts). Name the survivor, duplicate,
   authoritative locator and reviewed source-evidence digest.
3. Inspect without committing changes:

   ```sh
   bun scripts/reconcile-podcasts.ts --plan /private/review/plan.json \
     --backup /private/review/inspection.json --mode inspect
   ```

4. Review every reported difference and exception. Fill the corresponding exact
   digest fields, then inspect again with a new backup path. This finalized
   snapshot is the expected state; do not edit it to bypass drift checks.
5. Rehearse the mutation with rollback:

   ```sh
   bun scripts/reconcile-podcasts.ts --plan /private/review/plan.json \
     --expected /private/review/reviewed-inspection.json \
     --backup /private/review/dry-run.json --mode dry-run
   ```

6. Restore the actual affected-row backup in an isolated database and verify
   recovery, including prerequisite parents. A dry-run alone is not a restore
   rehearsal.
7. Coordinate writers and recheck state. Only after approval, use the same reviewed
   plan and expected snapshot with a new backup path and `--mode apply`.
8. Verify the database independently and invalidate only affected cache entries.
   Cache invalidation is outside the SQL transaction; failure there is not a
   reason to rerun the merge.

Every invocation writes and verifies a bounded affected-row snapshot before
mutation. Apply takes identity and row locks, requires the reviewed snapshot to
match, verifies preservation and commits one transaction. Changed state needs
reinspection. Locks coordinate participating code, not every external writer.

The snapshot is **not a complete database backup**: prerequisite accounts,
authors and other parent records may be absent. Review the exact snapshot format
and limits in the implementation before use.

## Recovery

A lost connection near commit leaves the outcome unknown. Inspect current state
before retrying. After a committed merge, account for newer user activity before
restoring any preimage. Preserve the original episode mapping and restore parents
before dependents; do not restore stale caches over current authoritative data.

## Tests

```sh
PG_BIN=/path/to/postgresql/bin bun test scripts/reconcile-podcasts.test.ts
```

The suite uses synthetic sources in a disposable PostgreSQL cluster. It covers
preservation, refusal cases, concurrent claims, snapshot drift and restore/replay.
Without `PG_BIN` it skips.

## Bulk merges of reviewed duplicates

[`scripts/merge-duplicate-podcasts.ts`](../scripts/merge-duplicate-podcasts.ts)
merges many reviewed public pairs that no account references. Each pair is
its own read-committed transaction. The duplicate's episodes that share a GUID
with the survivor are deleted; its other episodes keep their IDs and move to the
survivor. Its feed URL and feed aliases become reviewed aliases of the survivor.
Its Apple ID becomes the survivor's preferred listing when the survivor has none,
or an Apple alias otherwise. Chart ranks and history move where the survivor has
none for that chart and day. Then the duplicate is deleted.

A pair is refused when either podcast is private, the duplicate has
subscriptions, playback or saved episodes, or the two share no episode GUID.
Refusals do not stop the remaining pairs.

```sh
MERGE_DATABASE_URL=... bun scripts/merge-duplicate-podcasts.ts \
  --plan /private/review/plan.json > /private/review/inspection.jsonl
MERGE_DATABASE_URL=... bun scripts/merge-duplicate-podcasts.ts \
  --plan /private/review/plan.json --apply > /private/review/receipt.jsonl
```

The plan is `{"reference": "<review id>", "pairs": [{"survivor": "…",
"duplicate": "…"}]}`. The output reports a digest of the duplicate's feed URL,
not the URL. Removed podcast IDs do not redirect.

## Apple IDs Apple no longer lists

[`scripts/clear-unlisted-apple-ids.ts`](../scripts/clear-unlisted-apple-ids.ts)
looks up the preferred Apple ID and Apple aliases of every essential and
followed podcast, plus any IDs named with `--ids`. It asks the US storefront
first, then each other storefront in `countries` for the IDs still missing. An
ID that no storefront returns is unlisted. A failed lookup aborts the run.

For each podcast with an unlisted ID, in its own transaction, unlisted aliases
are deleted. An unlisted preferred ID is replaced by the oldest listed alias, or
cleared. The IDs are recorded in `unlisted_apple_ids`, which keeps the Podcast
Index sync from writing them back. A later run removes IDs that Apple lists
again. Charts and Apple lookups still claim a relisted ID directly.

```sh
APPLE_IDS_DATABASE_URL=... bun scripts/clear-unlisted-apple-ids.ts [--ids ids.json] [--apply]
```
