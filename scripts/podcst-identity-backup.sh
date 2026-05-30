#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=/opt/podcst/.env.local
RECIPIENT="${BACKUP_RECIPIENT:?Set BACKUP_RECIPIENT}"
BUCKET="${BACKUP_BUCKET:?Set BACKUP_BUCKET}"
PROFILE="${AWS_PROFILE:?Set AWS_PROFILE}"
PSQL=/usr/bin/psql
ZSTD=/usr/bin/zstd
AGE=/usr/bin/age
AWS=/usr/local/bin/aws
RETAIN_DAYS=90

DATABASE_URL="${BACKUP_DATABASE_URL:?Set BACKUP_DATABASE_URL}"
TS=$(date -u +%Y-%m-%dT%H%M%SZ)
RETAIN_UNTIL=$(date -u -d "+${RETAIN_DAYS} days" +%Y-%m-%dT%H:%M:%SZ)

TMP=$(mktemp -d -p /dev/shm)
trap 'rm -rf "$TMP"' EXIT

snapshot() {
  local name="$1" query="$2" mincount="$3"
  local file="$TMP/${name}.csv.zst"
  "$PSQL" "$DATABASE_URL" -At -c "\copy ($query) TO STDOUT WITH CSV" | "$ZSTD" -q -o "$file"
  local rows
  rows=$("$ZSTD" -dc "$file" | wc -l)
  [ "$rows" -ge "$mincount" ] || { echo "ERROR: ${name} produced ${rows} rows (< ${mincount})" >&2; exit 1; }
  "$AGE" -r "$RECIPIENT" -o "${file}.age" "$file"
  local key="podcst-identity-${name}-${TS}.csv.zst.age"
  "$AWS" s3api put-object --bucket "$BUCKET" --key "$key" --body "${file}.age" \
    --object-lock-mode GOVERNANCE --object-lock-retain-until-date "$RETAIN_UNTIL" \
    --profile "$PROFILE" >/dev/null
  echo "OK ${name} rows=${rows} encrypted=$(stat -c%s "${file}.age")B s3://${BUCKET}/${key}"
}

snapshot podcasts "SELECT id, feed_url, itunes_id, podcast_index_id FROM podcasts" "${BACKUP_MIN_PODCASTS:?Set BACKUP_MIN_PODCASTS}"
snapshot episodes "SELECT id, podcast_id, guid FROM episodes" "${BACKUP_MIN_EPISODES:?Set BACKUP_MIN_EPISODES}"
echo "identity snapshot complete retain_until=${RETAIN_UNTIL} (${RETAIN_DAYS}d)"
