#!/usr/bin/env bun

import postgres from 'postgres';
import { createHash } from 'crypto';
import { adaptFeed } from '../src/app/api/feed/parser';
import type { IEpisodeListing } from '../src/types';

const BATCH_SIZE = 500;
const DEFAULT_UPDATE_FREQUENCY = 86400;
const MAX_FAILURES = 5;
const BACKOFF_BASE = 3600;
const STALE_THRESHOLD_DAYS = 180;

interface PodcastRow {
  id: number;
  feed_url: string;
  title: string;
  update_frequency: number | null;
  poll_failures: number;
  feed_etag: string | null;
  feed_last_modified: string | null;
  feed_hash: string | null;
}

interface FetchResult {
  status: 'ok' | 'not_modified' | 'error';
  body?: string;
  etag?: string;
  lastModified?: string;
  hash?: string;
}

async function fetchFeed(url: string, podcast: PodcastRow): Promise<FetchResult> {
  try {
    const headers: Record<string, string> = { 'User-Agent': 'Podcst/1.0' };
    if (podcast.feed_etag) {
      headers['If-None-Match'] = podcast.feed_etag;
    }
    if (podcast.feed_last_modified) {
      headers['If-Modified-Since'] = podcast.feed_last_modified;
    }

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30000),
    });

    if (res.status === 304) {
      return { status: 'not_modified' };
    }

    if (!res.ok) {
      return { status: 'error' };
    }

    const body = await res.text();
    const hash = createHash('sha256').update(body).digest('hex');

    if (podcast.feed_hash && podcast.feed_hash === hash) {
      return { status: 'not_modified', hash };
    }

    return {
      status: 'ok',
      body,
      etag: res.headers.get('etag') || undefined,
      lastModified: res.headers.get('last-modified') || undefined,
      hash,
    };
  } catch {
    return { status: 'error' };
  }
}

type PollResult = 'updated' | 'not_modified' | 'error';

async function pollPodcast(sql: postgres.Sql, podcast: PodcastRow): Promise<PollResult> {
  const result = await fetchFeed(podcast.feed_url, podcast);

  if (result.status === 'error') {
    return 'error';
  }

  if (result.status === 'not_modified') {
    await sql`
      UPDATE podcasts SET
        last_polled_at = now(),
        next_poll_at = now() + interval '1 second' * ${podcast.update_frequency || DEFAULT_UPDATE_FREQUENCY},
        poll_failures = 0
      WHERE id = ${podcast.id}
    `;
    return 'not_modified';
  }

  const feed = await adaptFeed(result.body!);
  if (!feed) {
    return 'error';
  }

  const lastPublished = feed.published ? new Date(feed.published) : null;

  await sql`
    UPDATE podcasts SET
      title = ${feed.title},
      description = ${feed.description || null}::TEXT,
      cover = ${feed.cover || podcast.feed_url},
      website_url = ${feed.link || null}::TEXT,
      explicit = ${feed.explicit},
      last_published = ${lastPublished}::TIMESTAMPTZ,
      episode_count = ${feed.episodes.length},
      feed_etag = ${result.etag || null}::TEXT,
      feed_last_modified = ${result.lastModified || null}::TEXT,
      feed_hash = ${result.hash || null}::TEXT,
      updated_at = now()
    WHERE id = ${podcast.id}
  `;

  for (const ep of feed.episodes) {
    if (!ep.guid) continue;

    const published = ep.published ? new Date(ep.published) : new Date();
    const duration = ep.duration ? Math.floor(ep.duration) : null;

    await sql`
      INSERT INTO episodes (
        podcast_id, guid, title, summary, published, duration,
        episode_art, file_url, file_length, file_type
      ) VALUES (
        ${podcast.id},
        ${ep.guid},
        ${ep.title},
        ${ep.summary || null}::TEXT,
        ${published},
        ${duration}::INTEGER,
        ${ep.episodeArt || null}::TEXT,
        ${ep.file.url},
        ${ep.file.length},
        ${ep.file.type}
      )
      ON CONFLICT (podcast_id, guid) DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        duration = EXCLUDED.duration,
        episode_art = EXCLUDED.episode_art,
        file_url = EXCLUDED.file_url
    `;
  }

  return 'updated';
}

async function recordMetrics(
  sql: postgres.Sql,
  metrics: Record<string, number>,
) {
  for (const [name, value] of Object.entries(metrics)) {
    if (value > 0) {
      await sql`
        INSERT INTO poll_metrics (metric_name, metric_value)
        VALUES (${name}, ${value})
      `;
    }
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL required');
  }

  const sql = postgres(connectionString, { max: 5, idle_timeout: 20 });

  const podcasts = await sql<PodcastRow[]>`
    SELECT id, feed_url, title, update_frequency, poll_failures,
           feed_etag, feed_last_modified, feed_hash
    FROM podcasts
    WHERE is_active = true
      AND (next_poll_at <= now() OR next_poll_at IS NULL)
      AND (
        last_published IS NULL
        OR last_published > now() - interval '1 day' * ${STALE_THRESHOLD_DAYS}
      )
    ORDER BY
      CASE WHEN next_poll_at IS NULL THEN 0 ELSE 1 END,
      priority DESC NULLS LAST,
      popularity_score DESC NULLS LAST,
      last_polled_at ASC NULLS FIRST
    LIMIT ${BATCH_SIZE}
  `;

  console.log(`Found ${podcasts.length} podcasts to poll`);

  const startTime = Date.now();
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (let i = 0; i < podcasts.length; i++) {
    const podcast = podcasts[i];
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = i > 0 ? (i / ((Date.now() - startTime) / 1000)).toFixed(1) : '0';
    process.stdout.write(`[${i + 1}/${podcasts.length}] [${elapsed}s ${rate}/s] ${podcast.title.slice(0, 30)}... `);

    const result = await pollPodcast(sql, podcast);

    if (result === 'updated') {
      const interval = podcast.update_frequency || DEFAULT_UPDATE_FREQUENCY;
      await sql`
        UPDATE podcasts SET
          last_polled_at = now(),
          next_poll_at = now() + interval '1 second' * ${interval},
          poll_failures = 0
        WHERE id = ${podcast.id}
      `;
      console.log('✓ updated');
      updated++;
    } else if (result === 'not_modified') {
      console.log('○ unchanged');
      unchanged++;
    } else {
      const failures = podcast.poll_failures + 1;
      const backoff = Math.min(BACKOFF_BASE * Math.pow(2, failures), 604800);

      if (failures >= MAX_FAILURES) {
        await sql`
          UPDATE podcasts SET
            is_active = false,
            poll_failures = ${failures},
            last_polled_at = now()
          WHERE id = ${podcast.id}
        `;
        console.log(`✗ deactivated after ${failures} failures`);
      } else {
        await sql`
          UPDATE podcasts SET
            poll_failures = ${failures},
            next_poll_at = now() + interval '1 second' * ${backoff},
            last_polled_at = now()
          WHERE id = ${podcast.id}
        `;
        console.log(`✗ retry in ${Math.round(backoff / 3600)}h`);
      }
      failed++;
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const finalRate = (podcasts.length / ((Date.now() - startTime) / 1000)).toFixed(1);

  await recordMetrics(sql, {
    feeds_updated: updated,
    feeds_unchanged: unchanged,
    feeds_failed: failed,
  });

  console.log(`\nDone in ${totalTime}s (${finalRate}/s): ${updated} updated, ${unchanged} unchanged, ${failed} failed`);
  await sql.end();
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
