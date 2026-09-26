import type postgres from 'postgres';
import { FOLLOWED_IDS_SQL } from '../tiering';

export const HOURLY_POLL_INTERVAL = 3600;
export const STALE_FEED_INTERVAL = 15 * 60;
export const MAX_POLL_FAILURES = 5;
const DEFAULT_POLL_INTERVAL = 24 * HOURLY_POLL_INTERVAL;

export type RefreshMode = 'scheduled' | 'stale' | 'rebuild';

export interface PollState {
  last_polled_at: Date | null;
  next_poll_at: Date | null;
  failures: number;
  is_followed: boolean;
}

export function getPollInterval(
  updateFrequency: number | null,
  isFollowed = false,
): number {
  if (isFollowed) return HOURLY_POLL_INTERVAL;
  return Math.max(
    updateFrequency && Number.isFinite(updateFrequency)
      ? updateFrequency
      : DEFAULT_POLL_INTERVAL,
    HOURLY_POLL_INTERVAL,
  );
}

export function getRetryInterval(failures: number): number {
  return Math.min(
    HOURLY_POLL_INTERVAL * 2 ** failures,
    7 * DEFAULT_POLL_INTERVAL,
  );
}

export function isRefreshDue(
  state: PollState,
  mode: RefreshMode,
  now = Date.now(),
): boolean {
  const nextPoll = state.next_poll_at?.getTime() ?? 0;
  if (state.failures > 0 && nextPoll > now) return false;
  if (mode === 'rebuild') return true;
  if (!state.last_polled_at) return true;

  const age = now - state.last_polled_at.getTime();
  if (mode === 'stale') return age >= STALE_FEED_INTERVAL * 1000;

  return (
    nextPoll <= now ||
    (state.failures === 0 &&
      state.is_followed &&
      age >= HOURLY_POLL_INTERVAL * 1000)
  );
}

export async function getDuePodcasts(sql: postgres.Sql, limit: number) {
  const rows = await sql<{ id: string | number }[]>`
    WITH followed AS (${sql.unsafe(FOLLOWED_IDS_SQL)}),
    candidates AS (
      SELECT id FROM podcasts WHERE is_essential = true
      UNION
      SELECT id FROM followed
    )
    SELECT p.id
    FROM candidates c
    JOIN podcasts p ON p.id = c.id
    LEFT JOIN feed_poll_state s ON s.podcast_id = p.id
    WHERE p.is_active = true
      AND (
        s.next_poll_at IS NULL OR s.next_poll_at <= now()
        OR (
          s.failures = 0
          AND s.last_polled_at <= now() - interval '1 second' * ${HOURLY_POLL_INTERVAL}
          AND p.id IN (SELECT id FROM followed)
        )
      )
      AND (
        p.id IN (SELECT id FROM followed)
        OR p.last_published IS NULL
        OR p.last_published > now() - interval '180 days'
      )
    ORDER BY
      p.priority DESC NULLS LAST,
      p.popularity_score DESC NULLS LAST,
      CASE WHEN s.next_poll_at IS NULL THEN 0 ELSE 1 END,
      s.last_polled_at ASC NULLS FIRST
    LIMIT ${limit}
  `;
  return rows.map(({ id }) => ({ id: Number(id) }));
}
