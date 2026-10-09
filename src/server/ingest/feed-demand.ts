import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { FEED_LIMITS, type FeedFreshness } from '@/shared/feed-contract';
import { podcastAccess } from '../podcast-access';

const limits = FEED_LIMITS.refresh;

export class FeedAdmissionError extends Error {
  constructor(
    public readonly code: 'rate_limited' | 'unavailable',
    public readonly retryAfterSeconds = FEED_LIMITS.client.recheckSeconds,
  ) {
    super('Feed work unavailable');
  }
}

export interface FeedReadState {
  last_success_at: Date | null;
  last_rebuilt_at: Date | null;
  next_poll_at: Date | null;
  failures: number;
  refresh_expires_at: Date | null;
  demand_token: string | null;
  demand_expires_at: Date | null;
  demand_rebuild: boolean;
  has_content: boolean;
  empty_feed: boolean;
  observed_at: Date;
}

export async function readFeedState(
  sql: postgres.ISql,
  podcastId: string,
  userId: string | null,
  episodeId?: string,
): Promise<FeedReadState | null> {
  const [row] = await sql<FeedReadState[]>`
    SELECT s.last_success_at, s.last_rebuilt_at, s.next_poll_at,
           coalesce(s.failures, 0) AS failures, s.refresh_expires_at,
           s.demand_token, s.demand_expires_at,
           coalesce(s.demand_rebuild, false) AS demand_rebuild,
           EXISTS (
             SELECT 1 FROM episodes e JOIN episode_content c ON c.episode_id = e.id
             WHERE e.podcast_id = p.id ${episodeId ? sql`AND e.id = ${episodeId}` : sql``}
           ) AS has_content,
           ${episodeId === undefined} AND p.episode_count = 0 AND s.last_success_at IS NOT NULL AS empty_feed,
           clock_timestamp() AS observed_at
    FROM podcasts p LEFT JOIN feed_poll_state s ON s.podcast_id = p.id
    WHERE p.id = ${podcastId} AND ${podcastAccess(sql, userId)}
      ${episodeId ? sql`AND EXISTS (SELECT 1 FROM episodes e WHERE e.id = ${episodeId} AND e.podcast_id = p.id)` : sql``}
  `;
  return row ?? null;
}

export function feedFreshness(row: FeedReadState): FeedFreshness {
  const now = row.observed_at.getTime();
  const content = row.has_content || row.empty_feed ? 'cached' : 'missing';
  const checkedAtMs = row.last_success_at?.getTime() ?? null;
  const retry = row.next_poll_at?.getTime() ?? 0;
  let state: FeedFreshness['state'];
  let retryAtMs: number | null = null;
  if (row.failures > 0 && retry > now) {
    state = 'backoff';
    retryAtMs = retry;
  } else if (
    (row.refresh_expires_at?.getTime() ?? 0) > now ||
    (row.demand_expires_at?.getTime() ?? 0) > now
  ) {
    state = 'pending';
    retryAtMs = now + FEED_LIMITS.client.recheckSeconds * 1000;
  } else if (
    content === 'cached' &&
    checkedAtMs !== null &&
    checkedAtMs + limits.freshSeconds * 1000 > now
  ) {
    state = 'fresh';
  } else if (
    content === 'missing' &&
    (row.last_rebuilt_at?.getTime() ?? 0) +
      limits.rebuildCooldownSeconds * 1000 >
      now
  ) {
    state = 'unavailable';
  } else state = 'stale';
  return { content, state, checkedAtMs, retryAtMs };
}

export async function requestFeedRefresh(
  sql: postgres.Sql,
  podcastId: string,
  userId: string | null,
  admit: () => Promise<void>,
  episodeId?: string,
): Promise<FeedFreshness | null> {
  const needsDemand = (row: FeedReadState) => {
    const freshness = feedFreshness(row);
    if (['fresh', 'backoff', 'unavailable'].includes(freshness.state))
      return false;
    if (freshness.state !== 'pending') return true;
    return (
      freshness.content === 'missing' &&
      !(
        row.demand_rebuild &&
        (row.demand_expires_at?.getTime() ?? 0) > row.observed_at.getTime()
      )
    );
  };
  const before = await readFeedState(sql, podcastId, userId, episodeId);
  if (!before) return null;
  if (!needsDemand(before)) return feedFreshness(before);
  await admit();
  return sql.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '1s'`;
    await tx`SET LOCAL statement_timeout = '5s'`;
    const [source] = await tx`
      SELECT p.id FROM podcasts p
      WHERE p.id = ${podcastId} AND ${podcastAccess(tx, userId)} FOR UPDATE
    `;
    if (!source) return null;
    const row = await readFeedState(tx, podcastId, userId, episodeId);
    if (!row) return null;
    if (!needsDemand(row)) return feedFreshness(row);
    await tx`SELECT pg_advisory_xact_lock(hashtext('feed-demand'), 0)`;
    const [{ count }] = await tx`
      SELECT count(*)::int AS count FROM feed_poll_state
      WHERE demand_token IS NOT NULL AND demand_expires_at > clock_timestamp()
        AND podcast_id <> ${podcastId}
    `;
    if (count >= limits.queueCapacity)
      throw new FeedAdmissionError('rate_limited');
    const rebuild = !row.has_content && !row.empty_feed;
    await tx`
      INSERT INTO feed_poll_state (podcast_id, demand_token, demand_requested_at, demand_expires_at, demand_rebuild)
      VALUES (${podcastId}, ${randomUUID()}, clock_timestamp(), clock_timestamp() + interval '1 second' * ${limits.demandSeconds}, ${rebuild})
      ON CONFLICT (podcast_id) DO UPDATE SET
        demand_token = EXCLUDED.demand_token,
        demand_requested_at = EXCLUDED.demand_requested_at,
        demand_expires_at = EXCLUDED.demand_expires_at,
        demand_rebuild = EXCLUDED.demand_rebuild
    `;
    const saved = await readFeedState(tx, podcastId, userId, episodeId);
    return saved ? feedFreshness(saved) : null;
  });
}
