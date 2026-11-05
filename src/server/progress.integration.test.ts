import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test';
import postgres from 'postgres';
import { startPostgres } from '../../scripts/lib/postgres-sandbox';
import { createSchemaFixture } from '../../scripts/lib/schema-fixture';
import { seedProgress } from '../../scripts/lib/state-fixture';

describe.skipIf(!process.env.PG_BIN)(
  'playback restoration on isolated PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    let sql: postgres.Sql;
    let progress: typeof import('./progress');

    beforeAll(async () => {
      cluster = startPostgres();
      sql = postgres(cluster.options);
      await createSchemaFixture(sql);
      mock.module('./db', () => ({ sql }));
      progress = await import('./progress');
    }, 30_000);

    afterAll(async () => {
      mock.restore();
      await sql?.end();
      await cluster?.stop();
    });

    beforeEach(async () => {
      await sql`TRUNCATE users, authors RESTART IDENTITY CASCADE`;
      await sql`INSERT INTO users (id, email) VALUES ('owner', 'owner@example.invalid')`;
      await sql`INSERT INTO authors (id, name) VALUES (1, 'Author')`;
      await sql`
        INSERT INTO podcasts (id, author_id, feed_url, title, cover)
        VALUES (1, 1, 'https://example.invalid/feed', 'Podcast', 'cover')
      `;
      await sql`
        INSERT INTO episodes (id, podcast_id, guid, published)
        SELECT id, 1, 'episode-' || id, '2026-01-01'::timestamptz
        FROM generate_series(1, 3) id
      `;
      await sql`
        INSERT INTO episode_content (episode_id, title, file_url)
        SELECT id, 'Episode ' || id, 'https://example.invalid/' || id || '.mp3'
        FROM episodes
      `;
    });

    test('finishing the latest episode does not restore an older unfinished episode', async () => {
      await seedProgress(sql, 'owner', '1', 60);
      await seedProgress(sql, 'owner', '2', 120);
      expect(await progress.getCurrentProgress('owner')).toMatchObject({
        episode: { id: '2' },
        position: 120,
      });

      await seedProgress(sql, 'owner', '2', 0, true);
      expect(await progress.getCurrentProgress('owner')).toBeNull();
      expect(await progress.getRecentProgress('owner', 3)).toMatchObject([
        { episode: { id: '1' }, position: 60 },
      ]);

      await seedProgress(sql, 'owner', '3', 30);
      expect(await progress.getCurrentProgress('owner')).toMatchObject({
        episode: { id: '3' },
        position: 30,
      });
      expect(
        (await progress.getRecentProgress('owner', 1)).map(
          ({ episode }) => episode.id,
        ),
      ).toEqual(['3']);
    });

    test('empty and fully completed histories have no current or recent playback', async () => {
      expect(await progress.getCurrentProgress('owner')).toBeNull();
      expect(await progress.getRecentProgress('owner', 3)).toEqual([]);
      await seedProgress(sql, 'owner', '1', 0, true);
      expect(await progress.getCurrentProgress('owner')).toBeNull();
      expect(await progress.getRecentProgress('owner', 3)).toEqual([]);
    });
  },
);
