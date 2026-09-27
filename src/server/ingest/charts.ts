import type postgres from 'postgres';
import { ITUNES_API } from '../../data/constants';
import { sanitize } from './episodes';

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
    podcasts.set(id, {
      itunesId: id,
      rank,
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

function findPodcast(sql: postgres.ISql, podcast: ChartPodcast) {
  return sql`
    SELECT id FROM podcasts
    WHERE itunes_id = ${podcast.itunesId} OR feed_url = ${podcast.feed}
    ORDER BY (itunes_id = ${podcast.itunesId}) DESC NULLS LAST
    LIMIT 1
  `;
}

export async function storeTopPodcasts(
  sql: postgres.Sql,
  podcasts: ChartPodcast[],
  locale: string,
): Promise<{ stored: number; newPodcasts: number }> {
  if (podcasts.length === 0)
    throw new Error('Refusing to store an empty chart');

  return sql.begin(async (tx) => {
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
    for (const p of podcasts) {
      let [podcast] = await findPodcast(tx, p);
      if (!podcast) {
        let [author] =
          await tx`SELECT id FROM authors WHERE name = ${p.author} LIMIT 1`;
        if (!author) {
          [author] =
            await tx`INSERT INTO authors (name) VALUES (${p.author}) RETURNING id`;
        }
        [podcast] = await tx`
          INSERT INTO podcasts (
            itunes_id, feed_url, title, author_id, cover, thumbnail, explicit, episode_count
          ) VALUES (
            ${p.itunesId}, ${p.feed}, ${p.title}, ${author.id}, ${p.cover}, ${p.thumbnail},
            ${p.explicit}, ${p.count}
          )
          ON CONFLICT DO NOTHING
          RETURNING id
        `;
        if (podcast) newPodcasts++;
        else [podcast] = await findPodcast(tx, p);
      }
      if (!podcast)
        throw new Error(`Unable to store Apple podcast ${p.itunesId}`);

      await tx`
        UPDATE podcasts SET itunes_id = ${p.itunesId}
        WHERE id = ${podcast.id} AND itunes_id IS NULL
      `;
      await tx`
        INSERT INTO feed_poll_state (podcast_id) VALUES (${podcast.id})
        ON CONFLICT (podcast_id) DO NOTHING
      `;
      await tx`
        INSERT INTO top_podcasts (country_id, genre_id, rank, podcast_id, fetched_at)
        VALUES (${locale}, 0, ${p.rank}, ${podcast.id}, now())
      `;
    }
    return { stored: podcasts.length, newPodcasts };
  });
}

export async function refreshTopCharts(
  sql: postgres.Sql,
  locales: string[],
  fetchChart = fetchTopFromItunes,
) {
  let stored = 0;
  let newPodcasts = 0;
  const failedLocales: string[] = [];

  for (const locale of locales) {
    try {
      console.log(`[${locale}] Fetching top ${TOP_LIMIT} podcasts...`);
      const podcasts = await fetchChart(locale);
      const result = await storeTopPodcasts(sql, podcasts, locale);
      stored += result.stored;
      newPodcasts += result.newPodcasts;
      console.log(
        `[${locale}] Stored ${result.stored} podcasts (${result.newPodcasts} new)`,
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
  })) {
    await sql`
      INSERT INTO poll_metrics (metric_name, metric_value) VALUES (${name}, ${value})
    `;
  }
  return { stored, newPodcasts, failedLocales };
}
