import type postgres from 'postgres';
import { podcastAccess } from '@/server/podcast-access';

export interface ChapterEpisode {
  id: number;
  owner_user_id: string | null;
  file_url: string | null;
  file_length: number | string | null;
  file_type: string | null;
  summary: string | null;
}

export async function readChapterEpisode(
  sql: postgres.ISql,
  id: number,
  userId: string | null,
) {
  const [episode] = await sql<ChapterEpisode[]>`
    SELECT e.id, p.owner_user_id, c.file_url, c.file_length, c.file_type, c.summary
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    LEFT JOIN episode_content c ON c.episode_id = e.id
    WHERE e.id = ${id} AND ${podcastAccess(sql, userId)}
  `;
  return episode ?? null;
}
