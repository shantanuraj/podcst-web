# Service scripts

The systemd units are installation templates, not a description of the hosted
service. Adapt their paths and accounts before installing them. They assume a
checkout at `/opt/podcst`, a `svc-podcst` user, and private configuration files
under `/etc/podcst/`. No script provisions those resources.

Poller/chart/tier units read application connection settings from `app.env`.
Backup units read `backup.env`, which must set:

- `BACKUP_DATABASE_URL`: the explicitly selected database
- `BACKUP_RECIPIENT`: an age encryption recipient, never a private key
- `BACKUP_BUCKET`: an S3 bucket with Object Lock enabled
- `BACKUP_MIN_PODCASTS` and `BACKUP_MIN_EPISODES`: positive minimum row counts
  for identity snapshots, chosen for your dataset

AWS CLI uses its normal credential chain; set `AWS_PROFILE` if needed. Restrict
environment-file permissions. Backup scripts require Linux/GNU coreutils,
PostgreSQL client tools, age, AWS CLI and (for identity snapshots) zstd on `PATH`.
Missing required configuration stops the script before a dump or upload.

## Built application checks

Build the reviewed candidate in an isolated checkout with frozen dependencies and
no application environment files, then run:

```sh
BUILT_APP_DIRECTORY=/path/to/built-checkout PG_BIN=/path/to/postgresql/bin \
  bun --no-env-file scripts/test-built-app.ts
```

The runner needs Node, Bun and `redis-server`. It starts disposable PostgreSQL and
Redis, seeds synthetic data, and serves the standalone build on loopback. It runs
SSR checks and authenticated progress/follow/list HTTP tests, including lost-ack
replay, the numeric Starred bridge, checkpoint completion and rejected writers.
The app and test processes receive an explicit environment, not inherited
application credentials. Redis uses an owner-protected local socket.

The runner does not rebuild the candidate: keep its build artifacts, source and the
current checkout's schema/tests aligned. Standalone environment files are refused.
Sandbox processes are stopped on success, failure or interruption; failed runs
retain their private log directory for diagnosis. These checks do not authorize a
production migration or prove physical-device behavior.

## Backup coverage and recovery

[`podcst-backup.sh`](podcst-backup.sh) is the authoritative selected-table list.
Its encrypted archive includes account/authentication state, subscriptions,
playback, transcripts, feed/Apple aliases, preferences, and complete dependency
parents in the same snapshot:

- `authors`, `podcasts` (including ownership), `episodes` and `episode_content`:
  saved metadata remains recoverable even when a publisher disappears
- `countries`, `genres`, `podcasts_genres`: reference parents and assignments
- `oauth_accounts`: conservatively retained; absence of current callers does not
  establish that existing credentials can be discarded
- `podcst_migrations.history`: matching migration names/checksums and adoption history


- `episode_lists`: starred lists and playlists, including revisions and timestamps
- `episode_list_items`: membership and ordering timestamps, even for evicted content
- `episode_list_clients`: sequence, request hash and saved result for retry deduplication
- `chart_history`: historical daily ranks, not reconstructible from current charts
- `state_generation`: current recovery fence and immutable initial legacy generation
- `progress_revision_heads`, `follow_revision_heads`: independent accepted-action heads
- `progress_clients`, `follow_clients`: stream sequences, hashes and saved acknowledgements

All selected tables share one `pg_dump` snapshot. `--strict-names` refuses missing
tables; a dump failure prevents encryption/upload. Owned serial sequences are
included by `pg_dump`; their `SEQUENCE SET` entries are required, not just the
maximum surviving IDs. Encryption, object naming and retention are unchanged.
The script's retention periods are not recovery objectives or deletion promises.

This is a dependency-closed application snapshot, **not a full database backup**.
Only these current application tables are excluded:

| Table | Recovery consequence |
| --- | --- |
| `feed_poll_state` | Rebuild validators/backoff/scheduling; cold polling adds I/O and must be rate-controlled |
| `poll_metrics` | Historical operational telemetry is lost; do not use it as durable recovery evidence |
| `top_podcasts` | Current charts need a refresh; `chart_history` remains included |

The separately timed identity snapshots are not needed as parents for this
archive and must not be spliced into it. Audio files are not archived. PostgreSQL
roles/grants, encryption keys, service configuration and Redis are outside the
archive. New tables require an explicit coverage decision, especially deletion
receipts and erasure/revocation records.

### Activation and fresh restore

