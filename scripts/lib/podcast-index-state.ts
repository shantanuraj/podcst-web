import type postgres from 'postgres';

export interface PodcastIndexCursor {
  lastUpdate: number;
  lastId: number;
}

export const INITIAL_PODCAST_INDEX_CURSOR: PodcastIndexCursor = {
  lastUpdate: 0,
  lastId: 0,
};

export function isAfterPodcastIndexCursor(
  lastUpdate: number,
  id: number,
  cursor: PodcastIndexCursor,
): boolean {
  return (
    lastUpdate > cursor.lastUpdate ||
    (lastUpdate === cursor.lastUpdate && id > cursor.lastId)
  );
}

export async function readPodcastIndexCursor(
  sql: postgres.Sql,
): Promise<PodcastIndexCursor> {
  const [row] = await sql`
    SELECT last_update::text, last_id::text
    FROM podcast_index_sync_state
    WHERE singleton = true
  `;
  if (!row) throw new Error('Podcast Index sync state is missing');

  const cursor = {
    lastUpdate: Number(row.last_update),
    lastId: Number(row.last_id),
  };
  if (
    !Number.isSafeInteger(cursor.lastUpdate) ||
    !Number.isSafeInteger(cursor.lastId) ||
    cursor.lastUpdate < 0 ||
    cursor.lastId < 0
  ) {
    throw new Error('Podcast Index sync state is invalid');
  }
  return cursor;
}

export async function writePodcastIndexCursor(
  sql: postgres.Sql,
  cursor: PodcastIndexCursor,
): Promise<void> {
  const result = await sql`
    UPDATE podcast_index_sync_state
    SET last_update = ${cursor.lastUpdate}, last_id = ${cursor.lastId}, completed_at = clock_timestamp()
    WHERE singleton = true
  `;
  if (result.count !== 1)
    throw new Error('Podcast Index sync state is missing');
}
