import type postgres from 'postgres';

export const privateFeedHeaders = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
};

export function podcastAccess(
  sql: postgres.ISql,
  userId: string | null = null,
) {
  return sql`(p.owner_user_id IS NULL OR p.owner_user_id = ${userId})`;
}

export async function canAccessPodcast(
  sql: postgres.ISql,
  podcastId: number,
  userId: string | null = null,
): Promise<boolean> {
  const [podcast] = await sql`
    SELECT p.id FROM podcasts p
    WHERE p.id = ${podcastId} AND ${podcastAccess(sql, userId)}
  `;
  return !!podcast;
}
