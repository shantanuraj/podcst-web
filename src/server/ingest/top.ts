import { sql } from '../db';
import type { IPodcast, iTunes } from '@/types';
import { ITUNES_API } from '@/data/constants';

const TOP_PODCASTS_CACHE_HOURS = 1;

export async function getTopPodcasts(limit: number, locale: string): Promise<IPodcast[]> {
  const cached = await getTopFromDb(limit, locale);
  if (cached.length > 0) {
    return cached;
  }

  const podcasts = await fetchTopFromItunes(limit, locale);
  if (podcasts.length > 0) {
    await storeTopPodcasts(podcasts, locale);
  }

  return podcasts;
}

async function getTopFromDb(limit: number, locale: string): Promise<IPodcast[]> {
  const cutoff = new Date(Date.now() - TOP_PODCASTS_CACHE_HOURS * 60 * 60 * 1000);

  const rows = await sql`
    SELECT
      p.id,
      p.itunes_id,
      p.title,
      p.feed_url,
      p.cover,
      p.thumbnail,
      p.explicit,
      p.episode_count,
      a.name as author_name
    FROM top_podcasts tp
    JOIN podcasts p ON p.id = tp.podcast_id
    JOIN authors a ON a.id = p.author_id
    WHERE tp.country_id = ${locale}
      AND tp.genre_id = 0
      AND tp.fetched_at > ${cutoff}
    ORDER BY tp.rank
    LIMIT ${limit}
  `;

  if (rows.length === 0) {
    return [];
  }

  return rows.map((r) => ({
    id: r.itunes_id || r.id,
    author: r.author_name,
    feed: r.feed_url,
    title: r.title,
    cover: r.cover,
    thumbnail: r.thumbnail || r.cover,
    categories: [],
    explicit: r.explicit ? 'explicit' : 'notExplicit',
    count: r.episode_count,
  }));
}

async function fetchTopFromItunes(limit: number, locale: string): Promise<IPodcast[]> {
  try {
    const feedUrl = `${ITUNES_API}/${locale}/rss/toppodcasts/limit=${limit}/explicit=true/json`;
    const feedRes = await fetch(feedUrl);
    if (!feedRes.ok) return [];

    const feedData = (await feedRes.json()) as iTunes.FeedResponse;
    const topIds = feedData.feed.entry.map((p) => p.id.attributes['im:id']);

    const lookupUrl = `${ITUNES_API}/lookup?id=${topIds.join(',')}`;
    const lookupRes = await fetch(lookupUrl);
    if (!lookupRes.ok) return [];

    const lookupData = (await lookupRes.json()) as iTunes.Response;

    return lookupData.results
      .filter((p) => p.kind === 'podcast' && p.feedUrl)
      .map((p) => ({
        id: p.collectionId,
        author: p.artistName,
        feed: p.feedUrl,
        title: p.collectionName,
        cover: p.artworkUrl600,
        thumbnail: p.artworkUrl100,
        categories: p.genreIds.map(Number),
        explicit: p.collectionExplicitness,
        count: p.trackCount,
      }));
  } catch (err) {
    console.error('Failed to fetch top from iTunes:', err);
    return [];
  }
}

async function storeTopPodcasts(podcasts: IPodcast[], locale: string) {
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

  for (let i = 0; i < podcasts.length; i++) {
    const p = podcasts[i];

    const [author] = await sql`
      INSERT INTO authors (name, itunes_id)
      VALUES (${p.author}, ${String(p.id)})
      ON CONFLICT (itunes_id) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `;

    const [podcast] = await sql`
      INSERT INTO podcasts (
        itunes_id, feed_url, title, author_id, cover, thumbnail, explicit, episode_count
      ) VALUES (
        ${p.id},
        ${p.feed},
        ${p.title},
        ${author.id},
        ${p.cover},
        ${p.thumbnail},
        ${p.explicit === 'explicit'},
        ${p.count}
      )
      ON CONFLICT (itunes_id) DO UPDATE SET
        feed_url = EXCLUDED.feed_url,
        title = EXCLUDED.title,
        cover = EXCLUDED.cover,
        thumbnail = EXCLUDED.thumbnail,
        episode_count = EXCLUDED.episode_count,
        updated_at = now()
      RETURNING id
    `;

    await sql`
      INSERT INTO top_podcasts (country_id, genre_id, rank, podcast_id, fetched_at)
      VALUES (${locale}, 0, ${i + 1}, ${podcast.id}, now())
      ON CONFLICT (country_id, genre_id, rank) DO UPDATE SET
        podcast_id = EXCLUDED.podcast_id,
        fetched_at = EXCLUDED.fetched_at
    `;
  }
}
