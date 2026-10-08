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

## Backup coverage and recovery

[`podcst-backup.sh`](podcst-backup.sh) is the authoritative selected-table list.
Its daily encrypted archive includes account/authentication state, subscriptions,
playback, transcripts, feed/Apple aliases, preferences, and:

- `episode_lists`: starred lists and playlists, including revisions and timestamps
- `episode_list_items`: membership and ordering timestamps, even for evicted content
- `episode_list_clients`: sequence, request hash and saved result for retry deduplication
- `chart_history`: historical daily ranks, not reconstructible from current charts
- `state_generation`: current recovery fence and immutable initial legacy generation
- `progress_revision_heads`, `follow_revision_heads`: independent accepted-action heads
- `progress_clients`, `follow_clients`: stream sequences, hashes and saved acknowledgements

All selected tables share one `pg_dump` snapshot. `--strict-names` refuses missing
tables; a dump failure prevents encryption/upload. Activate this selection only
with migrations through `0010` applied and the backup role able to read every
selected table. Encryption, object naming and retention are unchanged.

This is **not a complete database backup**. The separate identity snapshots cover
only selected podcast/episode identity columns and run independently; they are not
a transactionally coherent companion to the daily dump. Catalogue/reference
parents and episode content are not included in the selected-table archive.

Rehearse recovery in an isolated database with the matching schema and coherent
parent identities, including ownership. Restore users before their dependents,
podcasts/episodes before memberships, countries/podcasts before chart history,
and lists before list items. When loading data into an existing schema, review a
parent-first `pg_restore --use-list` order: a full archive's default data-only
order need not satisfy existing foreign keys. Do not disable constraints or
invent missing production identities to make a restore pass.

Restore resource rows, revision heads, generation and client deduplication records
from the same snapshot. Omitting retry state can reapply acknowledged progress,
resurrect removed follows/stars or change latest playback. The schema seeds a
generation row; remove that disposable bootstrap row before restoring the captured
one, under a reviewed restore procedure with no writers admitted.

Before restored traffic opens, rotate only the current generation, keeping
`legacy_generation` unchanged, and enforce the separately required post-checkpoint
erasure/revocation obligations. Old clients must remain blocked for explicit
reconciliation; never renumber streams or upload cached libraries. A client can be
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
They require every public table to be selected or explicitly excluded with a
reason, verify archive table coverage and exact row restoration, exercise restored
retry deduplication for lists/progress/follows, fence clients ahead of a restored
checkpoint, and reject each missing selected table. New migrations must
update this coverage decision. These synthetic tests do not prove production
backup recovery, encryption-key availability or recovery time objectives.
