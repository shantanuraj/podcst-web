export function needsRebuild(c: { identityCount: number; contentCount: number }): boolean {
  return c.identityCount > 0 && c.contentCount === 0;
}

export async function touchAccess(podcastId: number): Promise<void> {
  const { sql } = await import('../db');
  await sql`
    UPDATE podcasts
    SET last_accessed_at = now()
    WHERE id = ${podcastId}
      AND (last_accessed_at IS NULL OR last_accessed_at < now() - interval '1 hour')
  `;
}

export async function ensureContent(podcastId: number, feedUrl: string): Promise<void> {
  const { sql } = await import('../db');
  const [{ identity_count, content_count }] = await sql`
    SELECT
      (SELECT count(*) FROM episodes WHERE podcast_id = ${podcastId})::int AS identity_count,
      (SELECT count(*) FROM episode_content c JOIN episodes e ON e.id = c.episode_id
        WHERE e.podcast_id = ${podcastId})::int AS content_count
  `;
  if (needsRebuild({ identityCount: identity_count, contentCount: content_count })) {
    const { refreshPodcast } = await import('./podcast');
    await refreshPodcast(podcastId);
  }
}
