# Audited database migrations

This is the implemented migration-runner slice of [R1](release.md#execution-sequence), not sign-off of an existing database or production recovery. The [foundations plan](pre-release-foundations.md#8-treat-migrations-as-an-audited-mechanism) owns the migration/cutover requirements; the release hub owns phase status.

## Active history and fresh installs

Only SQL under [`migrations/active/`](../migrations/active/) is executable by the runner. Its `0000-baseline.sql` creates the current schema directly, including bigint identities, feed polling state, podcast tier fields and separate episode identity/content tables. The former hand-maintained `schema.sql` has been replaced by this baseline. Integration fixtures use it without replaying repair scripts or manually reshaping episode tables.

The older top-level migration files and manual tier-swap scripts remain historical evidence. **They are not a fresh-install chain or an upgrade recipe.** In particular, the old `0004-episodes-bigint.sql` drops episodes and truncates progress/transcripts. The new runner never discovers it and does not accept a filename argument.

The new active history describes a fresh schema, not a claim that each historical repair was applied to an existing database. Do not use the baseline SQL to replace an existing installation.

## Commands

Set `MIGRATION_DATABASE_URL` securely to the explicitly selected PostgreSQL host and database. The CLI does not fall back to `DATABASE_URL` or silently load the application database module. Prefer a dedicated migration role rather than granting runtime clients ledger/DDL privileges. Standard host/port URLs and a Unix-socket directory supplied by the URL's `host` query parameter are supported.

```bash
yarn db:migrate
yarn db:migrate status
```

Both commands inspect in a read-only, repeatable-read transaction. Output contains migration names, SHA-256 checksums and applied/pending states, not credentials or application records:

- `empty`: no application tables, views, sequences, foreign tables, routines, domains or enums were found in non-system schemas, and no ledger exists.
- `untracked`: existing objects were found without a migration ledger. Applying is refused.
- `tracked`: recorded history is a valid prefix of the active files with matching checksums.

Status verifies history, **not live-schema equivalence**. Unrecorded manual DDL is not detected by comparing migration-file checksums. A pending row on an untracked database is not authorization to apply it.

After reviewing the target and pending changes:

```bash
yarn db:migrate up
```

`up` works only for an empty database or a database already managed by this runner. It acquires a nonblocking, namespaced PostgreSQL transaction advisory lock; overlapping runners fail rather than interleave. All pending migrations and their ledger entries commit as **one transaction**, with a five-second lock timeout and ten-minute statement timeout. Any SQL failure rolls back the entire pending batch, including a newly created ledger. A rerun with no pending files makes no schema/data changes.

The ledger is `podcst_migrations.history`, containing the filename, exact-source checksum and application timestamp. Modified/missing/reordered applied files, an unknown applied migration or an empty ledger fail closed before migration SQL executes. The baseline and ledger are created atomically.

The lock coordinates this runner, not arbitrary application writers, old scripts or manual SQL. It is not a substitute for the writer pause required by a breaking cutover. Apply only reviewed repository SQL; the source checks are not a sandbox for untrusted SQL.

## Adding a migration

1. Add a new `NNNN-description.sql` file under `migrations/active/`, ordered after every applied file. Versions must be unique. Never edit an applied file, including whitespace; append a corrective migration instead.
2. Do not include `BEGIN`, `COMMIT`, `ROLLBACK` or other transaction-control statements. The runner owns the transaction. SQL comments, quoted values and routine bodies are distinguished during this check.
3. Add populated-upgrade and failure/rollback tests. Verify stable IDs and user references, not just the presence of new columns. Use bounded data changes and rehearse expensive rewrites.
4. Review status and the exact SQL before applying. Take and verify the required protected backup and coordinate writers.

Only transactional SQL is supported in this slice. Operations such as `CREATE INDEX CONCURRENTLY` fail inside the transaction; there is no force/nontransactional flag or automatic retry outside it. A future exception needs its own reviewed interruption, recovery and recording contract. Split/rehearse large batches rather than bypassing the runner's controls.

Derive any future schema snapshot from a database built through the active migrations. Do not recreate a second hand-maintained schema definition.

## Existing-database adoption: deliberately blocked

There is no automatic baseline/adoption command in this slice. Similar table names, a matching fresh-install schema, or a successful connection do not establish the history of data repairs and manual swaps.

Before implementing and authorizing adoption:

1. Inventory the actual schema, constraints, sequences, indexes, manual repairs and retained old tables. Compare with the active baseline and explain every difference. Keep records and identifiers in protected operational storage.
2. Establish which historical data transformations occurred, including identity preservation and the tier split. Do not infer this from schema shape alone or mark historical migrations applied speculatively.
3. Restore a protected backup into an isolated database, preserve user/episode references, and rehearse any reconciliation plus the proposed history recording.
4. Review a database-bound, drift-checked adoption plan and the obsolete-writer/client cutover. Resolve differences before recording the active baseline; never use a manual ledger insertion to silence a refusal.
5. Record approved execution and recovery evidence, then update R1 status in the release hub.

These are remaining acceptance gates, not operations performed by the implementation or tests. Production inventories, schema captures and recovery artifacts must not be committed to this repository.

## Failure and recovery

After a normal SQL error, the pending batch rolls back and the advisory lock releases. Previously committed history/user data remain intact. Inspect status, fix an unapplied migration if appropriate and retry only after reviewing the cause.

A connection failure near commit has an **unknown outcome**: the server may have committed while the acknowledgement was lost. Reconnect and inspect history/state before retrying. The CLI avoids printing raw database errors that might contain credentials or data; investigate database diagnostics in protected storage. Do not assume an error exit means no commit occurred.

There is no automatic `down`. Recovery after a committed destructive change requires a reviewed forward correction or protected restore with writers coordinated and newer user activity accounted for. Transaction rollback tests are not a backup restore rehearsal or an RPO/RTO certification.

## Verification

The migration suite starts a disposable PostgreSQL cluster with synthetic data and a private Unix socket. No application/production connection is used:

```bash
PG_BIN=/path/to/postgresql/bin bun test scripts/migrations.test.ts scripts/reconcile-podcasts.test.ts
```

Coverage includes read-only/default inspection, explicit target selection, historical-script exclusion, exact checksums, version order, fresh install, populated upgrade, repeat no-op, untracked-database refusal, rollback of schema/data/history, whole-batch atomicity, unsupported transaction control/nontransactional SQL and concurrent runners. The shared helper also supports an ephemeral loopback port for the existing integration suites.

CI provisions PostgreSQL 16 and sets `PG_BIN` so the migration and reconciliation tests actually run. Existing application integration suites still require `TEST_DATABASE_URL`; absence of that variable remains a skip, not a pass.

Local verification for this slice: **45 migration tests and 16 reconciliation tests passed**. The full Bun run against disposable PostgreSQL passed **220 tests**, with **28 unrelated platform/SSR tests skipped**. Project and targeted script TypeScript checks and targeted Biome checks passed. The historical reconciliation restore test ran; adoption of an existing production schema, production backup recovery, device tests and the public-release cutover were not performed.
