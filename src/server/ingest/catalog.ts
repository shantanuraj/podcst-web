import type postgres from 'postgres';
import { isCanonicalId } from '@/shared/canonical-id';
import { feedUrl } from '../../shared/feed-url';
import {
  claimPublicIdentity,
  findPodcastIdentity,
  lockPodcastIdentities,
  PodcastAccessDenied,
  PodcastIdentityConflict,
} from './podcast-identity';

export interface CatalogPodcast {
  podcastIndexId: number;
  itunesId: string | null;
  feed: string;
  authorId: number;
  title: string;
  description: string | null;
  cover: string;
  website: string | null;
  explicit: boolean;
  episodeCount: number;
  lastPublished: Date | null;
  active: boolean;
  language: string | null;
  popularity: number | null;
  priority: number | null;
  updateFrequency: number | null;
}

export interface CatalogRow {
  id: number;
  url: string;
  title: string;
  lastUpdate: number | null;
  link: string;
  dead: number;
  itunesAuthor: string;
  explicit: number;
  imageUrl: string;
  newestItemPubdate: number | null;
  language: string;
  episodeCount: number | null;
  popularityScore: number | null;
  priority: number | null;
  updateFrequency: number | null;
  description: string;
}

export function catalogInput(
  row: CatalogRow,
  authorId: number,
  itunesId: string | null = null,
): CatalogPodcast {
  return {
    podcastIndexId: row.id,
    itunesId,
    authorId,
    feed: row.url,
    title: row.title,
    description: row.description || null,
    cover: row.imageUrl || 'https://podcst.app/placeholder.png',
    website: row.link || null,
    explicit: row.explicit === 1,
    episodeCount: row.episodeCount || 0,
    lastPublished: row.newestItemPubdate
      ? new Date(row.newestItemPubdate * 1000)
      : null,
    active: row.dead !== 1,
    language: row.language || null,
    popularity: row.popularityScore,
    priority: row.priority,
    updateFrequency: row.updateFrequency ? row.updateFrequency * 86400 : null,
  };
}

export const CATALOG_INSERT_BATCH_SIZE = 200;

export async function insertCatalogPodcasts(
  sql: postgres.Sql,
  rows: CatalogPodcast[],
): Promise<number> {
  if (!rows.length) return 0;
  if (
    rows.length > CATALOG_INSERT_BATCH_SIZE ||
    rows.some(
      (row) =>
        row.itunesId !== null ||
        !Number.isSafeInteger(row.podcastIndexId) ||
        row.podcastIndexId <= 0 ||
        row.podcastIndexId > 2147483647,
    )
  )
    throw new TypeError('Invalid catalog insert batch');
  const values = rows.map((row) => ({
    ...row,
    feed: feedUrl(row.feed),
    lastPublished: row.lastPublished?.toISOString() ?? null,
  }));
  return sql.begin(async (tx) => {
    await lockPodcastIdentities(
      tx,
      values.map((row) => ({
        feedUrl: row.feed,
        podcastIndexId: row.podcastIndexId,
      })),
    );
    const inserted = await tx`
      INSERT INTO podcasts (podcast_index_id,feed_url,title,author_id,description,cover,website_url,
        explicit,episode_count,last_published,is_active,language,popularity_score,priority,update_frequency)
      SELECT incoming."podcastIndexId",incoming.feed,incoming.title,incoming."authorId",incoming.description,
        incoming.cover,incoming.website,incoming.explicit,incoming."episodeCount",incoming."lastPublished",
        incoming.active,incoming.language,incoming.popularity,incoming.priority,incoming."updateFrequency"
      FROM jsonb_to_recordset(${tx.json(values)}::jsonb) AS incoming(
        "podcastIndexId" integer, feed text, title text, "authorId" integer, description text, cover text, website text,
        explicit boolean, "episodeCount" integer, "lastPublished" timestamptz, active boolean, language varchar(10),
        popularity integer, priority integer, "updateFrequency" integer)
      WHERE NOT EXISTS (SELECT 1 FROM podcasts p WHERE p.feed_url=incoming.feed OR p.podcast_index_id=incoming."podcastIndexId")
        AND NOT EXISTS (SELECT 1 FROM podcast_feed_aliases alias WHERE alias.feed_url=incoming.feed)
      ON CONFLICT DO NOTHING
    `;
    return inserted.count;
  });
}

