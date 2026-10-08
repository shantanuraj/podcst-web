import type postgres from 'postgres';
import { fixtureId } from './identity-fixture';

export function seedFollow(
  sql: postgres.ISql,
  userId: string,
  podcastId: string | number,
  subscribedAt?: Date | string | null,
) {
  return sql`
    WITH head AS (
      INSERT INTO follow_revision_heads (user_id, revision) VALUES (${userId}, 1)
      ON CONFLICT (user_id) DO UPDATE SET revision = follow_revision_heads.revision + 1
      RETURNING revision
    )
    INSERT INTO subscriptions (user_id, podcast_id, revision, subscribed_at)
    SELECT ${userId}, ${fixtureId(podcastId)}, head.revision,
      ${subscribedAt === undefined ? sql`clock_timestamp()` : sql`${subscribedAt}::timestamptz`}
    FROM head
    ON CONFLICT (user_id, podcast_id) DO UPDATE SET revision = EXCLUDED.revision,
      subscribed_at = EXCLUDED.subscribed_at
  `;
}

export function seedProgress(
  sql: postgres.ISql,
  userId: string,
  episodeId: string | number,
  position: number,
  completed = false,
  updatedAt?: Date | string | null,
) {
  return sql`
    WITH head AS (
      INSERT INTO progress_revision_heads (user_id, revision) VALUES (${userId}, 1)
      ON CONFLICT (user_id) DO UPDATE SET revision = progress_revision_heads.revision + 1
      RETURNING revision
    )
    INSERT INTO playback_progress (user_id, episode_id, position, completed, revision, updated_at)
    SELECT ${userId}, ${fixtureId(episodeId)}, ${position}, ${completed}, head.revision,
      ${updatedAt === undefined ? sql`clock_timestamp()` : sql`${updatedAt}::timestamptz`}
    FROM head
    ON CONFLICT (user_id, episode_id) DO UPDATE SET position = EXCLUDED.position,
      completed = EXCLUDED.completed, revision = EXCLUDED.revision, updated_at = EXCLUDED.updated_at
  `;
}
