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

The selected-table backup is not a complete database backup. Identity snapshots
also omit episode content. Rehearse restoration with the matching schema and all
required parent records before relying on either. Keep credentials, dumps and
recovery records outside the repository.
