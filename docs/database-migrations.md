# Database migrations

Only [`migrations/active/`](../migrations/active/) is run by the migration tool.
`0000-baseline.sql` initializes an empty database; later files apply in order.
Historical migrations and tier-swap scripts have been retired. Do not retrieve
and replay them from older checkouts; they are not an upgrade sequence.

The current chain includes `0025-review-accounts.sql` and ends at
`0026-account-deletion-receipts.sql`. Account deletion uses the unchanged `0013`
bookkeeping plus `0026` receipts. See [Account deletion](account-deletion.md).
`0014` is reserved for parked recovery work and is not
part of this release chain; do not reuse its number. Application builds, container
startup and deployment do not run migrations automatically.

## Commands

Set `MIGRATION_DATABASE_URL` to the intended database. The CLI does not fall back
to the application's connection settings. Use a separate migration role for
shared installations rather than granting the runtime role DDL privileges.

```sh
yarn db:migrate status
yarn db:migrate up
```

No argument means read-only `status`. It reports:

- `empty`: no application objects or migration ledger were found.
- `untracked`: objects exist without a ledger; applying is refused.
- `tracked`: recorded migrations match a prefix of the active files.

Status checks history and checksums, not whether someone has changed the schema
manually. Use [schema comparison](schema-inventory.md) to investigate drift.

`up` applies ordinary pending migrations and their ledger entries in one
transaction. A marked concurrent index is an explicit transaction boundary:
the preceding ordinary batch commits, the index builds outside a transaction,
then its validation and ledger entry commit together. Any following ordinary
migrations form a new atomic batch. A later failure does not undo earlier
committed batches or concurrent indexes.

A reserved connection holds a nonblocking session advisory lock across all
these steps, including index creation and ledger recording. It uses the same
key as older runners' transaction locks, excluding both runner versions. There
is no automatic `down` or force flag. The lock does not coordinate application
writers or manual SQL.

## Adding a migration

1. Add `NNNN-description.sql` after the existing active files.
2. Never edit an applied migration, including whitespace. Add a correction.
3. Leave transaction control to the runner; do not include `BEGIN` or `COMMIT`.
4. Test fresh installation, populated upgrades, stable IDs/user references, and
   rollback on failure. Rehearse expensive changes on representative test data.
5. Review pending SQL, backup recovery and writer compatibility before applying
   it to an existing installation.

The only supported operation outside a transaction is a deliberately narrow
concurrent-index migration. Its first line must be exactly the marker below,
followed by one simple nonunique index on a schema-qualified ordinary table:

```sql
-- podcst-migration: concurrent-index
CREATE INDEX CONCURRENTLY example_index ON public.example (owner_id, created_at DESC);
```

Names must be unquoted identifiers of at most 63 ASCII characters. Only plain
columns with optional `ASC` or `DESC` are supported. Expressions, `INCLUDE`,
predicates, custom operator classes/collations, storage options, tablespaces,
`IF NOT EXISTS`, and extra statements are refused. Unmarked concurrent SQL
still fails inside the ordinary transaction; this is not a general escape hatch.

Ordinary statements retain the ten-minute timeout. Concurrent index statements
default to two hours; `MIGRATION_ONLINE_TIMEOUT_MS` accepts an integer from 1 to
86400000 milliseconds. Both modes use a five-second lock timeout, which can
also interrupt a concurrent build waiting for existing transactions. The runner
restores the session settings and releases its lock on success or failure.
Operator-provided maintenance memory and parallelism settings are preserved.
Disposable schema fixtures create an equivalent ordinary index so fixtures can
run in a surrounding test transaction.

## Adopting an existing database

The normal runner refuses untracked databases. The separate
[`db:adopt` tool](../scripts/adopt-baseline.ts) can record only the baseline
without executing it. Similar table names are not sufficient evidence.

Before adoption, compare the actual schema with a **baseline-only** reference,
review every difference and historical data transformation, and rehearse backup
recovery. Keep the artifacts outside the repository in a private directory.

```sh
PG_BIN=/path/to/postgresql/bin yarn db:adopt reference \
  --output /private/review/baseline.json

yarn db:adopt inspect \
  --reference /private/review/baseline.json \
  --runtime-role APP_RUNTIME_ROLE \
  --recovery-evidence REVIEWED_RECOVERY_MANIFEST_SHA256 \
  --output /private/review/review.json
```

The paths, role and digest are placeholders. Inspection uses
`MIGRATION_DATABASE_URL`, binds the exact database and role state, and changes
nothing. Eligibility is intentionally narrow; review the
[adoption implementation](../scripts/baseline-adoption.ts) and
[tests](../scripts/baseline-adoption.test.ts) for supported differences.

After reviewing the report and recovery evidence, coordinate DDL and role changes
and use the exact review digest:

```sh
yarn db:adopt apply --review /private/review/review.json \
  --reviewed EXACT_REVIEW_DIGEST --receipt /private/review/receipt.json
```

Adoption rechecks the target, schema and role isolation before recording history.
It does not rewrite application tables or apply later migrations. A drift or
permissions refusal needs investigation, not a manual ledger insertion.

## Failure and recovery

A connection loss near commit has an unknown outcome: inspect history and state
before retrying. An error exit does not prove rollback. Recovery after a committed
change must account for newer user activity; a stale backup must not overwrite it.

A failed concurrent build can leave an invalid index without a ledger entry.
The runner never drops or silently accepts it. A retry can record an existing
index only when its catalog definition matches exactly and it is valid, ready,
and live. This handles interruption after a successful build but before the
ledger commit. An invalid or mismatched relation requires explicit operator
recovery; inspect it before a separately reviewed `DROP INDEX CONCURRENTLY`
and retry. After a migration is recorded, index removal requires a forward
migration rather than editing history. See PostgreSQL's
[concurrent-index documentation](https://www.postgresql.org/docs/16/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY).

Keep credentials, database captures and recovery receipts out of Git and public
logs. Schema matches and rollback tests do not establish backup recoverability.

## Tests

```sh
PG_BIN=/path/to/postgresql/bin bun test scripts/migrations.test.ts scripts/baseline-adoption.test.ts
```

These suites use disposable PostgreSQL clusters with synthetic data. They skip
when `PG_BIN` is absent.
