umask 077

: "${BACKUP_RECIPIENT:?Set BACKUP_RECIPIENT to an age recipient}"
: "${BACKUP_BUCKET:?Set BACKUP_BUCKET to an S3 bucket with Object Lock}"
: "${BACKUP_DATABASE_URL:?Set BACKUP_DATABASE_URL to the database to back up}"
