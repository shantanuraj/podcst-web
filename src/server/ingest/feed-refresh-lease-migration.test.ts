import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { startPostgres } from '../../../scripts/lib/postgres-sandbox';
import { createSchemaFixture } from '../../../scripts/lib/schema-fixture';
import { loadMigrations } from '../../../scripts/migrations';

describe.skipIf(!process.env.PG_BIN)('refresh lease migration', () => {
  test('preserves populated schedules, rolls back DDL and fences source changes', async () => {
    const cluster = startPostgres();
    const sql = cluster.sql;
    try {
      await createSchemaFixture(sql, '0010-durable-state.sql');
      await sql`INSERT INTO users (id, email) VALUES ('owner', 'owner@example.invalid')`;
      await sql`INSERT INTO authors (id, name) VALUES (1, 'Fixture')`;
      await sql`INSERT INTO podcasts (id, author_id, feed_url, title, cover) VALUES (1, 1, 'https://example.invalid/old', 'Cached', '')`;
      await sql`INSERT INTO feed_poll_state (podcast_id, etag, hash, failures, next_poll_at)
        VALUES (1, '"old"', 'old-hash', 2, now() + interval '1 day')`;
      const before = (await sql`SELECT * FROM feed_poll_state`)[0];
      const migration = loadMigrations().find(
        ({ name }) => name === '0011-feed-refresh-leases.sql',
      );
      if (!migration) throw new Error('Lease migration missing');
      await expect(
        sql.begin(async (tx) => {
          await tx.unsafe(migration.source);
          throw new Error('synthetic rollback');
        }),
      ).rejects.toThrow('synthetic rollback');
      expect((await sql`SELECT * FROM feed_poll_state`)[0]).toEqual(before);
      await sql.begin((tx) => tx.unsafe(migration.source));
      expect((await sql`SELECT * FROM feed_poll_state`)[0]).toEqual({
        ...before,
        refresh_token: null,
        refresh_expires_at: null,
      });
      await expect(
        sql`UPDATE feed_poll_state SET refresh_token = ${randomUUID()}`.execute(),
      ).rejects.toMatchObject({ code: '23514' });
      const token = randomUUID();
      await sql`UPDATE feed_poll_state SET refresh_token = ${token}, refresh_expires_at = now() + interval '1 minute'`;
      await sql`UPDATE podcasts SET title = 'Renamed', last_accessed_at = now() WHERE id = 1`;
      expect(
        (await sql`SELECT refresh_token FROM feed_poll_state`)[0].refresh_token,
      ).toBe(token);
      await sql`CREATE TEMP TABLE feed_poll_state (podcast_id bigint, refresh_token uuid)`;
      await sql`INSERT INTO pg_temp.feed_poll_state VALUES (1, ${token})`;
      await sql`UPDATE podcasts SET feed_url = 'https://example.invalid/new' WHERE id = 1`;
      expect(
        (await sql`SELECT refresh_token FROM pg_temp.feed_poll_state`)[0]
          .refresh_token,
      ).toBe(token);
      expect(
        (
          await sql`SELECT etag, hash, failures, refresh_token, refresh_expires_at FROM public.feed_poll_state`
        )[0],
      ).toEqual({
        etag: null,
        hash: null,
        failures: 0,
        refresh_token: null,
        refresh_expires_at: null,
      });
      await sql`DROP TABLE pg_temp.feed_poll_state`;
      await sql`UPDATE feed_poll_state SET refresh_token = ${token}, refresh_expires_at = now() + interval '1 minute'`;
      await sql`UPDATE podcasts SET owner_user_id = 'owner' WHERE id = 1`;
      expect(
        (await sql`SELECT refresh_token FROM feed_poll_state`)[0].refresh_token,
      ).toBeNull();
    } finally {
      await cluster.stop();
    }
  }, 30_000);
});
