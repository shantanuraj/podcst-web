# Podcast Index import coverage and recovery

Run migrations before deploying the importer (`bun scripts/migrate.ts up`).
Migration 0023 adds an independent undated-entry checkpoint, initially zero;
existing positive dated watermarks do not need resetting to repair omissions.

The importer processes two disjoint groups:

- NULL, zero, and negative `lastUpdate`: ID-ordered batches using the partial
  `podcasts_sync_undated` index. These entries still go through the usual catalog
  validation, identity checks, and rejection logging. Missing dates alone are
  not a rejection.
- Positive `lastUpdate`: indexed `(lastUpdate, id)` keyset pagination after the
  existing durable watermark. The count query uses the same predicate. Since
  durable timestamps are nonnegative, the tuple comparison excludes negatives
  and NULLs; a `lastUpdate != 0` filter excludes zero without competing with the
  cursor's index range. Adding `lastUpdate > 0` instead can make SQLite rescan
  earlier dated rows on every page despite still using the index.

Undated batches checkpoint only after the whole batch resolves. Failures replay
uncheckpointed work through the existing idempotent catalog writes. Undated
progress never advances the dated watermark. Only successful completion of both
passes records `completed_at` and atomically resets the undated checkpoint to
zero. This deliberately revisits undated records on the next completed run:
without a source change timestamp, retaining an ID watermark forever would miss
changes and older IDs newly exported without dates. Source rows are loaded one
batch at a time; neither pass uses OFFSET or a per-page table sort. Completion
totals include both passes for the current attempt, even when no dated rows
remain; work checkpointed by earlier attempts is not included.

Keep the same SQLite snapshot when resuming a failed run. Extraction uses a
private staging directory and publishes the database only after tar succeeds;
failed extraction output is discarded. Ingestion failures retain the completed
archive/database snapshot; successful automatic imports remove them as before.
Explicit local sources are retained. Replacing a snapshot while a run is
incomplete can miss IDs before its saved cursors. After an intentional
replacement, reset `undated_last_id` to zero to rescan the undated group. As with
the existing incremental algorithm, positive source dates that move backwards
or entries newly added below the dated watermark require a full reconciliation;
`lastUpdate` is not a guaranteed monotonic catalog-change sequence.

## Coverage limits

[Podcast Index's database documentation](https://github.com/Podcastindex-org/database)
describes `lastupdate` as the channel publication date when determinable, and
documents `dead` separately. A missing date is not an invalid catalog identity,
nor is a present date proof of current feed availability. Catalog input does not
require `lastUpdate`.

The former tuple predicate always omitted NULLs. Zero dates were eligible while
the timestamp watermark was zero; runs starting at a positive watermark skipped
them. Coalescing NULL to zero in the dated index alone would not repair an
existing positive watermark or discover future undated entries. Dated rejections
are still passed by the cursor and are not retried unless their source tuple
advances or an operator initiates a reconciliation.

For an actual SQLite dump, run this read-only coverage query before importing:

```sql
SELECT
  COUNT(*) AS total,
  SUM(lastUpdate IS NULL) AS null_dates,
  SUM(lastUpdate = 0) AS zero_dates,
  SUM(lastUpdate < 0) AS negative_dates,
  SUM(lastUpdate > 0) AS dated,
  SUM((lastUpdate IS NULL OR lastUpdate <= 0)
      AND trim(title) <> '' AND trim(url) <> '' AND dead <> 1)
    AS named_non_dead_undated
FROM podcasts;
```

The last count is a useful candidate set, not proof of feed availability. Inspect
feed URLs and episode metadata before making claims about current usability.
