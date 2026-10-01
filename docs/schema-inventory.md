# Metadata-only schema inventory

This implemented [R1](release.md#execution-sequence) tool compares a selected database's catalog metadata with a disposable reference built from the active migrations. It does not copy application data, alter the target, record migration history or approve adoption. It complements the [migration runbook](database-migrations.md#existing-database-adoption-deliberately-blocked).

## Why a full database copy is unnecessary

Capture reads PostgreSQL system catalogs, not episode, user, subscription or progress rows. It does not run application views/functions, inspect sequence current values, count application rows, run `ANALYZE`, traverse table files for sizes, or download media.

Work and output scale with schema complexity rather than the number of episodes. The reference command creates only a temporary local PostgreSQL cluster and applies the active migrations there; it does not restore production. Space is still needed for that empty cluster. Reference generation ignores remote/application database configuration.

The tool limits an inventory to 10,000 catalog objects and an artifact to 16 MiB. Capture uses a read-only, repeatable-read transaction, a 10-second per-statement timeout, a one-second lock timeout and a 15-second idle-transaction timeout. These are not a zero-impact guarantee or a single overall wall-clock timeout: use a low-traffic window and stop/review failures rather than raising limits blindly.

PostgreSQL 16 is tested; capture requires version 16 or newer. Build the reference with the same major version and database locale where possible. Cross-major or locale differences require explicit review, not normalization away.

## Protected artifacts

Metadata can itself contain secrets: defaults, index/constraint expressions, object names and role/ACL details may be sensitive. Keep every capture, reference and comparison outside Git in protected operational storage. Do not paste their contents into chats or upload them as public CI artifacts.

Files must be operator-owned private regular files. The tool requires a private operator-owned parent directory, creates new files with mode `0600`, refuses overwrite and file symlinks, flushes writes and verifies read-back digests. It refuses repository-local artifact paths. The parent directory must already exist; the tool does not create a potentially public hierarchy.

For example, create a dedicated local review directory:

```bash
install -d -m 700 "$HOME/.local/state/podcst-schema-review"
```

Choose new filenames for each capture. Digests detect changed payloads; they are not signatures or proof of who captured an artifact. Record the actual target, authorization, backup identity and capture time privately. Database name/role metadata is not a globally unique cluster identity.

## Commands

### 1. Build a reference locally

Set `PG_BIN` to the local PostgreSQL binary directory, containing `initdb` and `pg_ctl`. Run as a normal user, not root:

```bash
PG_BIN=/path/to/postgresql/bin yarn db:schema reference \
  --output "$HOME/.local/state/podcst-schema-review/reference.json"
```

The reference uses the audited migration runner on its own disposable cluster. It records active migration filenames/checksums, captures the resulting metadata, then stops and removes the cluster. It does not use `SCHEMA_DATABASE_URL`, `MIGRATION_DATABASE_URL` or `DATABASE_URL` to select a remote database. Failure to start/stop the cluster is an error, not a successful reference.

### 2. Capture the selected database

Obtain authorization and set `SCHEMA_DATABASE_URL` securely to the intended host and database. Prefer a dedicated read-only catalog-inspection role. Application-table SELECT and sequence-read privileges are not required by the tested workflow. The command never falls back to application connection settings or grants itself privileges.

```bash
yarn db:schema capture \
  --output "$HOME/.local/state/podcst-schema-review/capture.json"
```

Standard PostgreSQL URLs and an explicit Unix-socket `host` query parameter are supported. Do not put passwords in command history or paste them into the review record. A permissions, lock or timeout failure must be investigated; the command does not retry as a more privileged role or produce a successful partial capture.

### 3. Compare offline

No database credentials or PostgreSQL process are needed for comparison:

```bash
yarn db:schema compare \
  --expected "$HOME/.local/state/podcst-schema-review/reference.json" \
  --actual "$HOME/.local/state/podcst-schema-review/capture.json" \
  --output "$HOME/.local/state/podcst-schema-review/comparison.json"
```

The reference must match the current active migration filenames/checksums. Regenerate it after adding or changing unapplied migration files; the tool refuses a stale reference. Artifact formats/digests and unique object identities are validated before comparison.

The CLI prints only a compact receipt with digests, counts and comparison flags. Raw DDL expressions, role names, database names and target URLs remain out of stdout; database/file error details are suppressed from normal CLI output. Review detailed artifacts and database diagnostics privately.

A successful comparison command exits zero even when differences exist: generating the report succeeded. Read `schemaMatches`, access/environment differences and manual-review findings; exit zero is not a deployment gate.

## What is compared

The detailed report separates:

- **Missing, extra and changed objects:** user schemas; relations and row-security/storage flags; columns, types, nullability, defaults and identity/generated settings; constraints and validation/deferral flags; index definitions/readiness/validity; sequence configuration and ownership bindings.
- **Access changes:** recorded owners and object/column ACLs, separate from structural differences. A fresh reference's local owner is not a proposed production role mapping.
- **Environment differences:** PostgreSQL major version, encoding, locale provider, collation and recorded collation version.
- **Manual review:** nonordinary relations, custom types, routines, triggers, policies, rules, nonbuiltin extensions and additional catalog features such as event triggers, foreign servers/mappings, replication definitions, default ACLs and custom collation/operator/text-search objects.

Object names, constraint/index names and physical column positions are retained. Comparison is exact for the captured fields, not a semantic DDL equivalence checker. Some differences may be harmless historical naming/layout choices; classify them deliberately rather than automatically renaming or rebuilding large tables.

Sequences retain exact string-valued bigint parameters. Capture never reads `last_value`, calls `nextval`/`setval` or compares sequence positions. It cannot prove a sequence is ahead of all stored IDs.

`estimates` contains only `pg_class` row/page estimates and page-count-derived byte estimates. These can be stale or unknown, especially without recent statistics. They are not exact disk usage, a complete partition/TOAST/index storage total, free-space measurements or a migration-cost forecast. Estimates, capture time, database name and reader role do not change the structural fingerprint.

System schemas and the runner's `podcst_migrations` schema are excluded from the application-schema comparison. Capture records whether that namespace exists, but does not read or verify its history rows. Use the migration runner's read-only status separately when appropriate.

## Interpretation and remaining gates

`schemaMatches: true` means only that the compared object identities and captured definitions match. Access/environment differences and manual-review findings remain independent. Every receipt/report explicitly has `adoptionApproved: false`.

This is not a complete PostgreSQL schema/security dump. Routine bodies, view queries, foreign connection options and replication internals are deliberately not copied or fully compared; such objects are marked for manual review. Global roles/memberships, database-level privileges/settings, tablespace storage locations and the contents of extension-owned data need separate review. Presence checks are not proof that two unmodeled implementations agree. Never execute expressions or reconstructed DDL from an inventory file.

No schema match establishes whether historical data repairs happened, whether IDs/references were preserved, whether private ownership was classified correctly, or whether a backup is recoverable. Coordinate DDL while gathering review evidence; read-only capture does not freeze all external writers. Capture again before any separately authorized adoption and review drift.

For the large database, the next correctness rehearsal can use the reviewed schema plus a **size-capped, dependency-complete synthetic or protected subset**. It need not be a full laptop restore. Real rewrite duration, lock/WAL/disk impact and full recovery objectives still require an isolated remote restore/snapshot or other production-scale evidence. Neither capture nor comparison performs that rehearsal or signs off R1.

## Verification

```bash
PG_BIN=/path/to/postgresql/bin bun test scripts/schema-inventory.test.ts
```

The isolated suite verifies explicit target selection, a catalog reader denied application-table reads, no application values in captures, no sequence advancement, statistics-independent structural fingerprints, core schema drift, invalid indexes, exact bigint sequence configuration, access/environment separation, manual-review flags, protected file permissions, symlink/overwrite/repository-path refusal, artifact size limits, stale/corrupted artifact refusal and offline comparison.

Local verification: **30 inventory tests passed**. The full Bun suite against disposable PostgreSQL passed **250 tests**, with **28 unrelated platform/SSR tests skipped**. Project and targeted script TypeScript checks, targeted Biome checks and documentation file-link checks passed.

The reference CLI is tested with deliberately unusable remote credentials to demonstrate it uses only its own sandbox. All fixtures are synthetic. CI's existing PostgreSQL provisioning enables this suite. No production capture, adoption or full-scale restore was performed to implement the tool.
