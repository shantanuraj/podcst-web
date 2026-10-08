import { createHash, randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { adaptFeed } from '../../app/api/feed/parser';
import type { IEpisodeListing } from '../../types';
import { FOLLOWED_IDS_SQL } from '../tiering';
import { sanitize, upsertEpisodes } from './episodes';
import { fetchFeedResponse } from './feed-http';
import {
  getPollInterval,
  getRetryInterval,
  isRefreshDue,
  MAX_POLL_FAILURES,
  type PollState,
  type RefreshMode,
} from './feed-schedule';
import { resolvePublicFeedMove } from './public-feed-moves';

interface FeedMeta {
  etag: string | null;
  lastModified: string | null;
  hash: string | null;
}

type FeedFetchResult = FeedMeta & { publicRedirect?: true } & (
    | { status: 'updated'; data: IEpisodeListing }
    | { status: 'not_modified' }
  );

export type RefreshResult =
  | 'updated'
  | 'not_modified'
  | 'skipped'
  | 'busy'
  | 'not_found'
  | 'error';

interface PodcastForRefresh extends PollState {
  feed_url: string;
  owner_user_id: string | null;
  update_frequency: number | null;
  is_active: boolean;
  etag: string | null;
  last_modified: string | null;
  hash: string | null;
  refresh_token: string | null;
  refreshing: boolean;
}

const REFRESH_LEASE_SECONDS = 60;

export async function fetchFeed(
  feedUrl: string,
  previous?: FeedMeta,
  privateFeed = false,
  signal?: AbortSignal,
): Promise<FeedFetchResult> {
  const res = await fetchFeedResponse(feedUrl, previous, { signal });

  const movement =
    res.redirected && !privateFeed ? { publicRedirect: true as const } : {};
  if (res.status === 304 && previous) {
    return {
      ...movement,
      status: 'not_modified',
      etag: res.etag ?? previous.etag,
      lastModified: res.lastModified ?? previous.lastModified,
      hash: previous.hash,
    };
  }
  if (res.status !== 200) throw new Error(`Feed returned HTTP ${res.status}`);

  const body = res.body;
  const meta: FeedMeta = {
    etag: res.etag,
    lastModified: res.lastModified,
    hash: createHash('sha256').update(body).digest('hex'),
  };
  if (previous?.hash && previous.hash === meta.hash) {
    return { status: 'not_modified', ...meta, ...movement };
  }

  const data = await adaptFeed(body, !privateFeed);
  if (!data) throw new Error('Invalid feed');
  return { status: 'updated', data, ...meta, ...movement };
}

export async function savePollState(
  sql: postgres.ISql,
  podcastId: string,
  meta: FeedMeta,
  intervalSeconds: number,
): Promise<void> {
  await sql`
    INSERT INTO feed_poll_state (
      podcast_id, etag, last_modified, hash,
      last_polled_at, next_poll_at, failures
    ) VALUES (
      ${podcastId}, ${meta.etag}, ${meta.lastModified}, ${meta.hash},
      now(), now() + interval '1 second' * ${intervalSeconds}, 0
    )
    ON CONFLICT (podcast_id) DO UPDATE SET
      etag = EXCLUDED.etag,
      last_modified = EXCLUDED.last_modified,
      hash = EXCLUDED.hash,
      last_polled_at = EXCLUDED.last_polled_at,
      next_poll_at = EXCLUDED.next_poll_at,
      failures = 0
  `;
}

async function lockRefresh(tx: postgres.TransactionSql, podcastId: string) {
  const [lock] = await tx`
    SELECT pg_try_advisory_xact_lock(${podcastId}::bigint) AS acquired
  `;
  return lock.acquired as boolean;
}

async function readRefresh(tx: postgres.TransactionSql, podcastId: string) {
  const [source] =
    await tx`SELECT id FROM podcasts WHERE id = ${podcastId} FOR UPDATE`;
  if (!source) return undefined;
  const [podcast] = await tx<PodcastForRefresh[]>`
    SELECT p.feed_url, p.owner_user_id, p.update_frequency, p.is_active,
           p.id IN (${tx.unsafe(FOLLOWED_IDS_SQL)}) AS is_followed,
           s.etag, s.last_modified, s.hash, s.last_polled_at, s.next_poll_at,
           coalesce(s.failures, 0) AS failures, s.refresh_token,
           coalesce(s.refresh_expires_at > clock_timestamp(), false) AS refreshing
    FROM podcasts p
    LEFT JOIN feed_poll_state s ON s.podcast_id = p.id
    WHERE p.id = ${podcastId}
  `;
  return podcast;
}

async function releaseRefresh(
  tx: postgres.TransactionSql,
  podcastId: string,
  token: string,
) {
  await tx`
    UPDATE feed_poll_state SET refresh_token = NULL, refresh_expires_at = NULL
    WHERE podcast_id = ${podcastId} AND refresh_token = ${token}
  `;
}

type RefreshClaim =
  | { status: 'claimed'; token: string; podcast: PodcastForRefresh }
  | { status: 'busy' | 'skipped' | 'not_found' };

export async function refreshFeed(
  sql: postgres.Sql,
  podcastId: string,
  mode: RefreshMode = 'stale',
  resolveMove = resolvePublicFeedMove,
): Promise<RefreshResult> {
  const claim = await sql.begin(async (tx): Promise<RefreshClaim> => {
    if (!(await lockRefresh(tx, podcastId))) return { status: 'busy' };
    const podcast = await readRefresh(tx, podcastId);
    if (!podcast) return { status: 'not_found' };
    if (podcast.refreshing) return { status: 'busy' };
    if (
      (mode === 'scheduled' && !podcast.is_active) ||
      !isRefreshDue(podcast, mode)
    )
      return { status: 'skipped' };
    const token = randomUUID();
    await tx`
      INSERT INTO feed_poll_state (podcast_id, refresh_token, refresh_expires_at)
      VALUES (${podcastId}, ${token}, clock_timestamp() + interval '1 second' * ${REFRESH_LEASE_SECONDS})
      ON CONFLICT (podcast_id) DO UPDATE SET
        refresh_token = EXCLUDED.refresh_token,
        refresh_expires_at = EXCLUDED.refresh_expires_at
    `;
    return { status: 'claimed', token, podcast };
  });
  if (claim.status !== 'claimed') return claim.status;

  let result: FeedFetchResult | undefined;
  try {
    result = await fetchFeed(
      claim.podcast.feed_url,
      mode === 'rebuild'
        ? undefined
        : {
            etag: claim.podcast.etag,
            lastModified: claim.podcast.last_modified,
            hash: claim.podcast.hash,
          },
      claim.podcast.owner_user_id !== null,
    );
  } catch {}

  const outcome = await sql.begin(async (tx): Promise<RefreshResult> => {
    if (!(await lockRefresh(tx, podcastId))) return 'busy';
    const podcast = await readRefresh(tx, podcastId);
    if (!podcast) return 'not_found';
    if (podcast.refresh_token !== claim.token) return 'skipped';
    if (
      !podcast.refreshing ||
      podcast.feed_url !== claim.podcast.feed_url ||
      podcast.owner_user_id !== claim.podcast.owner_user_id
    ) {
      await releaseRefresh(tx, podcastId, claim.token);
      return 'skipped';
    }
    try {
      if (!result) throw new Error('Feed fetch failed');
      const fetched = result;
      return await tx.savepoint(async (write): Promise<RefreshResult> => {
        if (fetched.status === 'updated') {
          const feed = fetched.data;
          const cover = sanitize(feed.cover) || podcast.feed_url;
          await write`
            UPDATE podcasts SET
              title = ${sanitize(feed.title) ?? ''},
              description = ${sanitize(feed.description)},
              cover = ${cover},
              website_url = ${sanitize(feed.link)},
              explicit = ${feed.explicit},
              last_published = ${feed.published ? new Date(feed.published) : null},
              episode_count = ${feed.episodes.length},
              is_active = true,
              updated_at = now()
            WHERE id = ${podcastId}
          `;
          await upsertEpisodes(write, podcastId, cover, feed.episodes);
        } else if (!podcast.is_active) {
          await write`UPDATE podcasts SET is_active = true WHERE id = ${podcastId}`;
        }
        await savePollState(
          write,
          podcastId,
          fetched,
          getPollInterval(podcast.update_frequency, podcast.is_followed),
        );
        return fetched.status;
      });
    } catch {
      const failures = podcast.failures + 1;
      await tx`
        UPDATE feed_poll_state SET
          last_polled_at = now(),
          next_poll_at = now() + interval '1 second' * ${getRetryInterval(failures)},
          failures = ${failures}
        WHERE podcast_id = ${podcastId}
      `;
      if (failures >= MAX_POLL_FAILURES)
        await tx`UPDATE podcasts SET is_active = false WHERE id = ${podcastId}`;
      console.warn(
        `Failed to refresh podcast ${podcastId} (attempt ${failures})`,
      );
      return 'error';
    } finally {
      await releaseRefresh(tx, podcastId, claim.token);
    }
  });
  if (
    result?.publicRedirect &&
    (outcome === 'updated' || outcome === 'not_modified')
  ) {
    try {
      const move = await resolveMove(sql, podcastId);
      if (
        move.status === 'identity_conflict' ||
        move.status === 'verification_pending'
      )
        console.warn(
          `Public feed move requires review for podcast ${podcastId}: ${move.status}`,
        );
    } catch {
      console.warn(
        `Public feed move verification failed for podcast ${podcastId}`,
      );
    }
  }
  return outcome;
}
