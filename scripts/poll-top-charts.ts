#!/usr/bin/env bun

import postgres from 'postgres';
import { refreshFeed } from '../src/server/ingest/feed-refresh';

const ITUNES_API = 'https://itunes.apple.com';
const TOP_LIMIT = 100;
const POLL_CONCURRENCY = 10;
const EPISODES_ONLY = process.argv.includes('--episodes-only');
const DEFAULT_LOCALES = [
  'ca',
  'fr',
  'in',
  'kr',
  'mx',
  'my',
  'nl',
  'no',
  'se',
  'us',
];

interface iTunesFeedEntry {
  id: { attributes: { 'im:id': string } };
}

interface iTunesFeedResponse {
  feed: { entry: iTunesFeedEntry[] };
}

interface iTunesPodcast {
  kind: string;
  collectionId: number;
  artistName: string;
  collectionName: string;
  feedUrl: string;
  artworkUrl100: string;
  artworkUrl600: string;
  collectionExplicitness: string;
  trackCount: number;
  genreIds: string[];
}

interface iTunesLookupResponse {
  results: iTunesPodcast[];
}

async function fetchTopFromItunes(locale: string) {
  const feedUrl = `${ITUNES_API}/${locale}/rss/toppodcasts/limit=${TOP_LIMIT}/explicit=true/json`;
  const feedRes = await fetch(feedUrl);
  if (!feedRes.ok) {
    console.error(`Failed to fetch top feed for ${locale}: ${feedRes.status}`);
    return [];
  }

  const feedData = (await feedRes.json()) as iTunesFeedResponse;
  if (!feedData.feed?.entry) {
    console.error(`No entries in top feed for ${locale}`);
    return [];
  }

  const topIds = feedData.feed.entry.map((p) => p.id.attributes['im:id']);

  const lookupUrl = `${ITUNES_API}/lookup?id=${topIds.join(',')}`;
  const lookupRes = await fetch(lookupUrl);
  if (!lookupRes.ok) {
    console.error(
      `Failed to lookup podcasts for ${locale}: ${lookupRes.status}`,
    );
    return [];
  }

  const lookupData = (await lookupRes.json()) as iTunesLookupResponse;

  const idToRank = new Map(topIds.map((id, i) => [id, i + 1]));

  return lookupData.results
    .filter((p) => p.kind === 'podcast' && p.feedUrl)
    .map((p) => ({
      itunesId: p.collectionId,
      author: p.artistName,
      feed: p.feedUrl,
      title: p.collectionName,
      cover: p.artworkUrl600,
      thumbnail: p.artworkUrl100,
      explicit: p.collectionExplicitness === 'explicit',
      count: p.trackCount,
      rank: idToRank.get(String(p.collectionId)) || 999,
    }))
    .sort((a, b) => a.rank - b.rank);
}

interface StoreResult {
  stored: number;
  newPodcasts: number;
}

async function markDueForPolling(
  sql: postgres.Sql,
  podcastId: number,
): Promise<void> {
  await sql`
    INSERT INTO feed_poll_state (podcast_id, next_poll_at, failures)
    VALUES (${podcastId}, now(), 0)
    ON CONFLICT (podcast_id) DO NOTHING
  `;
}

async function storeTopPodcasts(
  sql: postgres.Sql,
  podcasts: Awaited<ReturnType<typeof fetchTopFromItunes>>,
  locale: string,
): Promise<StoreResult> {
  await sql`
    INSERT INTO countries (id, name)
    VALUES (${locale}, ${locale.toUpperCase()})
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    INSERT INTO genres (id, name)
    VALUES (0, 'All')
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    DELETE FROM top_podcasts
    WHERE country_id = ${locale} AND genre_id = 0
  `;

  let stored = 0;
  let newPodcasts = 0;

  for (const p of podcasts) {
    let [author] = await sql`
      SELECT id FROM authors WHERE name = ${p.author} LIMIT 1
    `;
    if (!author) {
      [author] = await sql`
        INSERT INTO authors (name) VALUES (${p.author})
        RETURNING id
      `;
    }

    let [podcast] = await sql`
      SELECT id FROM podcasts
      WHERE itunes_id = ${p.itunesId} OR feed_url = ${p.feed}
      LIMIT 1
    `;

    const isNew = !podcast;

    if (!podcast) {
      try {
        [podcast] = await sql`
          INSERT INTO podcasts (
            itunes_id, feed_url, title, author_id, cover, thumbnail, explicit, episode_count
          ) VALUES (
            ${p.itunesId}, ${p.feed}, ${p.title}, ${author.id}, ${p.cover}, ${p.thumbnail},
            ${p.explicit}, ${p.count}
          )
          ON CONFLICT (feed_url) DO UPDATE SET
            itunes_id = COALESCE(EXCLUDED.itunes_id, podcasts.itunes_id),
            title = EXCLUDED.title,
            cover = EXCLUDED.cover,
            thumbnail = EXCLUDED.thumbnail,
            explicit = EXCLUDED.explicit,
            episode_count = GREATEST(EXCLUDED.episode_count, podcasts.episode_count),
            updated_at = now()
          RETURNING id
        `;
        if (isNew) newPodcasts++;
      } catch {
        [podcast] = await sql`
          SELECT id FROM podcasts WHERE feed_url = ${p.feed} LIMIT 1
        `;
      }
    }

    if (!podcast?.id) continue;

    await markDueForPolling(sql, podcast.id);

    await sql`
      INSERT INTO top_podcasts (country_id, genre_id, rank, podcast_id, fetched_at)
      VALUES (${locale}, 0, ${p.rank}, ${podcast.id}, now())
      ON CONFLICT (country_id, genre_id, rank) DO UPDATE SET
        podcast_id = EXCLUDED.podcast_id,
        fetched_at = EXCLUDED.fetched_at
    `;

    stored++;
  }

  return { stored, newPodcasts };
}

