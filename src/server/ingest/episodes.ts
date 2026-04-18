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

const buildRows = (
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
      duration: ep.duration ? Math.floor(ep.duration) : null,
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
    UPDATE episodes e SET
      title = d.title,
      summary = d.summary,
      duration = d.duration,
      episode_art = d.episode_art,
      file_url = d.file_url
    FROM jsonb_to_recordset(${sql.json(rows as unknown as postgres.JSONValue)}::jsonb) AS d(
      guid text, title text, summary text, duration int,
      episode_art text, file_url text
    )
    WHERE e.podcast_id = ${podcastId} AND e.guid = d.guid
      AND (e.title, e.summary, e.duration, e.episode_art, e.file_url)
          IS DISTINCT FROM (d.title, d.summary, d.duration, d.episode_art, d.file_url)
  `;

  await sql`
    INSERT INTO episodes (
      podcast_id, guid, title, summary, published, duration,
      episode_art, file_url, file_length, file_type
    )
    SELECT ${podcastId}, d.guid, d.title, d.summary, d.published, d.duration,
           d.episode_art, d.file_url, d.file_length, d.file_type
    FROM jsonb_to_recordset(${sql.json(rows as unknown as postgres.JSONValue)}::jsonb) AS d(
      guid text, title text, summary text, published timestamptz, duration int,
      episode_art text, file_url text, file_length bigint, file_type text
    )
    WHERE NOT EXISTS (
      SELECT 1 FROM episodes e
      WHERE e.podcast_id = ${podcastId} AND e.guid = d.guid
    )
  `;
}
