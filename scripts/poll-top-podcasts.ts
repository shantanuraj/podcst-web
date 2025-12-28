#!/usr/bin/env bun

import postgres from 'postgres';
import { createHash } from 'crypto';
import { adaptFeed } from '../src/app/api/feed/parser';

const CONCURRENCY = 10;

const LOCALES = ['us', 'nl', 'ca', 'kr', 'my', 'in', 'mx', 'fr', 'se', 'no'];

const sanitize = (str: string | null | undefined): string | null =>
  str ? str.replace(/\x00/g, '') : null;

interface PodcastRow {
  id: number;
  feed_url: string;
  title: string;
}

async function pollPodcast(
  sql: postgres.Sql,
  podcast: PodcastRow,
): Promise<'updated' | 'error'> {
  try {
    const res = await fetch(podcast.feed_url, {
      headers: { 'User-Agent': 'Podcst/1.0' },
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      return 'error';
    }

    const body = await res.text();
    const hash = createHash('sha256').update(body).digest('hex');

    const feed = await adaptFeed(body);
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
        feed_etag = ${res.headers.get('etag')}::TEXT,
        feed_last_modified = ${res.headers.get('last-modified')}::TEXT,
        feed_hash = ${hash}::TEXT,
        last_polled_at = now(),
        next_poll_at = now() + interval '1 day',
        poll_failures = 0,
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
  } catch {
    return 'error';
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL required');
  }

  const sql = postgres(connectionString, { max: 20, idle_timeout: 20 });

  const podcasts = await sql<PodcastRow[]>`
    SELECT DISTINCT p.id, p.feed_url, p.title
    FROM top_podcasts tp
    JOIN podcasts p ON tp.podcast_id = p.id
    LEFT JOIN episodes e ON p.id = e.podcast_id
    WHERE tp.country_id = ANY(${LOCALES}::text[])
    GROUP BY p.id, p.feed_url, p.title
    HAVING COUNT(e.id) = 0
    ORDER BY p.id
  `;

  console.log(`Found ${podcasts.length} top podcasts with no episodes`);

  if (podcasts.length === 0) {
    await sql.end();
    return;
  }

  const startTime = Date.now();
  let updated = 0;
  let failed = 0;
  let processed = 0;

  async function processPodcast(podcast: PodcastRow): Promise<void> {
    const result = await pollPodcast(sql, podcast);
    if (result === 'updated') {
      updated++;
    } else {
      console.log(`\n✗ [${podcast.id}] ${podcast.title}: ${podcast.feed_url}`);
      failed++;
    }
    processed++;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = (processed / ((Date.now() - startTime) / 1000)).toFixed(1);
    process.stdout.write(
      `\r[${processed}/${podcasts.length}] [${elapsed}s ${rate}/s] ✓${updated} ✗${failed}`,
    );
  }

  for (let i = 0; i < podcasts.length; i += CONCURRENCY) {
    const batch = podcasts.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(processPodcast));
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `\n\nComplete: ${updated} updated, ${failed} failed in ${totalTime}s`,
  );

  await sql.end();
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
