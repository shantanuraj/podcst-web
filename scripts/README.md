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
- `account_erasure_intents`: accepted account/credential fences and publication/application outcomes; this primary copy is not independent recovery evidence
- `recovery_state`: transactionally applied journal prefix and incarnation bindings; this row cannot open external admission

All selected tables share one `pg_dump` snapshot. `--strict-names` refuses missing
tables; a dump failure prevents encryption/upload. Owned serial sequences are
included by `pg_dump`; their `SEQUENCE SET` entries are required, not just the
maximum surviving IDs. Encryption, object naming and retention are unchanged.
The script's retention periods are not recovery objectives or deletion promises.

This is a dependency-closed application snapshot, **not a full database backup**.
Only these current application tables are excluded:

| Table | Recovery consequence |
| --- | --- |
| `account_erasure_proofs` | Unaccepted short-lived deletion proofs must be invalidated, never restored as authority; receipt capabilities live outside this archive |
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
   `0014`, SELECT on every selected table (including the migration ledger), schema
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

New migrations must update this coverage decision. Backup coverage tests alone do
not establish deletion-aware admission. The recovery suite below exercises actual
publication/replay; neither suite proves production ciphertext recovery, off-host
key availability, physical retention or recovery objectives.

## Recovery admission

`recover-account-state.ts` is operator-only tooling. It requires a private,
operator-owned configuration outside the repository, explicit database/socket/
role/tool identities, a trusted schema reference, independent journal/authority/
receipt stores and recovery keys. Configuration types live in that script and
`erasure-journal/configuration.ts`. No command provisions services or broadens grants.

```sh
bun --no-env-file scripts/recover-account-state.ts reference --config CONFIG
bun --no-env-file scripts/recover-account-state.ts capture --config CONFIG
bun --no-env-file scripts/recover-account-state.ts recover --config CONFIG
bun --no-env-file scripts/erasure-journal/serve.ts JOURNAL_CONFIG
bun --no-env-file scripts/recovery-gateway.ts GATEWAY_CONFIG
```

- `reference` builds a schema fingerprint from the trusted migration chain in a
  disposable PostgreSQL instance. A ledger alone is insufficient.
- `bootstrap` establishes the first verified prefix on a trusted current primary;
  it is single-use, not a fallback for an unsupported restore.
- `capture` exports one MVCC snapshot, binds its already-verified applied prefix,
  streams an age-encrypted selected/full archive and registers its signed manifest
  in current independent inventory. Overlapping recovery refuses registration.
- `recover` requires an eligible artifact and restores only into an isolated empty
  target under matching constraints. Effects and replay watermarks commit together.
  Pending intents reconcile under a gated provisional epoch before the final seal.
  All sessions/codes/proofs and OAuth tokens retire; only the current state
  generation changes. Stream history and the legacy generation remain untouched.
- `rotate-auth` retires Redis authentication after a restart/rollback on the exact
  still-running admitted primary. It cannot waive a changed PostgreSQL incarnation
  or substitute for artifact recovery. Existing authenticated revocation does not
  depend on healthy Redis; new authentication requires the admitted Redis instance.
- `retire` removes logical artifact eligibility, not its bytes or suppression
  evidence. `abandon` leaves admission closed and does not destroy a failed target.

Recovery permanently renames retired database roles into disabled identities and
uses a fresh serving role, publication epoch and encrypted runtime credential.
The protected result includes the new runtime token; never log or publish it.
A lost acknowledgement requires inspecting/resuming the same run ID. A failed
restore without its durable receipt requires a new isolated target, not disabled
constraints or a blind overwrite. Restore scratch contains protected plaintext;
its storage encryption, capacity, crash leftovers and disposition need an approved
operational plan. Capture creates no plaintext archive.

`0014` installs statement-level write guards on every application table. Missing
or stale incarnation/role/generation/server bindings refuse ordinary writes,
including workers reconnecting after a PostgreSQL restart. It is **not** a
schema-only rollout: coordinate the fence, bootstrap and fresh role/configuration.
Runtime needs SELECT on recovery metadata, EXECUTE on `pg_control_system()` and
only UPDATE on `state_generation.singleton` for shared locking, never write access
to recovery metadata or either generation. The controller refuses unsafe ownership,
column-level grants, replication bypass and unaccounted login roles.

Serve all traffic through the external gateway; keep upstream origins inaccessible
as bypasses. Configure every app/worker with `RECOVERY_ADMISSION_REQUIRED=1` and
current `ERASURE_JOURNAL_URL`, `ERASURE_JOURNAL_ID`, `ERASURE_JOURNAL_TOKEN`,
`ERASURE_WRITER_EPOCH` and public `ERASURE_VERIFICATION_KEYS`. The journal configuration
contains only recovery/admission management tokens; runtime tokens are per-run.
The gateway and upstream exchange fresh signed nonces, not cached ready flags.
`ACCOUNT_ERASURE_ENABLED` gates new full-account deletion proofs/acceptance and
also requires admission. With `RECOVERY_ADMISSION_REQUIRED=1`, protected passkey
revocation, receipt reconciliation and accepted obligations remain available even
when account deletion is disabled. There is no unjournaled fallback. Authentication
additionally checks its Redis epoch and server identity.

```sh
PG_BIN=/path/to/postgresql/bin REQUIRE_ERASURE_TESTS=1 \
  bun --no-env-file test src/server/erasure
BUILT_APP_DIRECTORY=/path/to/isolated-build PG_BIN=/path/to/postgresql/bin \
  bun --no-env-file scripts/test-recovery-admission.ts
```

The controller suite requires age, age-keygen and Redis. Built admission checks
also require Node and OpenSSL; they use a synthetic TLS certificate trusted only
by the child app and test gateway. No system trust store changes. They test actual
API/private-read refusal, state access and authenticated revocation during Redis
outages. All datasets and keys are disposable. No local test or commit authorizes
production migration, service installation, credential changes or deletion.
