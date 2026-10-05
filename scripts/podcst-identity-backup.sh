#!/usr/bin/env bash
set -euo pipefail

source "$(dirname -- "${BASH_SOURCE[0]}")/lib/backup.sh"

: "${BACKUP_MIN_PODCASTS:?Set BACKUP_MIN_PODCASTS to the minimum expected rows}"
: "${BACKUP_MIN_EPISODES:?Set BACKUP_MIN_EPISODES to the minimum expected rows}"
[[ $BACKUP_MIN_PODCASTS =~ ^[1-9][0-9]*$ && $BACKUP_MIN_EPISODES =~ ^[1-9][0-9]*$ ]] || {
  echo "ERROR: backup row thresholds must be positive integers" >&2
  exit 1
}
RETAIN_DAYS=90
TS=$(date -u +%Y-%m-%dT%H%M%SZ)
RETAIN_UNTIL=$(date -u -d "+${RETAIN_DAYS} days" +%Y-%m-%dT%H:%M:%SZ)

TMP=$(mktemp -d -p /dev/shm)
trap 'rm -rf "$TMP"' EXIT

snapshot() {
  local name="$1" query="$2" mincount="$3"
  local file="$TMP/${name}.csv.zst"
  psql "$BACKUP_DATABASE_URL" -At -c "\copy ($query) TO STDOUT WITH CSV" | zstd -q -o "$file"
  local rows
  rows=$(zstd -dc "$file" | wc -l)
  [ "$rows" -ge "$mincount" ] || { echo "ERROR: ${name} produced ${rows} rows (< ${mincount})" >&2; exit 1; }
  age -r "$BACKUP_RECIPIENT" -o "${file}.age" "$file"
  local key="podcst-identity-${name}-${TS}.csv.zst.age"
  aws s3api put-object --bucket "$BACKUP_BUCKET" --key "$key" --body "${file}.age" \
    --object-lock-mode GOVERNANCE --object-lock-retain-until-date "$RETAIN_UNTIL" >/dev/null
  echo "OK ${name} rows=${rows} encrypted=$(stat -c%s "${file}.age")B s3://${BACKUP_BUCKET}/${key}"
}

snapshot podcasts "SELECT id, feed_url, itunes_id, podcast_index_id, owner_user_id FROM podcasts" "$BACKUP_MIN_PODCASTS"
snapshot episodes "SELECT id, podcast_id, guid FROM episodes" "$BACKUP_MIN_EPISODES"
echo "identity snapshot complete retain_until=${RETAIN_UNTIL} (${RETAIN_DAYS}d)"
