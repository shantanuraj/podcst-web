import type postgres from 'postgres';
import type { Genre } from '@/types';

export const PODCASTS_GENRE = 26;

export const genreJoin = (sql: postgres.Sql, podcast: string) => sql`
  LEFT JOIN genres g ON g.id = ${sql(podcast)}.primary_genre_id
  LEFT JOIN genres gc ON gc.id = CASE WHEN g.parent_id = ${PODCASTS_GENRE} THEN g.id ELSE g.parent_id END
`;

export const genreColumns = (sql: postgres.Sql) => sql`
  g.id AS genre_id, g.name AS genre_name, gc.id AS category_id, gc.name AS category_name
`;

const genre = (id: unknown, name: unknown): Genre | null =>
  id == null || typeof name !== 'string' ? null : { id: Number(id), name };

export const genresOf = (row: Record<string, unknown>) => ({
  genre: genre(row.genre_id, row.genre_name),
  category: genre(row.category_id, row.category_name),
});
