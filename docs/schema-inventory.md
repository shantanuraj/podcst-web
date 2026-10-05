# Schema comparison

[`scripts/schema-inventory.ts`](../scripts/schema-inventory.ts) compares PostgreSQL
catalog metadata with a disposable reference built from active migrations. It
reads no application rows, changes no target objects and records no migration
history. PostgreSQL 16 or newer is required.

## Usage

Create a private directory outside the repository. Captures can contain sensitive
object names, defaults and access rules; do not publish them as CI artifacts.

```sh
install -d -m 700 "$HOME/.local/state/podcst-schema-review"

PG_BIN=/path/to/postgresql/bin yarn db:schema reference \
  --output "$HOME/.local/state/podcst-schema-review/reference.json"
```

Reference generation starts and removes its own local cluster. It ignores remote
connection settings. Match the target's PostgreSQL major version and locale where
possible.

Set `SCHEMA_DATABASE_URL` securely to the intended database, preferably using a
read-only catalogue role, then capture:

```sh
yarn db:schema capture \
  --output "$HOME/.local/state/podcst-schema-review/capture.json"
```

Capture uses a read-only transaction and bounded queries; it does not read
sequence positions or scan tables for row counts. It never falls back to the
application connection. A permissions or timeout error needs investigation, not
a retry with broader privileges.

Comparison runs offline:

```sh
yarn db:schema compare \
  --expected "$HOME/.local/state/podcst-schema-review/reference.json" \
  --actual "$HOME/.local/state/podcst-schema-review/capture.json" \
  --output "$HOME/.local/state/podcst-schema-review/comparison.json"
```

Use new filenames for each run. Artifacts are exclusive-created with mode `0600`
and checked on read-back; symlinks, repository-local paths and stale references
are refused. Regenerate the reference after changing the active migration chain.

## Reading the result

Exit zero means a report was produced, **not** that schemas match. Review:

- Missing, extra or changed relations, columns, constraints, indexes and sequences.
- Owners and access rules, separately from structural differences.
- Version, encoding and locale differences.
- Features marked for manual review, including routines, triggers and policies.

Comparison is exact for captured fields, not a semantic SQL equivalence check.
Physical column positions and object names matter. Estimates come from catalogue
statistics and are not accurate storage or migration-cost measurements.

A match does not prove historical data preservation, sequence safety, correct
ownership, or backup recovery. Routine bodies, global role memberships and other
uncaptured settings still need separate review. Never execute expressions from
an inventory. Use [migration status](database-migrations.md) to inspect the ledger;
this tool does not verify its rows or approve adoption.

## Tests

```sh
PG_BIN=/path/to/postgresql/bin bun test scripts/schema-inventory.test.ts
```

The suite uses synthetic data in disposable clusters and skips without `PG_BIN`.