1. Before activation, compare the exact installed helper revision, migration
   ledger and schema with the reviewed candidate. Require migrations through
   `0010`, SELECT on every selected table (including the migration ledger), schema
   USAGE and sequence read privileges. Stop on drift or permission errors; do not
   broaden grants, skip tables or migrate to make a backup pass. Use the
   [schema comparison](../docs/schema-inventory.md) separately: a ledger alone
   does not prove absence of schema drift.
2. Measure database size, dump duration, temporary disk, encrypted upload size and
   retention cost before changing a schedule. Synthetic comparisons are not
   production capacity measurements. Get explicit operational approval for the
   target, revision, impact, writer plan, checkpoint, recovery and verification.
3. Under separately approved artifact access, verify ciphertext identity/hash,
   retention and key availability in a protected environment. Retain the source
   revision, PostgreSQL/tool versions and schema/migration checksums with the
   private receipt. Do not download production data to developer machines.
4. Create a **fresh isolated database** from the exact trusted migration chain.
   Do not restore selected archive DDL as a schema: table selection omits function
   dependencies such as ownership guards. Keep foreign keys and triggers enabled,
   fence all writers and admit no traffic. Remove only the disposable bootstrap
   `genres`, `state_generation` and migration-ledger rows before loading captured
   data; do not preseed catalogue or account parents.
5. Review `pg_restore --list` and construct a `--use-list` containing each selected
   `TABLE DATA` entry in the script's parent-first selection order, followed by all
   owned `SEQUENCE SET` entries. Use `--data-only --exit-on-error
   --single-transaction`. Verify coverage rather than guessing sequence names.
   On any error discard the isolated target: sequence changes are not guaranteed
   to roll back. Never disable guards or invent parents to make recovery pass.
6. Compare restored migration names/checksums with the pinned source chain; refuse
   mismatches or pending migrations. Verify exact rows, private access refusal,
   saved metadata, ranks, sequences and new inserts, plus replay/subsequent
   mutations. The synthetic fixture exercises this procedure, not a production
   restore command or release authorization.

Restore resource rows, revision heads, generation and client deduplication records
from the same snapshot. Omitting retry state can reapply acknowledged progress,
resurrect removed follows/stars or change latest playback. The schema seeds a
generation row; remove that disposable bootstrap row before restoring the captured
one, under a reviewed restore procedure with no writers admitted.

Before restored traffic opens, rotate only the current generation, keeping
`legacy_generation` unchanged, and enforce the separately required post-checkpoint
erasure/revocation obligations. An old snapshot cannot contain later deletions or
credential revocations; generation rotation does **not** revoke restored sessions
or passkeys. Independently recoverable, privacy-minimized suppression records and
an approved retention/replay policy are prerequisites for reopening restored
traffic, not supplied by this script. If that evidence is unavailable, remain
closed. Old clients must remain blocked for explicit reconciliation; never
renumber streams or upload cached libraries. A client can be
ahead of the checkpoint even if its next sequence appears acceptable. Account for
newer activity before recovery; do not blindly restore over it. Keep credentials,
dumps and recovery records outside the repository.

Runtime access to the generation row needs SELECT and enough column-level UPDATE
privilege to take a row share lock (for example UPDATE on `singleton` only). It does
not need permission to rotate either generation or delete that row. Review the
runtime and backup grants when activating new tables; never broaden them merely to
silence a refusal.

## Backup tests

```sh
bun --no-env-file test scripts/backup-config.test.ts scripts/podcst-backup.test.ts
PG_BIN=/path/to/postgresql-16/bin bun --no-env-file test scripts/backup-config.test.ts scripts/podcst-backup.test.ts
```

With `PG_BIN`, tests create disposable local clusters using all active migrations.
They require every application/ledger table to be selected or explicitly excluded
with a reason, check foreign-key closure and parent order, then restore into a
fresh matching-schema database without publisher access or invented parents.
Checks cover exact rows, ledger checksums, owned sequence positions (including
unused high values), new inserts, saved private/public metadata, guards,
pre-checkpoint cascades, lost-ack/opposite-action retries and subsequent mutations.
Generation rotation fences all three resources, including legacy Starred work.
Every missing selected table refuses a dump. A synthetic size/runtime comparison
prints selected/full archive bytes and elapsed times; it is not a storage budget.

New migrations must update this coverage decision. These tests do not implement
account deletion or later erasure replay, and do not prove production ciphertext
recovery, off-host key availability, alert delivery or recovery objectives.
