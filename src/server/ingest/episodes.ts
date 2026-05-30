import type postgres from 'postgres';
import type { IEpisode } from '@/types';

export const sanitize = (str: string | null | undefined): string | null =>
  str ? str.replaceAll('\u0000', '') : null;

interface EpisodeRow {
  guid: string;
  title: string;
  summary: string | null;
  published: string;
  duration: number | null;
  episode_art: string | null;
  file_url: string;
  file_length: number | null;
  file_type: string | null;
}

export const buildRows = (
  episodes: IEpisode[],
  podcastCover: string | null,
): EpisodeRow[] => {
  const byGuid = new Map<string, EpisodeRow>();
  for (const ep of episodes) {
    const guid = sanitize(ep.guid);
    const fileUrl = sanitize(ep.file?.url);
    if (!guid || !fileUrl) continue;
    const art = sanitize(ep.episodeArt);
    byGuid.set(guid, {
      guid,
      title: sanitize(ep.title) ?? '',
      summary: sanitize(ep.showNotes),
      published: (ep.published
        ? new Date(ep.published)
        : new Date()
      ).toISOString(),
      duration:
        ep.duration && ep.duration > 0 && ep.duration <= 2147483647
          ? Math.floor(ep.duration)
          : null,
      episode_art: art && art !== podcastCover ? art : null,
      file_url: fileUrl,
      file_length: ep.file.length ?? null,
      file_type: sanitize(ep.file.type),
    });
  }
  return [...byGuid.values()];
};

export async function upsertEpisodes(
  sql: postgres.Sql,
  podcastId: number,
  podcastCover: string | null,
  episodes: IEpisode[],
): Promise<void> {
  const rows = buildRows(episodes, podcastCover);
  if (rows.length === 0) return;

  await sql`
    INSERT INTO episodes (podcast_id, guid, published)
    SELECT ${podcastId}, d.guid, d.published
    FROM jsonb_to_recordset(${sql.json(rows as unknown as postgres.JSONValue)}::jsonb)
         AS d(guid text, published timestamptz)
    ON CONFLICT (podcast_id, guid) DO NOTHING
  `;

  await sql`
    INSERT INTO episode_content (
      episode_id, title, summary, duration, episode_art, file_url, file_length, file_type
    )
    SELECT e.id, d.title, d.summary, d.duration, d.episode_art, d.file_url, d.file_length, d.file_type
    FROM jsonb_to_recordset(${sql.json(rows as unknown as postgres.JSONValue)}::jsonb) AS d(
      guid text, title text, summary text, duration int,
      episode_art text, file_url text, file_length bigint, file_type text
    )
    JOIN episodes e ON e.podcast_id = ${podcastId} AND e.guid = d.guid
    ON CONFLICT (episode_id) DO UPDATE SET
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      duration = EXCLUDED.duration,
      episode_art = EXCLUDED.episode_art,
      file_url = EXCLUDED.file_url,
      file_length = EXCLUDED.file_length,
      file_type = EXCLUDED.file_type
    WHERE (episode_content.title, episode_content.summary, episode_content.duration,
           episode_content.episode_art, episode_content.file_url,
           episode_content.file_length, episode_content.file_type)
      IS DISTINCT FROM
          (EXCLUDED.title, EXCLUDED.summary, EXCLUDED.duration,
           EXCLUDED.episode_art, EXCLUDED.file_url,
           EXCLUDED.file_length, EXCLUDED.file_type)
  `;
}
