#!/usr/bin/env bun

import postgres from 'postgres';
import { createHash } from 'crypto';
import { adaptFeed } from '../src/app/api/feed/parser';
import type { IEpisodeListing } from '../src/types';

const BATCH_SIZE = 500;
const CONCURRENCY = 10;
const DEFAULT_UPDATE_FREQUENCY = 86400;
const MIN_UPDATE_FREQUENCY = 3600;
const MAX_FAILURES = 5;
const BACKOFF_BASE = 3600;
const STALE_THRESHOLD_DAYS = 180;
const IDLE_SLEEP_MS = 60_000;

const DAEMON_MODE = process.argv.includes('--daemon');

const sanitize = (str: string | null | undefined): string | null =>
  str ? str.replace(/\x00/g, '') : null;

const getPollInterval = (updateFrequency: number | null): number => {
  if (!updateFrequency) return DEFAULT_UPDATE_FREQUENCY;
  const seconds = updateFrequency < 86400 ? updateFrequency * 86400 : updateFrequency;
  return Math.max(seconds, MIN_UPDATE_FREQUENCY);
};

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

async function fetchFeed(
  url: string,
  podcast: PodcastRow,
): Promise<FetchResult> {
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

async function pollPodcast(
  sql: postgres.Sql,
  podcast: PodcastRow,
): Promise<PollResult> {
  const result = await fetchFeed(podcast.feed_url, podcast);

  if (result.status === 'error') {
    return 'error';
  }

  if (result.status === 'not_modified') {
    await sql`
      UPDATE podcasts SET
        last_polled_at = now(),
        next_poll_at = now() + interval '1 second' * ${getPollInterval(podcast.update_frequency)},
        poll_failures = 0
      WHERE id = ${podcast.id}
    `;
    return 'not_modified';
  }

  let feed;
  try {
    feed = await adaptFeed(result.body!);
  } catch {
    return 'error';
  }
  if (!feed) {
    return 'error';
  }

  const lastPublished = feed.published ? new Date(feed.published) : null;

  await sql`
    UPDATE podcasts SET
      title = ${sanitize(feed.title)},
      description = ${sanitize(feed.description)}::TEXT,
      cover = ${sanitize(feed.cover) || podcast.feed_url},
      website_url = ${sanitize(feed.link)}::TEXT,
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
    if (!ep.guid || !ep.file.url) continue;

    const published = ep.published ? new Date(ep.published) : new Date();
    const duration = ep.duration ? Math.floor(ep.duration) : null;

    await sql`
      INSERT INTO episodes (
        podcast_id, guid, title, summary, published, duration,
        episode_art, file_url, file_length, file_type
      ) VALUES (
        ${podcast.id},
        ${sanitize(ep.guid)},
        ${sanitize(ep.title)},
        ${sanitize(ep.summary)}::TEXT,
        ${published},
        ${duration}::INTEGER,
        ${sanitize(ep.episodeArt)}::TEXT,
        ${sanitize(ep.file.url)},
        ${ep.file.length},
        ${sanitize(ep.file.type)}
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

async function processBatch(sql: postgres.Sql): Promise<number> {
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
      priority DESC NULLS LAST,
      popularity_score DESC NULLS LAST,
      CASE WHEN next_poll_at IS NULL THEN 0 ELSE 1 END,
      last_polled_at ASC NULLS FIRST
    LIMIT ${BATCH_SIZE}
  `;

  if (podcasts.length === 0) {
    return 0;
  }

  const startTime = Date.now();
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  let processed = 0;

  async function processPodcast(podcast: PodcastRow): Promise<void> {
    const result = await pollPodcast(sql, podcast);

    if (result === 'updated') {
      const interval = getPollInterval(podcast.update_frequency);
      await sql`
        UPDATE podcasts SET
          last_polled_at = now(),
          next_poll_at = now() + interval '1 second' * ${interval},
          poll_failures = 0
        WHERE id = ${podcast.id}
      `;
      updated++;
    } else if (result === 'not_modified') {
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
        console.log(`\n[${podcast.id}] deactivated: ${podcast.feed_url}`);
      } else {
        await sql`
          UPDATE podcasts SET
            poll_failures = ${failures},
            next_poll_at = now() + interval '1 second' * ${backoff},
            last_polled_at = now()
          WHERE id = ${podcast.id}
        `;
      }
      failed++;
    }

    processed++;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = (processed / ((Date.now() - startTime) / 1000)).toFixed(1);
    process.stdout.write(
      `\r[${processed}/${podcasts.length}] [${elapsed}s ${rate}/s] ✓${updated} ○${unchanged} ✗${failed}`,
    );
  }

  for (let i = 0; i < podcasts.length; i += CONCURRENCY) {
    const batch = podcasts.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(processPodcast));
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const finalRate = (podcasts.length / ((Date.now() - startTime) / 1000)).toFixed(1);

  await recordMetrics(sql, {
    feeds_updated: updated,
    feeds_unchanged: unchanged,
    feeds_failed: failed,
  });

  console.log(`\n✓ ${totalTime}s (${finalRate}/s): ${updated} updated, ${unchanged} unchanged, ${failed} failed`);

  return podcasts.length;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL required');
  }

  const sql = postgres(connectionString, { max: 20, idle_timeout: 20 });

  if (DAEMON_MODE) {
    console.log(`Daemon mode: polling continuously (batch=${BATCH_SIZE}, concurrency=${CONCURRENCY})`);
    while (true) {
      const count = await processBatch(sql);
      if (count === 0) {
        process.stdout.write(`[${new Date().toISOString()}] No podcasts due, sleeping ${IDLE_SLEEP_MS / 1000}s...`);
        await Bun.sleep(IDLE_SLEEP_MS);
        console.log('');
      }
    }
  } else {
    const count = await processBatch(sql);
    if (count === 0) {
      console.log('No podcasts due for polling');
    }
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
