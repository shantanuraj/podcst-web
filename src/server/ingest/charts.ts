import type postgres from 'postgres';
import { ITUNES_API } from '../../data/constants';
import { sanitize } from './episodes';
import {
  claimPublicIdentity,
  findPodcastIdentity,
  lockPodcastIdentities,
  PodcastIdentityConflict,
} from './index-podcast';

const TOP_LIMIT = 100;

export interface ChartPodcast {
  itunesId: number;
  author: string;
  feed: string;
  title: string;
  cover: string;
  thumbnail: string | null;
  explicit: boolean;
  count: number;
  rank: number;
  verifiedAt: string;
  genres: number[];
}

interface ITunesFeedResponse {
  feed?: { entry?: { id?: { attributes?: { 'im:id'?: string } } }[] };
}

interface ITunesPodcast {
  kind?: string;
  collectionId?: number;
  artistName?: string;
  collectionName?: string;
  feedUrl?: string;
  artworkUrl100?: string;
  artworkUrl600?: string;
  collectionExplicitness?: string;
  trackCount?: number;
  genreIds?: string[];
}

interface ITunesLookupResponse {
  results?: ITunesPodcast[];
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export async function fetchTopFromItunes(
  locale: string,
  request: Fetch = fetch,
): Promise<ChartPodcast[]> {
  const get = async (url: string) => {
    const response = await request(url, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Apple returned HTTP ${response.status}`);
    return response.json();
  };

  const chart: ITunesFeedResponse | null = await get(
    `${ITUNES_API}/${locale}/rss/toppodcasts/limit=${TOP_LIMIT}/explicit=true/json`,
  );
  const entries = chart?.feed?.entry;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Apple returned an empty or invalid chart');
  }

  const ids = entries.map((entry) => Number(entry?.id?.attributes?.['im:id']));
  if (
    ids.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error('Apple returned invalid or duplicate chart IDs');
  }

  const lookupUrl = new URL('/lookup', ITUNES_API);
  lookupUrl.searchParams.set('id', ids.join(','));
  lookupUrl.searchParams.set('country', locale);
  lookupUrl.searchParams.set('entity', 'podcast');
  lookupUrl.searchParams.set('limit', String(TOP_LIMIT));
  const lookup: ITunesLookupResponse | null = await get(lookupUrl.href);
  if (!Array.isArray(lookup?.results)) {
    throw new Error('Apple returned an invalid lookup response');
  }

  const verifiedAt = new Date().toISOString();
  const ranks = new Map(ids.map((id, i) => [id, i + 1]));
  const podcasts = new Map<number, ChartPodcast>();
  for (const podcast of lookup.results) {
    const id = podcast.collectionId;
    const rank = id === undefined ? undefined : ranks.get(id);
    if (
      id === undefined ||
      !rank ||
      podcast.kind !== 'podcast' ||
      !podcast.feedUrl
    ) {
      continue;
    }
    const title = sanitize(podcast.collectionName)?.trim();
    const cover = sanitize(podcast.artworkUrl600 || podcast.artworkUrl100);
    const feed = sanitize(podcast.feedUrl)?.trim();
    if (!title || !cover || !feed || !/^https?:\/\//i.test(feed)) {
      throw new Error(`Apple returned invalid metadata for podcast ${id}`);
    }
    const count = podcast.trackCount;
    const genres = [
      ...new Set(
        (podcast.genreIds ?? [])
          .map(Number)
          .filter((genre) => Number.isSafeInteger(genre) && genre !== 26),
      ),
    ];
    podcasts.set(id, {
      genres,
      itunesId: id,
      rank,
      verifiedAt,
      title,
      feed,
      cover,
      author: sanitize(podcast.artistName)?.trim() || 'Unknown',
      thumbnail: sanitize(podcast.artworkUrl100),
      explicit: podcast.collectionExplicitness === 'explicit',
      count:
        Number.isInteger(count) &&
        count !== undefined &&
        count >= 0 &&
        count <= 2147483647
          ? count
          : 0,
    });
  }

  if (podcasts.size === 0) throw new Error('Apple returned no usable podcasts');
  return [...podcasts.values()].sort((a, b) => a.rank - b.rank);
}

export async function storeTopPodcasts(
  sql: postgres.Sql,
  podcasts: ChartPodcast[],
  locale: string,
): Promise<{ stored: number; newPodcasts: number; skipped: number }> {
  if (podcasts.length === 0)
    throw new Error('Refusing to store an empty chart');

  const identities = podcasts.map(({ feed, itunesId }) => ({
    feedUrl: feed,
    itunesId,
  }));
  for (const podcast of podcasts) {
    try {
      const observed = await findPodcastIdentity(
        sql,
        podcast.feed,
        podcast.itunesId,
      );
      if (observed)
        identities.push({
          feedUrl: observed.feed_url,
          itunesId: podcast.itunesId,
        });
    } catch (error) {
      if (!(error instanceof PodcastIdentityConflict)) throw error;
    }
  }
  const lockedLocators = new Set(identities.map(({ feedUrl }) => feedUrl));
  return sql.begin(async (tx) => {
    await lockPodcastIdentities(tx, identities);
    await tx`
      INSERT INTO countries (id, name) VALUES (${locale}, ${locale.toUpperCase()})
      ON CONFLICT (id) DO NOTHING
    `;
    await tx`SELECT id FROM countries WHERE id = ${locale} FOR UPDATE`;
    await tx`
      INSERT INTO genres (id, name) VALUES (0, 'All')
      ON CONFLICT (id) DO NOTHING
    `;
    await tx`DELETE FROM top_podcasts WHERE country_id = ${locale} AND genre_id = 0`;

    let newPodcasts = 0;
    let skipped = 0;
    const storedSources = new Set<number>();
    for (const p of [...podcasts].sort((a, b) => a.rank - b.rank)) {
      try {
        const result = await tx.savepoint(async (entry) => {
          const { id, created } = await claimChartPodcast(
            entry,
            p,
            locale,
            lockedLocators,
          );
          if (!storedSources.has(id)) {
            await entry`
              INSERT INTO feed_poll_state (podcast_id) VALUES (${id})
              ON CONFLICT (podcast_id) DO NOTHING
            `;
            await entry`
              INSERT INTO top_podcasts (country_id, genre_id, rank, podcast_id, fetched_at)
              VALUES (${locale}, 0, ${p.rank}, ${id}, now())
            `;
            await entry`
              INSERT INTO chart_history (country_id, day, podcast_id, rank)
              VALUES (${locale}, (now() AT TIME ZONE 'UTC')::date, ${id}, ${p.rank})
              ON CONFLICT (country_id, day, podcast_id) DO UPDATE SET rank = EXCLUDED.rank
            `;
            await storeGenres(entry, id, p.genres);
          }
          return { id, created };
        });
        storedSources.add(result.id);
        if (result.created) newPodcasts++;
      } catch (error) {
        if (!(error instanceof PodcastIdentityConflict)) throw error;
        skipped++;
        console.warn(
          `[${locale}] Skipping Apple podcast ${p.itunesId} at rank ${p.rank}: ${error.message}`,
        );
      }
    }
    if (!storedSources.size)
      throw new Error('Refusing to replace chart: no unambiguous podcasts');
    return { stored: storedSources.size, newPodcasts, skipped };
  });
}

async function claimChartPodcast(
  tx: postgres.TransactionSql,
  p: ChartPodcast,
  locale: string,
  lockedLocators: Set<string>,
) {
  let podcast = await findPodcastIdentity(
    tx,
    p.feed,
    p.itunesId,
    undefined,
    true,
  );
  let created = false;
  if (!podcast) {
    let [author] =
      await tx`SELECT id FROM authors WHERE name = ${p.author} LIMIT 1`;
    if (!author)
      [author] =
        await tx`INSERT INTO authors (name) VALUES (${p.author}) RETURNING id`;
    [podcast] = await tx`
      INSERT INTO podcasts (
        itunes_id, feed_url, title, author_id, cover, thumbnail, explicit, episode_count
      ) VALUES (
        ${p.itunesId}, ${p.feed}, ${p.title}, ${author.id}, ${p.cover}, ${p.thumbnail},
        ${p.explicit}, ${p.count}
      )
      ON CONFLICT DO NOTHING
      RETURNING id, itunes_id, podcast_index_id, feed_url, owner_user_id
    `;
    created = Boolean(podcast);
    podcast ??= await findPodcastIdentity(
      tx,
      p.feed,
      p.itunesId,
      undefined,
      true,
    );
  }
  if (!podcast) throw new Error(`Unable to store Apple podcast ${p.itunesId}`);
  if (!lockedLocators.has(podcast.feed_url))
    throw new PodcastIdentityConflict(
      'Canonical source changed during chart import; retry',
    );
  const id = await claimPublicIdentity(tx, podcast, p.feed, p.itunesId, {
    country: locale,
    verifiedAt: p.verifiedAt,
  });
  return { id, created };
}

async function storeGenres(
  tx: postgres.TransactionSql,
  podcastId: number,
  genres: number[],
) {
  if (!genres.length) return;
  const known = await tx`
    SELECT id FROM genres WHERE id = ANY(${genres}::int[]) AND id <> 26
  `;
  const ids = new Set(known.map(({ id }) => Number(id)));
  const stored = genres.filter((genre) => ids.has(genre));
  if (!stored.length) return;
  await tx`UPDATE podcasts SET primary_genre_id = ${stored[0]} WHERE id = ${podcastId}`;
  await tx`
    DELETE FROM podcasts_genres
    WHERE podcast_id = ${podcastId} AND genre_id <> ALL(${stored}::int[])
  `;
  await tx`
    INSERT INTO podcasts_genres (podcast_id, genre_id)
    SELECT ${podcastId}, unnest(${stored}::int[])
    ON CONFLICT DO NOTHING
  `;
}

export async function refreshTopCharts(
  sql: postgres.Sql,
  locales: string[],
  fetchChart = fetchTopFromItunes,
) {
  let stored = 0;
  let newPodcasts = 0;
  let skipped = 0;
  const failedLocales: string[] = [];

  for (const locale of locales) {
    try {
      console.log(`[${locale}] Fetching top ${TOP_LIMIT} podcasts...`);
      const podcasts = await fetchChart(locale);
      const result = await storeTopPodcasts(sql, podcasts, locale);
      stored += result.stored;
      newPodcasts += result.newPodcasts;
      skipped += result.skipped;
      console.log(
        `[${locale}] Stored ${result.stored} podcasts (${result.newPodcasts} new, ${result.skipped} identity conflicts skipped)`,
      );
    } catch (error) {
      failedLocales.push(locale);
      console.error(
        `[${locale}] Chart refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const [name, value] of Object.entries({
    top_charts_stored: stored,
    top_charts_new_podcasts: newPodcasts,
    top_charts_failed: failedLocales.length,
    top_charts_skipped: skipped,
  })) {
    await sql`
      INSERT INTO poll_metrics (metric_name, metric_value) VALUES (${name}, ${value})
    `;
  }
  return { stored, newPodcasts, skipped, failedLocales };
}
