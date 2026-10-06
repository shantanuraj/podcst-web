import type postgres from 'postgres';

export const FOLLOWED_IDS_SQL = `
  SELECT podcast_id AS id FROM subscriptions
  UNION
  SELECT e.podcast_id AS id
  FROM playback_progress pp
  JOIN episodes e ON e.id = pp.episode_id
  WHERE pp.updated_at > now() - interval '90 days'
`;

export const ESSENTIAL_IDS_SQL = `
  ${FOLLOWED_IDS_SQL}
  UNION
  SELECT podcast_id AS id FROM top_podcasts
`;

export async function recomputeEssential(): Promise<number> {
  const { sql } = await import('./db');
  const [{ n }] = await sql.unsafe(`
    WITH ess AS (${ESSENTIAL_IDS_SQL})
    , upd AS (
      UPDATE podcasts p
      SET is_essential = (p.id IN (SELECT id FROM ess))
      WHERE p.is_essential IS DISTINCT FROM (p.id IN (SELECT id FROM ess))
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM upd
  `);
  return Number(n);
}

export async function evictWarm(
  capBytes: number,
  database?: postgres.Sql,
): Promise<number> {
  const sql = database ?? (await import('./db')).sql;
  const [{ avg_bytes }] = await sql`
    SELECT coalesce(pg_relation_size('episode_content')::numeric / NULLIF(count(*), 0), 0)::float8 AS avg_bytes
    FROM episode_content
  `;
  if (!avg_bytes || Number(avg_bytes) <= 0) return 0;
  const capRows = Math.floor(capBytes / Number(avg_bytes));

  const unpinned = sql`NOT EXISTS (
    SELECT 1 FROM episode_list_items i WHERE i.episode_id = e.id
  )`;
  const countWarm = async (): Promise<number> => {
    const [{ n }] = await sql`
      SELECT count(*)::bigint AS n
      FROM episode_content c
      JOIN episodes e ON e.id = c.episode_id
      JOIN podcasts p ON p.id = e.podcast_id
      WHERE NOT p.is_essential AND ${unpinned}
    `;
    return Number(n);
  };

  let evicted = 0;
  while ((await countWarm()) > capRows) {
    const removed = await sql.begin(async (tx) => {
      const [victim] = await tx`
        SELECT p.id FROM podcasts p
        WHERE NOT p.is_essential AND EXISTS (
          SELECT 1 FROM episode_content c JOIN episodes e ON e.id = c.episode_id
          WHERE e.podcast_id = p.id AND ${unpinned}
        )
        ORDER BY p.last_accessed_at ASC NULLS FIRST, p.id LIMIT 1
      `;
      if (!victim) return null;
      await tx`SELECT pg_advisory_xact_lock(${victim.id}::bigint)`;
      const [{ count }] = await tx`
        WITH removed AS (
          DELETE FROM episode_content c USING episodes e, podcasts p
          WHERE c.episode_id = e.id AND e.podcast_id = p.id
            AND p.id = ${victim.id} AND NOT p.is_essential AND ${unpinned}
          RETURNING 1
        ) SELECT count(*)::int AS count FROM removed
      `;
      return Number(count);
    });
    if (removed === null) break;
    evicted += removed;
  }
  return evicted;
}