export async function storeCatalogPodcast(
  sql: postgres.Sql,
  input: CatalogPodcast,
  insertOnly = false,
) {
  const feed = feedUrl(input.feed);
  if (
    !Number.isSafeInteger(input.podcastIndexId) ||
    input.podcastIndexId <= 0 ||
    input.podcastIndexId > 2147483647
  )
    throw new TypeError('Invalid catalog identity');
  const itunesId = input.itunesId ?? undefined;
  if (itunesId !== undefined && !isCanonicalId(itunesId))
    throw new TypeError('Invalid Apple identity');
  const observed = await findPodcastIdentity(
    sql,
    feed,
    itunesId,
    input.podcastIndexId,
  );
  const locators = [
    ...new Set([feed, ...(observed ? [observed.feed_url] : [])]),
  ];
  return sql.begin(async (tx) => {
    await lockPodcastIdentities(
      tx,
      locators.map((feedUrl) => ({
        feedUrl,
        itunesId,
        podcastIndexId: input.podcastIndexId,
      })),
    );
    const existing = await findPodcastIdentity(
      tx,
      feed,
      itunesId,
      input.podcastIndexId,
      true,
    );
    if (existing && existing.owner_user_id !== null)
      throw new PodcastAccessDenied(
        'Private source requires trusted verification',
      );
    if (existing) {
      if (!locators.includes(existing.feed_url))
        throw new PodcastIdentityConflict(
          'Canonical source changed during catalog import; retry',
        );
      if (
        existing.podcast_index_id !== null &&
        Number(existing.podcast_index_id) !== input.podcastIndexId
      )
        throw new PodcastIdentityConflict(
          'Feed belongs to another catalog identity',
        );
      if (insertOnly) return 'skipped' as const;
      await claimPublicIdentity(tx, existing, feed, itunesId);
      await tx`
        UPDATE podcasts SET podcast_index_id = ${input.podcastIndexId},
          title = ${input.title}, author_id = ${input.authorId},
          description = coalesce(${input.description}::text, description),
          cover = CASE WHEN ${input.cover} NOT IN ('','https://podcst.app/placeholder.png') THEN ${input.cover} ELSE cover END,
          website_url = coalesce(${input.website}::text, website_url), explicit = ${input.explicit},
          episode_count = greatest(episode_count, ${input.episodeCount}),
          last_published = greatest(last_published, ${input.lastPublished}),
          is_active = ${input.active}, language = coalesce(${input.language}::varchar(10), language),
          popularity_score = ${input.popularity}, priority = ${input.priority},
          update_frequency = ${input.updateFrequency}, updated_at = now()
        WHERE id = ${existing.id} AND owner_user_id IS NULL
      `;
      return 'updated' as const;
    }
    const [created] = await tx`
      INSERT INTO podcasts (podcast_index_id,itunes_id,feed_url,title,author_id,description,cover,website_url,
        explicit,episode_count,last_published,is_active,language,popularity_score,priority,update_frequency)
      VALUES (${input.podcastIndexId},${itunesId ?? null},${feed},${input.title},${input.authorId},${input.description},
        ${input.cover || 'https://podcst.app/placeholder.png'},${input.website},${input.explicit},${input.episodeCount},
        ${input.lastPublished},${input.active},${input.language},${input.popularity},${input.priority},${input.updateFrequency})
      ON CONFLICT DO NOTHING RETURNING id
    `;
    if (!created)
      throw new PodcastIdentityConflict(
        'Catalog identity changed; retry through resolver',
      );
    return 'inserted' as const;
  });
}
