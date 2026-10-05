# Database migrations

Only [`migrations/active/`](../migrations/active/) is run by the migration tool.
`0000-baseline.sql` initializes an empty database; later files apply in order.
Historical migrations and tier-swap scripts have been retired. Do not retrieve
and replay them from older checkouts; they are not an upgrade sequence.

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

`up` applies all pending migrations and their ledger entries in one transaction.
A nonblocking advisory lock rejects concurrent runners. A SQL error rolls back
the whole batch. There is no automatic `down`, force flag, or nontransactional
mode. The lock does not coordinate application writers or manual SQL.

## Adding a migration

1. Add `NNNN-description.sql` after the existing active files.
2. Never edit an applied migration, including whitespace. Add a correction.
3. Leave transaction control to the runner; do not include `BEGIN` or `COMMIT`.
4. Test fresh installation, populated upgrades, stable IDs/user references, and
   rollback on failure. Rehearse expensive changes on representative test data.
5. Review pending SQL, backup recovery and writer compatibility before applying
   it to an existing installation.

Operations such as `CREATE INDEX CONCURRENTLY` cannot run in this transaction.
Do not work around that by bypassing the ledger.

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

Keep credentials, database captures and recovery receipts out of Git and public
logs. Schema matches and rollback tests do not establish backup recoverability.

## Tests

```sh
PG_BIN=/path/to/postgresql/bin bun test scripts/migrations.test.ts scripts/baseline-adoption.test.ts
```

These suites use disposable PostgreSQL clusters with synthetic data. They skip
when `PG_BIN` is absent.
