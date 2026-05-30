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
