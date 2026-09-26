import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { adaptFeed } from '../../app/api/feed/parser';
import type { IEpisodeListing } from '../../types';
import { FOLLOWED_IDS_SQL } from '../tiering';
import { sanitize, upsertEpisodes } from './episodes';
import {
  getPollInterval,
  getRetryInterval,
  isRefreshDue,
  MAX_POLL_FAILURES,
  type PollState,
  type RefreshMode,
} from './feed-schedule';

interface FeedMeta {
  etag: string | null;
  lastModified: string | null;
  hash: string | null;
}

type FeedFetchResult = FeedMeta &
  ({ status: 'updated'; data: IEpisodeListing } | { status: 'not_modified' });

export type RefreshResult =
  | 'updated'
  | 'not_modified'
  | 'skipped'
  | 'busy'
  | 'not_found'
  | 'error';

interface PodcastForRefresh extends PollState {
  feed_url: string;
  update_frequency: number | null;
  is_active: boolean;
  etag: string | null;
  last_modified: string | null;
  hash: string | null;
}

export async function fetchFeed(
  feedUrl: string,
  previous?: FeedMeta,
): Promise<FeedFetchResult> {
  if (!/^https?:\/\//i.test(feedUrl)) throw new Error('Invalid feed protocol');

  const headers: Record<string, string> = { 'User-Agent': 'Podcst/1.0' };
  if (previous?.etag) headers['If-None-Match'] = previous.etag;
  if (previous?.lastModified) {
    headers['If-Modified-Since'] = previous.lastModified;
  }

  const res = await fetch(feedUrl, {
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });

  if (res.status === 304 && previous) {
    return {
      status: 'not_modified',
      etag: res.headers.get('etag') ?? previous.etag,
      lastModified: res.headers.get('last-modified') ?? previous.lastModified,
      hash: previous.hash,
    };
  }
  if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}`);

  const body = await res.text();
  const meta: FeedMeta = {
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
    hash: createHash('sha256').update(body).digest('hex'),
  };
  if (previous?.hash && previous.hash === meta.hash) {
    return { status: 'not_modified', ...meta };
  }

  const data = await adaptFeed(body);
  if (!data) throw new Error('Invalid feed');
  return { status: 'updated', data, ...meta };
}

export async function savePollState(
  sql: postgres.Sql,
  podcastId: number,
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

export async function refreshFeed(
  sql: postgres.Sql,
  podcastId: number,
  mode: RefreshMode = 'stale',
): Promise<RefreshResult> {
  return sql.begin(async (tx): Promise<RefreshResult> => {
    const [lock] = await tx`
      SELECT pg_try_advisory_xact_lock(${podcastId}::bigint) AS acquired
    `;
    if (!lock.acquired) return 'busy';

    const [podcast] = await tx<PodcastForRefresh[]>`
      SELECT p.feed_url, p.update_frequency, p.is_active,
             p.id IN (${tx.unsafe(FOLLOWED_IDS_SQL)}) AS is_followed,
             s.etag, s.last_modified, s.hash, s.last_polled_at, s.next_poll_at,
             coalesce(s.failures, 0) AS failures
      FROM podcasts p
      LEFT JOIN feed_poll_state s ON s.podcast_id = p.id
      WHERE p.id = ${podcastId}
    `;
    if (!podcast) return 'not_found';
    if (
      (mode === 'scheduled' && !podcast.is_active) ||
      !isRefreshDue(podcast, mode)
    ) {
      return 'skipped';
    }

    try {
      return await tx.savepoint(async (write): Promise<RefreshResult> => {
        const result = await fetchFeed(
          podcast.feed_url,
          mode === 'rebuild'
            ? undefined
            : {
                etag: podcast.etag,
                lastModified: podcast.last_modified,
                hash: podcast.hash,
              },
        );

        if (result.status === 'updated') {
          const feed = result.data;
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
          result,
          getPollInterval(podcast.update_frequency, podcast.is_followed),
        );
        return result.status;
      });
    } catch {
      const failures = podcast.failures + 1;
      await tx`
        INSERT INTO feed_poll_state (
          podcast_id, last_polled_at, next_poll_at, failures
        ) VALUES (
          ${podcastId}, now(),
          now() + interval '1 second' * ${getRetryInterval(failures)}, ${failures}
        )
        ON CONFLICT (podcast_id) DO UPDATE SET
          last_polled_at = EXCLUDED.last_polled_at,
          next_poll_at = EXCLUDED.next_poll_at,
          failures = EXCLUDED.failures
      `;
      if (failures >= MAX_POLL_FAILURES) {
        await tx`UPDATE podcasts SET is_active = false WHERE id = ${podcastId}`;
      }
      console.warn(
        `Failed to refresh podcast ${podcastId} (attempt ${failures})`,
      );
      return 'error';
    }
  });
}
