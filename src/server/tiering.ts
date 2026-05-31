export const ESSENTIAL_IDS_SQL = `
  SELECT podcast_id AS id FROM subscriptions
  UNION
  SELECT podcast_id AS id FROM top_podcasts
  UNION
  SELECT e.podcast_id AS id
  FROM playback_progress pp
  JOIN episodes e ON e.id = pp.episode_id
  WHERE pp.updated_at > now() - interval '90 days'
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

export async function evictWarm(capBytes: number): Promise<number> {
  const { sql } = await import('./db');
  const [{ avg_bytes }] = await sql`
    SELECT coalesce(pg_relation_size('episode_content')::numeric / NULLIF(count(*), 0), 0)::float8 AS avg_bytes
    FROM episode_content
  `;
  if (!avg_bytes || Number(avg_bytes) <= 0) return 0;
  const capRows = Math.floor(capBytes / Number(avg_bytes));

  const countWarm = async (): Promise<number> => {
    const [{ n }] = await sql`
      SELECT count(*)::bigint AS n
      FROM episode_content c
      JOIN episodes e ON e.id = c.episode_id
      JOIN podcasts p ON p.id = e.podcast_id
      WHERE NOT p.is_essential
    `;
    return Number(n);
  };

  let warm = await countWarm();
  let evicted = 0;
  while (warm > capRows) {
    const [victim] = await sql`
      SELECT p.id
      FROM podcasts p
      WHERE NOT p.is_essential
        AND EXISTS (
          SELECT 1 FROM episode_content c
          JOIN episodes e ON e.id = c.episode_id
          WHERE e.podcast_id = p.id
        )
      ORDER BY p.last_accessed_at ASC NULLS FIRST
      LIMIT 1
    `;
    if (!victim) break;
    const [{ removed }] = await sql`
      WITH del AS (
        DELETE FROM episode_content c
        USING episodes e
        WHERE c.episode_id = e.id AND e.podcast_id = ${victim.id}
        RETURNING 1
      )
      SELECT count(*)::int AS removed FROM del
    `;
    if (!removed) break;
    warm -= Number(removed);
    evicted += Number(removed);
  }
  return evicted;
}
