#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=/home/shantanu/src/shantanuraj/podcst-web/.env.local
RECIPIENT=age1tnn4pdkahghl3ldkj8hjp2rnlszv9r0ckzr6wxq6exn80d7x8usq5pv0p0
BUCKET=podcst-user-data-backups
PROFILE=sixth-backup
PGDUMP=/usr/bin/pg_dump
AGE=/usr/bin/age
AWS=/usr/local/bin/aws

DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"')

TS=$(date -u +%Y-%m-%dT%H%M%SZ)
KEY="podcst-userdata-${TS}.dump.age"

RETAIN_DAYS=35
[ "$(date -u +%d)" = "01" ] && RETAIN_DAYS=365
RETAIN_UNTIL=$(date -u -d "+${RETAIN_DAYS} days" +%Y-%m-%dT%H:%M:%SZ)

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
DUMP="$TMP/dump"

"$PGDUMP" "$DATABASE_URL" -Fc --no-owner --no-privileges \
  -t public.users -t public.subscriptions -t public.playback_progress \
  -t public.passkeys -t public.sessions -t public.email_verifications \
  -t public.transcripts > "$DUMP"
[ -s "$DUMP" ] || { echo "ERROR: empty pg_dump output" >&2; exit 1; }

"$AGE" -r "$RECIPIENT" -o "$DUMP.age" "$DUMP"
[ -s "$DUMP.age" ] || { echo "ERROR: empty encrypted output" >&2; exit 1; }

"$AWS" s3api put-object \
  --bucket "$BUCKET" --key "$KEY" --body "$DUMP.age" \
  --object-lock-mode GOVERNANCE --object-lock-retain-until-date "$RETAIN_UNTIL" \
  --profile "$PROFILE" >/dev/null

echo "OK uploaded s3://${BUCKET}/${KEY} plaintext=$(stat -c%s "$DUMP")B encrypted=$(stat -c%s "$DUMP.age")B retain_until=${RETAIN_UNTIL} (${RETAIN_DAYS}d)"