interface PodcastForPoll {
  id: number;
  feed_url: string;
  title: string;
}

async function pollFeed(
  sql: postgres.Sql,
  podcast: PodcastForPoll,
): Promise<boolean> {
  const result = await refreshFeed(sql, podcast.id, 'rebuild');
  return result === 'updated';
}

async function pollMissingEpisodes(
  sql: postgres.Sql,
  locales: string[],
): Promise<void> {
  const podcasts = await sql<PodcastForPoll[]>`
    SELECT DISTINCT p.id, p.feed_url, p.title
    FROM top_podcasts tp
    JOIN podcasts p ON tp.podcast_id = p.id
    LEFT JOIN episodes e ON p.id = e.podcast_id
    WHERE tp.country_id = ANY(${locales}::text[])
    GROUP BY p.id, p.feed_url, p.title
    HAVING COUNT(e.id) = 0
    ORDER BY p.id
  `;

  if (podcasts.length === 0) {
    console.log('\nAll top podcasts have episodes');
    return;
  }

  console.log(`\nPolling ${podcasts.length} top podcasts with no episodes...`);

  const startTime = Date.now();
  let updated = 0;
  let failed = 0;
  let processed = 0;

  for (let i = 0; i < podcasts.length; i += POLL_CONCURRENCY) {
    const batch = podcasts.slice(i, i + POLL_CONCURRENCY);
    await Promise.all(
      batch.map(async (podcast) => {
        const ok = await pollFeed(sql, podcast);
        if (ok) {
          updated++;
        } else {
          console.log(`\n✗ [${podcast.id}] ${podcast.title}`);
          failed++;
        }
        processed++;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = (processed / ((Date.now() - startTime) / 1000)).toFixed(1);
        process.stdout.write(
          `\r[${processed}/${podcasts.length}] [${elapsed}s ${rate}/s] ✓${updated} ✗${failed}`,
        );
      }),
    );
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `\nEpisode poll: ${updated} updated, ${failed} failed in ${totalTime}s`,
  );
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL required');
  }

  const sql = postgres(connectionString, {
    max: 20,
    idle_timeout: 20,
    ...(process.env.PGHOST && { host: process.env.PGHOST }),
  });

  const locales = DEFAULT_LOCALES;

  if (!EPISODES_ONLY) {
    console.log(`Polling top charts for ${locales.length} locales...`);

    let totalStored = 0;
    let totalNew = 0;

    for (const locale of locales) {
      console.log(`\n[${locale}] Fetching top ${TOP_LIMIT} podcasts...`);

      const podcasts = await fetchTopFromItunes(locale);
      if (podcasts.length === 0) {
        console.log(`[${locale}] No podcasts found`);
        continue;
      }

      console.log(`[${locale}] Found ${podcasts.length} podcasts, storing...`);
      const { stored, newPodcasts } = await storeTopPodcasts(
        sql,
        podcasts,
        locale,
      );
      console.log(`[${locale}] Stored ${stored} podcasts (${newPodcasts} new)`);

      totalStored += stored;
      totalNew += newPodcasts;
    }

    if (totalNew > 0) {
      await sql`
        INSERT INTO poll_metrics (metric_name, metric_value)
        VALUES ('top_charts_new_podcasts', ${totalNew})
      `;
    }

    console.log(
      `\nCharts: ${totalStored} total, ${totalNew} new podcasts discovered`,
    );
  }

  await pollMissingEpisodes(sql, locales);

  await sql.end();
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
