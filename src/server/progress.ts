import type { EpisodeProgress, IEpisodeInfo } from '@/types';
import { sql } from './db';
import { podcastAccess } from './podcast-access';

export interface PlaybackProgress {
  episode: IEpisodeInfo;
  position: number;
}

export async function getRecentProgress(
  userId: string,
  limit: number,
): Promise<PlaybackProgress[]> {
  const rows = await sql`
    SELECT
      pp.position,
      e.id as episode_id,
      e.guid,
      c.title,
      c.summary,
      e.published,
      c.duration,
      c.episode_art,
      c.file_url,
      c.file_length,
      c.file_type,
      p.id as podcast_id,
      p.feed_url,
      p.title as podcast_title,
      p.cover,
      p.explicit,
      p.owner_user_id,
      a.name as author
    FROM playback_progress pp
    JOIN episodes e ON e.id = pp.episode_id
    JOIN podcasts p ON p.id = e.podcast_id
    JOIN authors a ON a.id = p.author_id
    JOIN episode_content c ON c.episode_id = e.id
    WHERE pp.user_id = ${userId} AND ${podcastAccess(sql, userId)}
      AND pp.completed = false
    ORDER BY pp.updated_at DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    position: row.position,
    episode: {
      id: row.episode_id,
      podcastId: row.podcast_id,
      isPrivate: row.owner_user_id !== null,
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
  }));
}

export async function getCurrentProgress(
  userId: string,
): Promise<PlaybackProgress | null> {
  return (await getRecentProgress(userId, 1))[0] ?? null;
}

export async function getEpisodeProgress(
  userId: string,
  episodeIds: number[],
): Promise<EpisodeProgress[]> {
  const rows = await sql`
    SELECT pp.episode_id, pp.position, pp.completed
    FROM playback_progress pp
    JOIN episodes e ON e.id = pp.episode_id
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE pp.user_id = ${userId} AND pp.episode_id = ANY(${episodeIds}::bigint[])
      AND ${podcastAccess(sql, userId)}
    ORDER BY pp.episode_id
  `;
  return rows.map((row) => ({
    episodeId: Number(row.episode_id),
    position: row.position,
    completed: row.completed,
  }));
}

export async function getPodcastProgress(
  userId: string,
  podcastId: number,
): Promise<EpisodeProgress[]> {
  const rows = await sql`
    SELECT pp.episode_id, pp.position, pp.completed
    FROM playback_progress pp
    JOIN episodes e ON e.id = pp.episode_id
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE pp.user_id = ${userId} AND e.podcast_id = ${podcastId}
      AND ${podcastAccess(sql, userId)}
    ORDER BY pp.episode_id
  `;
  return rows.map((row) => ({
    episodeId: Number(row.episode_id),
    position: row.position,
    completed: row.completed,
  }));
}

export async function saveProgress(
  userId: string,
  episodeId: number,
  position: number,
  completed: boolean,
): Promise<boolean> {
  const [saved] = await sql`
    INSERT INTO playback_progress (user_id, episode_id, position, completed, updated_at)
    SELECT ${userId}, e.id, ${position}, ${completed}, now()
    FROM episodes e JOIN podcasts p ON p.id = e.podcast_id
    WHERE e.id = ${episodeId} AND ${podcastAccess(sql, userId)}
    ON CONFLICT (user_id, episode_id) DO UPDATE SET
      position = EXCLUDED.position,
      completed = EXCLUDED.completed,
      updated_at = EXCLUDED.updated_at
    RETURNING episode_id
  `;
  return !!saved;
}
