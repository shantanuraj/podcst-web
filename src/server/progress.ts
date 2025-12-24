import { sql } from './db';
import type { IEpisodeInfo } from '@/types';

export interface PlaybackProgress {
  episode: IEpisodeInfo;
  position: number;
}

export async function getCurrentProgress(userId: string): Promise<PlaybackProgress | null> {
  const [row] = await sql`
    SELECT
      pp.position,
      e.id as episode_id,
      e.guid,
      e.title,
      e.summary,
      e.published,
      e.duration,
      e.episode_art,
      e.file_url,
      e.file_length,
      e.file_type,
      p.id as podcast_id,
      p.feed_url,
      p.title as podcast_title,
      p.cover,
      p.explicit,
      a.name as author
    FROM playback_progress pp
    JOIN episodes e ON e.id = pp.episode_id
    JOIN podcasts p ON p.id = e.podcast_id
    JOIN authors a ON a.id = p.author_id
    WHERE pp.user_id = ${userId}
      AND pp.completed = false
    ORDER BY pp.updated_at DESC
    LIMIT 1
  `;

  if (!row) return null;

  return {
    position: row.position,
    episode: {
      id: row.episode_id,
      podcastId: row.podcast_id,
      guid: row.guid,
      title: row.title,
      summary: row.summary,
      published: row.published ? new Date(row.published).getTime() : null,
      duration: row.duration,
      episodeArt: row.episode_art,
      cover: row.cover,
      explicit: row.explicit,
      link: null,
      showNotes: row.summary || '',
      author: row.author,
      feed: row.feed_url,
      podcastTitle: row.podcast_title,
      file: {
        url: row.file_url,
        length: Number(row.file_length) || 0,
        type: row.file_type || 'audio/mpeg',
      },
    },
  };
}

export async function saveProgress(
  userId: string,
  episodeId: number,
  position: number,
  completed: boolean,
): Promise<boolean> {
  const [exists] = await sql`
    SELECT 1 FROM episodes WHERE id = ${episodeId}
  `;
  if (!exists) return false;

  await sql`
    INSERT INTO playback_progress (user_id, episode_id, position, completed, updated_at)
    VALUES (${userId}, ${episodeId}, ${position}, ${completed}, now())
    ON CONFLICT (user_id, episode_id) DO UPDATE SET
      position = EXCLUDED.position,
      completed = EXCLUDED.completed,
      updated_at = EXCLUDED.updated_at
  `;

  return true;
}

export async function getEpisodeProgress(
  userId: string,
  episodeId: number,
): Promise<{ position: number; completed: boolean } | null> {
  const [row] = await sql`
    SELECT position, completed
    FROM playback_progress
    WHERE user_id = ${userId} AND episode_id = ${episodeId}
  `;

  if (!row) return null;
  return { position: row.position, completed: row.completed };
}
