import type postgres from 'postgres';
import { upsertEpisodes } from './episodes';
import { fetchFeed, savePollState } from './feed-refresh';
import { getPollInterval } from './feed-schedule';

export class PodcastIdentityConflict extends Error {}

interface PodcastIdentity {
  id: string | number;
  itunes_id: string | number | null;
}

function findPodcast(sql: postgres.ISql, feedUrl: string, itunesId?: number) {
  return sql<PodcastIdentity[]>`
    SELECT id, itunes_id FROM podcasts
    WHERE feed_url = ${feedUrl} OR itunes_id = ${itunesId ?? null}::bigint
    ORDER BY (itunes_id = ${itunesId ?? null}::bigint) DESC NULLS LAST
    LIMIT 1
  `;
}

async function associateItunesId(
  sql: postgres.ISql,
  podcast: PodcastIdentity,
  itunesId?: number,
): Promise<number> {
  if (itunesId !== undefined) {
    if (podcast.itunes_id !== null && Number(podcast.itunes_id) !== itunesId) {
      throw new PodcastIdentityConflict('Feed belongs to another Apple ID');
    }
    await sql`
      UPDATE podcasts SET itunes_id = ${itunesId}
      WHERE id = ${podcast.id} AND itunes_id IS NULL
    `;
  }
  return Number(podcast.id);
}

export async function indexPodcast(
  sql: postgres.Sql,
  feedUrl: string,
  itunesId?: number,
): Promise<number> {
  return sql.begin(async (tx) => {
    if (itunesId !== undefined) {
      await tx`
        SELECT pg_advisory_xact_lock(hashtext('podcast:itunes'), hashtext(${String(itunesId)}))
      `;
    }
    await tx`
      SELECT pg_advisory_xact_lock(hashtext('podcast:feed'), hashtext(${feedUrl}))
    `;
    const [existing] = await findPodcast(tx, feedUrl, itunesId);
    if (existing) return associateItunesId(tx, existing, itunesId);

    const result = await fetchFeed(feedUrl);
    if (result.status !== 'updated') throw new Error('Feed was not returned');
    const { data } = result;
    const authorName = data.author || 'Unknown';
    let [author] = await tx`
      SELECT id FROM authors WHERE name = ${authorName} LIMIT 1
    `;
    if (!author) {
      [author] = await tx`
        INSERT INTO authors (name) VALUES (${authorName}) RETURNING id
      `;
    }
    let [podcast] = await tx<PodcastIdentity[]>`
      INSERT INTO podcasts (
        itunes_id, feed_url, title, author_id, description, cover, website_url,
        explicit, episode_count, last_published
      ) VALUES (
        ${itunesId ?? null}, ${feedUrl}, ${data.title}, ${author.id},
        ${data.description}, ${data.cover}, ${data.link}, ${data.explicit},
        ${data.episodes.length}, ${data.published ? new Date(data.published) : null}
      )
      ON CONFLICT DO NOTHING
      RETURNING id, itunes_id
    `;
    if (!podcast) [podcast] = await findPodcast(tx, feedUrl, itunesId);
    if (!podcast) throw new Error('Unable to index podcast');
    const id = await associateItunesId(tx, podcast, itunesId);
    await upsertEpisodes(tx, id, data.cover, data.episodes);
    await savePollState(tx, id, result, getPollInterval(null));
    return id;
  });
}
