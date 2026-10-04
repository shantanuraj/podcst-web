import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { createSchemaFixture } from '../../scripts/lib/schema-fixture';

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `episode_content_test_${randomUUID().replaceAll('-', '')}`;

describe.skipIf(!databaseUrl)(
  'episodes without content with PostgreSQL',
  () => {
    let sql: postgres.Sql;
    let admin: postgres.Sql;
    let server: typeof import('./subscriptions') &
      typeof import('./progress') &
      typeof import('./ingest/podcast');

    beforeAll(async () => {
      if (!databaseUrl) throw new Error('TEST_DATABASE_URL required');
      admin = postgres(databaseUrl, { onnotice: () => {} });
      await admin`CREATE SCHEMA ${admin(schema)}`;
      sql = postgres(databaseUrl, {
        connection: { search_path: schema },
        onnotice: () => {},
        types: {
          bigint: {
            to: 20,
            from: [20],
            serialize: (value: number) => String(value),
            parse: Number,
          },
        },
      });
      await createSchemaFixture(sql);
      mock.module('./db', () => ({ sql }));
      server = {
        ...(await import('./subscriptions')),
        ...(await import('./progress')),
        ...(await import('./ingest/podcast')),
      };
      await sql`INSERT INTO authors (id, name) VALUES (1, 'Author')`;
      await sql`
      INSERT INTO podcasts (id, feed_url, title, author_id, cover)
      VALUES (1, 'https://example.com/feed.xml', 'Podcast', 1, 'cover')
    `;
      await sql`
      INSERT INTO episodes (id, podcast_id, guid, published)
      VALUES (101, 1, 'kept', '2026-01-01'),
             (102, 1, 'dropped', '2026-01-03'),
             (103, 1, 'also-kept', '2026-01-02')
    `;
      await sql`
      INSERT INTO episode_content (episode_id, title, file_url)
      VALUES (101, 'Kept', 'https://example.com/kept.mp3'),
             (103, 'Also kept', 'https://example.com/also-kept.mp3')
    `;
      await sql`INSERT INTO users (id, email) VALUES ('user', 'user@example.com')`;
      await sql`INSERT INTO subscriptions (user_id, podcast_id) VALUES ('user', 1)`;
      await sql`
      INSERT INTO playback_progress (user_id, episode_id, position, updated_at)
      VALUES ('user', 101, 30, now() - interval '1 day'),
             ('user', 102, 60, now())
    `;
    });

    afterAll(async () => {
      mock.restore();
      await sql?.end();
      if (admin) {
        await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
        await admin.end();
      }
    });

    test('podcast responses omit episodes without content', async () => {
      const podcast = await server.getPodcastById(1);
      expect(podcast?.episodes.map((episode) => episode.id)).toEqual([
        103, 101,
      ]);
    });

    test('an episode without content is not found', async () => {
      expect(await server.getEpisodeById(102)).toBeNull();
      expect((await server.getEpisodeById(101))?.file.url).toBe(
        'https://example.com/kept.mp3',
      );
    });

    test('subscription releases come from episodes with content', async () => {
      const [podcast] = await server.getSubscriptions('user');
      expect(podcast.episodes.map((episode) => episode.id)).toEqual([103, 101]);
    });

    test('current progress skips episodes without content', async () => {
      const progress = await server.getCurrentProgress('user');
      expect(progress?.episode.id).toBe(101);
      expect(progress?.position).toBe(30);
    });
  },
);
