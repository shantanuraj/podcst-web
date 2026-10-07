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

All selected tables share one `pg_dump` snapshot. `--strict-names` refuses missing
tables; a dump failure prevents encryption/upload. Activate this selection only
with migrations through `0008` applied and the backup role able to read every
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

Restore client deduplication rows together with list state from the same snapshot;
omitting them can replay acknowledged requests and resurrect removed stars.
Account for newer writes before any real recovery. Keep credentials, dumps and
recovery records outside the repository.

## Backup tests

```sh
bun --no-env-file test scripts/backup-config.test.ts scripts/podcst-backup.test.ts
PG_BIN=/path/to/postgresql-16/bin bun --no-env-file test scripts/backup-config.test.ts scripts/podcst-backup.test.ts
```

With `PG_BIN`, tests create disposable local clusters using all active migrations.
They require every public table to be selected or explicitly excluded with a
reason, verify archive table coverage and exact row restoration, exercise restored
retry deduplication, and reject each missing selected table. New migrations must
update this coverage decision. These synthetic tests do not prove production
backup recovery, encryption-key availability or recovery time objectives.
