#!/usr/bin/env bash
set -euo pipefail

source "$(dirname -- "${BASH_SOURCE[0]}")/lib/backup.sh"

TS=$(date -u +%Y-%m-%dT%H%M%SZ)
KEY="podcst-userdata-${TS}.dump.age"

RETAIN_DAYS=35
[ "$(date -u +%d)" = "01" ] && RETAIN_DAYS=365
RETAIN_UNTIL=$(date -u -d "+${RETAIN_DAYS} days" +%Y-%m-%dT%H:%M:%SZ)

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
DUMP="$TMP/dump"

pg_dump "$BACKUP_DATABASE_URL" -Fc --strict-names --no-owner --no-privileges \
  -t public.state_generation -t public.users \
  -t public.progress_revision_heads -t public.follow_revision_heads \
  -t public.progress_clients -t public.follow_clients \
  -t public.subscriptions -t public.playback_progress \
  -t public.passkeys -t public.sessions -t public.email_verifications \
  -t public.transcripts -t public.podcast_feed_aliases \
  -t public.podcast_apple_aliases -t public.account_preferences \
  -t public.episode_lists -t public.episode_list_items \
  -t public.episode_list_clients -t public.chart_history > "$DUMP"
[ -s "$DUMP" ] || { echo "ERROR: empty pg_dump output" >&2; exit 1; }

age -r "$BACKUP_RECIPIENT" -o "$DUMP.age" "$DUMP"
[ -s "$DUMP.age" ] || { echo "ERROR: empty encrypted output" >&2; exit 1; }

aws s3api put-object \
  --bucket "$BACKUP_BUCKET" --key "$KEY" --body "$DUMP.age" \
  --object-lock-mode GOVERNANCE --object-lock-retain-until-date "$RETAIN_UNTIL" >/dev/null

echo "OK uploaded s3://${BACKUP_BUCKET}/${KEY} plaintext=$(stat -c%s "$DUMP")B encrypted=$(stat -c%s "$DUMP.age")B retain_until=${RETAIN_UNTIL} (${RETAIN_DAYS}d)"
